import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export type ProxySessionAuthConfig = {
  cookieName: string;
  cookieSecure: boolean;
  sessionTtlMs: number;
  users: Map<string, string>;
};

export type ProxySessionRecord = {
  id: string;
  username: string;
  expiresAt: number;
};

export type ProxySessionStatus = {
  authEnabled: boolean;
  authenticated: boolean;
  username: string | null;
  expiresAt: string | null;
};

export class ProxySessionAuth {
  private readonly sessions = new Map<string, ProxySessionRecord>();

  constructor(private readonly config: ProxySessionAuthConfig) {}

  isEnabled(): boolean {
    return this.config.users.size > 0;
  }

  createSession(username: string): ProxySessionRecord {
    this.pruneExpiredSessions();
    const id = randomBytes(24).toString('base64url');
    const session: ProxySessionRecord = {
      id,
      username,
      expiresAt: Date.now() + this.config.sessionTtlMs
    };
    this.sessions.set(id, session);
    return session;
  }

  authenticate(username: string, password: string): ProxySessionRecord | null {
    this.pruneExpiredSessions();
    const expectedPassword = this.config.users.get(username);
    if (!expectedPassword || !safeEquals(expectedPassword, password)) {
      return null;
    }
    return this.createSession(username);
  }

  getSessionFromRequest(request: IncomingMessage): ProxySessionRecord | null {
    if (!this.isEnabled()) {
      return null;
    }

    this.pruneExpiredSessions();
    const sessionId = parseCookies(request.headers.cookie)[this.config.cookieName];
    if (!sessionId) {
      return null;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(session.id);
      return null;
    }

    return session;
  }

  clearSessionForRequest(request: IncomingMessage): void {
    const existing = this.getSessionFromRequest(request);
    if (existing) {
      this.sessions.delete(existing.id);
    }
  }

  createSessionCookie(session: ProxySessionRecord): string {
    return serializeCookie(this.config.cookieName, session.id, this.config.sessionTtlMs, this.config.cookieSecure);
  }

  createClearedSessionCookie(): string {
    return serializeCookie(this.config.cookieName, '', 0, this.config.cookieSecure);
  }

  getSessionStatus(request: IncomingMessage): ProxySessionStatus {
    if (!this.isEnabled()) {
      return {
        authEnabled: false,
        authenticated: false,
        username: null,
        expiresAt: null
      };
    }

    const session = this.getSessionFromRequest(request);
    return {
      authEnabled: true,
      authenticated: Boolean(session),
      username: session?.username ?? null,
      expiresAt: session ? new Date(session.expiresAt).toISOString() : null
    };
  }

  private pruneExpiredSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        this.sessions.delete(sessionId);
      }
    }
  }
}

export function parseProxyUsers(value: string | undefined): Map<string, string> {
  const users = new Map<string, string>();
  if (!value) {
    return users;
  }

  for (const entry of value.split(/[\n;,]+/)) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
      continue;
    }

    const username = trimmed.slice(0, separatorIndex).trim();
    const password = trimmed.slice(separatorIndex + 1).trim();
    if (!username || !password) {
      continue;
    }

    users.set(username, password);
  }

  return users;
}

function parseCookies(headerValue: string | undefined): Record<string, string> {
  if (!headerValue) {
    return {};
  }

  return headerValue.split(';').reduce<Record<string, string>>((cookies, part) => {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex <= 0) {
      return cookies;
    }

    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (!name) {
      return cookies;
    }

    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
    return cookies;
  }, {});
}

function serializeCookie(name: string, value: string, ttlMs: number, secure: boolean): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(ttlMs / 1000))}`
  ];

  if (secure) {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}
