import { getDefaultProxyAuthBaseUrl } from './proxyRoute';

export type ProxySessionResponse = {
  ok: boolean;
  authEnabled: boolean;
  authenticated: boolean;
  username: string | null;
  expiresAt: string | null;
  error?: string;
};

export async function fetchProxySession(): Promise<ProxySessionResponse> {
  return requestProxyAuth('/session', { method: 'GET' });
}

export async function loginProxySession(username: string, password: string): Promise<ProxySessionResponse> {
  return requestProxyAuth('/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
}

export async function logoutProxySession(): Promise<ProxySessionResponse> {
  return requestProxyAuth('/logout', { method: 'POST' });
}

async function requestProxyAuth(
  path: string,
  init: Omit<RequestInit, 'credentials' | 'headers'> & { body?: string }
): Promise<ProxySessionResponse> {
  const response = await fetch(`${getDefaultProxyAuthBaseUrl()}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.body ? { Accept: 'application/json' } : {})
    }
  });

  const payload = await safeReadJson(response);
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : `Request failed with status ${response.status}.`);
  }

  return {
    ok: true,
    authEnabled: Boolean(payload.authEnabled),
    authenticated: Boolean(payload.authenticated),
    username: typeof payload.username === 'string' ? payload.username : null,
    expiresAt: typeof payload.expiresAt === 'string' ? payload.expiresAt : null
  };
}

async function safeReadJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed = await response.json();
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
