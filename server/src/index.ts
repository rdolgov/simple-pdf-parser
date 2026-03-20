import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { executeCodexResponses, type CodexExecConfig } from './codexExecProxy.js';
import { FileResponseCache } from './requestCache.js';
import { loadLocalEnvFiles } from './loadLocalEnv.js';
import { ProxySessionAuth, parseProxyUsers } from './sessionAuth.js';
import { StaticProxyApp } from './staticProxyApp.js';

type ServerConfig = {
  port: number;
  proxyAuthToken?: string;
  corsOrigin: string;
  openAiBaseUrl: string;
  openAiApiKey?: string;
  geminiBaseUrl: string;
  geminiApiKey?: string;
  codexExec: CodexExecConfig;
  cacheEnabled: boolean;
  cacheDir: string;
  cacheTtlMs?: number;
  cacheMaxBodyBytes: number;
  proxyUsers: Map<string, string>;
  sessionCookieName: string;
  sessionTtlMs: number;
  sessionCookieSecure: boolean;
  proxyAppDir: string;
};

type ProxyResponseData = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

const PROXY_APP_PREFIX = '/proxy';
const OPENAI_PROXY_PREFIX = '/api/llm/openai/';
const GEMINI_PROXY_PREFIX = '/api/llm/gemini/';
const CODEX_PROXY_PREFIX = '/api/llm/codex/';
const PROXY_OPENAI_PROXY_PREFIX = '/proxy/api/llm/openai/';
const PROXY_GEMINI_PROXY_PREFIX = '/proxy/api/llm/gemini/';
const PROXY_CODEX_PROXY_PREFIX = '/proxy/api/llm/codex/';
const HEALTH_PATHS = new Set(['/health', '/api/health', '/proxy/api/health']);
const AUTH_SESSION_PATHS = new Set(['/api/auth/session', '/proxy/api/auth/session']);
const AUTH_LOGIN_PATHS = new Set(['/api/auth/login', '/proxy/api/auth/login']);
const AUTH_LOGOUT_PATHS = new Set(['/api/auth/logout', '/proxy/api/auth/logout']);

loadLocalEnvFiles();
const config = loadConfig();
const responseCache = new FileResponseCache({
  enabled: config.cacheEnabled,
  cacheDir: config.cacheDir,
  ttlMs: config.cacheTtlMs,
  maxBodyBytes: config.cacheMaxBodyBytes
});
const sessionAuth = new ProxySessionAuth({
  cookieName: config.sessionCookieName,
  cookieSecure: config.sessionCookieSecure,
  sessionTtlMs: config.sessionTtlMs,
  users: config.proxyUsers
});
const staticProxyApp = new StaticProxyApp({
  appDir: config.proxyAppDir,
  routePrefix: PROXY_APP_PREFIX
});

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    console.error('[llm-proxy] Unhandled request error', error);
    if (!response.headersSent) {
      writeCorsHeaders(response, config.corsOrigin);
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    response.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unexpected proxy error.'
      })
    );
  });
});

server.listen(config.port, () => {
  console.log(`[llm-proxy] Listening on http://localhost:${config.port}`);
  console.log('[llm-proxy] OpenAI routes:', `${OPENAI_PROXY_PREFIX}responses`, `and ${PROXY_OPENAI_PROXY_PREFIX}responses`);
  console.log(
    '[llm-proxy] Gemini routes:',
    `${GEMINI_PROXY_PREFIX}v1beta/models/{model}:generateContent`,
    `and ${PROXY_GEMINI_PROXY_PREFIX}v1beta/models/{model}:generateContent`
  );
  console.log('[llm-proxy] Codex routes:', `${CODEX_PROXY_PREFIX}responses`, `and ${PROXY_CODEX_PROXY_PREFIX}responses`);
  console.log(
    '[llm-proxy] Auth:',
    sessionAuth.isEnabled()
      ? `cookie users=${config.proxyUsers.size} cookieName=${config.sessionCookieName} ttlMs=${config.sessionTtlMs}`
      : config.proxyAuthToken
        ? 'shared token only'
        : 'disabled'
  );
  console.log(
    '[llm-proxy] Cache:',
    responseCache.isEnabled()
      ? `enabled dir=${responseCache.getCacheDir()} ttlMs=${responseCache.getTtlMs() ?? 'none'}`
      : 'disabled'
  );
  console.log('[llm-proxy] Proxy app route:', `${PROXY_APP_PREFIX} -> ${staticProxyApp.appDir}`);
});

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  writeCorsHeaders(response, config.corsOrigin);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (request.method === 'GET' && HEALTH_PATHS.has(requestUrl.pathname)) {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(
      JSON.stringify({
        ok: true,
        providers: {
          openai: Boolean(config.openAiApiKey),
          gemini: Boolean(config.geminiApiKey),
          codex: config.codexExec.enabled
        },
        auth: {
          sharedTokenEnabled: Boolean(config.proxyAuthToken),
          sessionAuthEnabled: sessionAuth.isEnabled(),
          sessionUserCount: config.proxyUsers.size,
          sessionCookieName: config.sessionCookieName,
          sessionTtlMs: config.sessionTtlMs
        },
        cache: {
          enabled: config.cacheEnabled,
          dir: config.cacheDir,
          ttlMs: config.cacheTtlMs ?? null,
          maxBodyBytes: config.cacheMaxBodyBytes
        },
        app: {
          routePrefix: PROXY_APP_PREFIX,
          dir: config.proxyAppDir
        }
      })
    );
    return;
  }

  if (request.method === 'GET' && AUTH_SESSION_PATHS.has(requestUrl.pathname)) {
    sendJson(response, 200, {
      ok: true,
      ...sessionAuth.getSessionStatus(request)
    });
    return;
  }

  if (request.method === 'POST' && AUTH_LOGIN_PATHS.has(requestUrl.pathname)) {
    await handleLoginRequest(request, response);
    return;
  }

  if (request.method === 'POST' && AUTH_LOGOUT_PATHS.has(requestUrl.pathname)) {
    handleLogoutRequest(request, response);
    return;
  }

  if (request.method === 'POST') {
    const openAiUpstreamPath = stripKnownPrefix(requestUrl.pathname, [OPENAI_PROXY_PREFIX, PROXY_OPENAI_PROXY_PREFIX]);
    if (openAiUpstreamPath !== null) {
      await proxyOpenAiRequest(request, response, requestUrl, openAiUpstreamPath, config);
      return;
    }

    const geminiUpstreamPath = stripKnownPrefix(requestUrl.pathname, [GEMINI_PROXY_PREFIX, PROXY_GEMINI_PROXY_PREFIX]);
    if (geminiUpstreamPath !== null) {
      await proxyGeminiRequest(request, response, requestUrl, geminiUpstreamPath, config);
      return;
    }

    const codexUpstreamPath = stripKnownPrefix(requestUrl.pathname, [CODEX_PROXY_PREFIX, PROXY_CODEX_PROXY_PREFIX]);
    if (codexUpstreamPath !== null) {
      await proxyCodexRequest(request, response, requestUrl, codexUpstreamPath, config);
      return;
    }

    sendJson(response, 404, { error: 'Unknown proxy route.' });
    return;
  }

  if (request.method === 'GET') {
    if (await staticProxyApp.tryServe(requestUrl.pathname, response)) {
      return;
    }
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }

  sendJson(response, 405, { error: 'Unsupported request method.' });
}

async function proxyOpenAiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  upstreamPath: string,
  currentConfig: ServerConfig
): Promise<void> {
  if (!isAuthorized(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth)) {
    sendJson(response, 401, { error: 'Proxy authorization failed.' });
    return;
  }

  if (!currentConfig.openAiApiKey) {
    sendJson(response, 500, { error: 'OPENAI_API_KEY is not configured on the proxy server.' });
    return;
  }

  if (!isAllowedOpenAiPath(upstreamPath)) {
    sendJson(response, 404, { error: 'Unsupported OpenAI proxy path.' });
    return;
  }

  const upstreamUrl = new URL(joinUrl(currentConfig.openAiBaseUrl, upstreamPath));
  const body = await readRawBody(request);
  const accept = readHeaderValue(request.headers.accept);
  const contentType = readHeaderValue(request.headers['content-type']);
  const cacheEntry = responseCache.buildKey({
    provider: 'openai',
    upstreamBaseUrl: currentConfig.openAiBaseUrl,
    upstreamPath,
    queryParams: requestUrl.searchParams,
    method: 'POST',
    accept,
    contentType,
    body
  });
  const cacheKey = cacheEntry.key;
  const bodyHash = cacheEntry.bodyHash;

  const bypassCache = shouldBypassCache(request, requestUrl);
  if (!bypassCache) {
    const cached = await responseCache.get(cacheKey);
    if (cached) {
      writeProxyResponse(
        response,
        {
          status: cached.status,
          headers: cached.headers,
          body: cached.body
        },
        'HIT',
        cacheKey,
        bodyHash,
        cached.createdAt
      );
      return;
    }
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        Accept: accept ?? 'application/json',
        Authorization: `Bearer ${currentConfig.openAiApiKey}`,
        'Content-Type': contentType ?? 'application/json'
      },
      body
    });
  } catch (error) {
    console.error('[llm-proxy] OpenAI upstream request failed', error);
    sendJson(response, 502, { error: 'Failed to reach OpenAI upstream.' });
    return;
  }

  const upstream = await readUpstreamResponse(upstreamResponse);
  if (isCacheableResponse(upstream.status)) {
    try {
      await responseCache.set(cacheKey, upstream);
    } catch (error) {
      console.warn('[llm-proxy] Failed to store OpenAI cache entry', error);
    }
  }
  writeProxyResponse(response, upstream, bypassCache ? 'BYPASS' : 'MISS', cacheKey, bodyHash);
}

async function proxyGeminiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  upstreamPath: string,
  currentConfig: ServerConfig
): Promise<void> {
  if (!isAuthorized(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth)) {
    sendJson(response, 401, { error: 'Proxy authorization failed.' });
    return;
  }

  if (!currentConfig.geminiApiKey) {
    sendJson(response, 500, { error: 'GEMINI_API_KEY is not configured on the proxy server.' });
    return;
  }

  if (!isAllowedGeminiPath(upstreamPath)) {
    sendJson(response, 404, { error: 'Unsupported Gemini proxy path.' });
    return;
  }

  const upstreamUrl = new URL(joinUrl(currentConfig.geminiBaseUrl, upstreamPath));
  const searchParams = new URLSearchParams(requestUrl.searchParams);
  searchParams.set('key', currentConfig.geminiApiKey);
  upstreamUrl.search = searchParams.toString();

  const body = await readRawBody(request);
  const accept = readHeaderValue(request.headers.accept);
  const contentType = readHeaderValue(request.headers['content-type']);
  const cacheEntry = responseCache.buildKey({
    provider: 'gemini',
    upstreamBaseUrl: currentConfig.geminiBaseUrl,
    upstreamPath,
    queryParams: requestUrl.searchParams,
    method: 'POST',
    accept,
    contentType,
    body
  });
  const cacheKey = cacheEntry.key;
  const bodyHash = cacheEntry.bodyHash;

  const bypassCache = shouldBypassCache(request, requestUrl);
  if (!bypassCache) {
    const cached = await responseCache.get(cacheKey);
    if (cached) {
      writeProxyResponse(
        response,
        {
          status: cached.status,
          headers: cached.headers,
          body: cached.body
        },
        'HIT',
        cacheKey,
        bodyHash,
        cached.createdAt
      );
      return;
    }
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        Accept: accept ?? 'application/json',
        'Content-Type': contentType ?? 'application/json'
      },
      body
    });
  } catch (error) {
    console.error('[llm-proxy] Gemini upstream request failed', error);
    sendJson(response, 502, { error: 'Failed to reach Gemini upstream.' });
    return;
  }

  const upstream = await readUpstreamResponse(upstreamResponse);
  if (isCacheableResponse(upstream.status)) {
    try {
      await responseCache.set(cacheKey, upstream);
    } catch (error) {
      console.warn('[llm-proxy] Failed to store Gemini cache entry', error);
    }
  }
  writeProxyResponse(response, upstream, bypassCache ? 'BYPASS' : 'MISS', cacheKey, bodyHash);
}

async function proxyCodexRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  upstreamPath: string,
  currentConfig: ServerConfig
): Promise<void> {
  if (!isAuthorized(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth)) {
    sendJson(response, 401, { error: 'Proxy authorization failed.' });
    return;
  }

  if (!currentConfig.codexExec.enabled) {
    sendJson(response, 500, { error: 'CODEX_EXEC_ENABLED is not configured on the proxy server.' });
    return;
  }

  if (!isAllowedCodexPath(upstreamPath)) {
    sendJson(response, 404, { error: 'Unsupported Codex proxy path.' });
    return;
  }

  const body = await readRawBody(request);
  const accept = readHeaderValue(request.headers.accept);
  const contentType = readHeaderValue(request.headers['content-type']);
  const cacheEntry = responseCache.buildKey({
    provider: 'codex',
    upstreamBaseUrl: currentConfig.codexExec.command,
    upstreamPath,
    queryParams: requestUrl.searchParams,
    method: 'POST',
    accept,
    contentType,
    body
  });
  const cacheKey = cacheEntry.key;
  const bodyHash = cacheEntry.bodyHash;

  const bypassCache = shouldBypassCache(request, requestUrl);
  if (!bypassCache) {
    const cached = await responseCache.get(cacheKey);
    if (cached) {
      writeProxyResponse(
        response,
        {
          status: cached.status,
          headers: cached.headers,
          body: cached.body
        },
        'HIT',
        cacheKey,
        bodyHash,
        cached.createdAt
      );
      return;
    }
  }

  let upstream: ProxyResponseData;
  try {
    upstream = await executeCodexResponses(body, currentConfig.codexExec);
  } catch (error) {
    console.error('[llm-proxy] Codex exec request failed', error);
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : 'Failed to execute codex exec.'
    });
    return;
  }

  if (isCacheableResponse(upstream.status)) {
    try {
      await responseCache.set(cacheKey, upstream);
    } catch (error) {
      console.warn('[llm-proxy] Failed to store Codex cache entry', error);
    }
  }
  writeProxyResponse(response, upstream, bypassCache ? 'BYPASS' : 'MISS', cacheKey, bodyHash);
}

function isAllowedOpenAiPath(pathname: string): boolean {
  return pathname === 'responses' || pathname === 'embeddings' || pathname === 'images/generations';
}

function isAllowedGeminiPath(pathname: string): boolean {
  return /^v[0-9a-z]+(?:[a-z]*)\/models\/[^/]+:(generateContent|batchEmbedContents|embedContent)$/i.test(pathname);
}

function isAllowedCodexPath(pathname: string): boolean {
  return pathname === 'responses';
}

async function handleLoginRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!sessionAuth.isEnabled()) {
    sendJson(response, 404, { error: 'Proxy login is not enabled on this server.' });
    return;
  }

  const body = await readJsonBody(request);
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) {
    sendJson(response, 400, { error: 'Username and password are required.' });
    return;
  }

  const session = sessionAuth.authenticate(username, password);
  if (!session) {
    sendJson(response, 401, { error: 'Invalid username or password.' });
    return;
  }

  response.setHeader('Set-Cookie', sessionAuth.createSessionCookie(session));
  sendJson(response, 200, {
    ok: true,
    authEnabled: true,
    authenticated: true,
    username: session.username,
    expiresAt: new Date(session.expiresAt).toISOString()
  });
}

function handleLogoutRequest(request: IncomingMessage, response: ServerResponse): void {
  sessionAuth.clearSessionForRequest(request);
  response.setHeader('Set-Cookie', sessionAuth.createClearedSessionCookie());
  sendJson(response, 200, {
    ok: true,
    authEnabled: sessionAuth.isEnabled(),
    authenticated: false,
    username: null,
    expiresAt: null
  });
}

function isAuthorized(
  request: IncomingMessage,
  requestUrl: URL,
  expectedToken: string | undefined,
  auth: ProxySessionAuth
): boolean {
  if (auth.getSessionFromRequest(request)) {
    return true;
  }

  const headerValue = request.headers.authorization?.trim();
  if (expectedToken && headerValue === `Bearer ${expectedToken}`) {
    return true;
  }

  const alternateHeader = request.headers['x-llm-proxy-auth'];
  if (expectedToken && typeof alternateHeader === 'string' && alternateHeader.trim() === expectedToken) {
    return true;
  }

  const queryToken = requestUrl.searchParams.get('key')?.trim();
  if (expectedToken && queryToken === expectedToken) {
    return true;
  }

  return !auth.isEnabled() && !expectedToken;
}

function loadConfig(): ServerConfig {
  const env = process.env;

  return {
    port: normalizePort(env.PORT),
    proxyAuthToken: normalizeNonEmpty(env.LLM_PROXY_AUTH_TOKEN),
    corsOrigin: normalizeNonEmpty(env.LLM_PROXY_CORS_ORIGIN) ?? '*',
    openAiBaseUrl: normalizeUrl(env.OPENAI_BASE_URL, 'https://api.openai.com/v1'),
    openAiApiKey: normalizeNonEmpty(env.OPENAI_API_KEY),
    geminiBaseUrl: normalizeUrl(env.GEMINI_BASE_URL, 'https://generativelanguage.googleapis.com'),
    geminiApiKey: normalizeNonEmpty(env.GEMINI_API_KEY),
    codexExec: {
      enabled: normalizeBoolean(env.CODEX_EXEC_ENABLED, false),
      command: normalizeNonEmpty(env.CODEX_EXEC_COMMAND) ?? 'codex',
      workdir: normalizeNonEmpty(env.CODEX_EXEC_WORKDIR) ?? process.cwd(),
      defaultModel: normalizeNonEmpty(env.CODEX_EXEC_MODEL),
      sandboxMode: normalizeCodexSandboxMode(env.CODEX_EXEC_SANDBOX_MODE),
      profile: normalizeNonEmpty(env.CODEX_EXEC_PROFILE),
      fullAuto: normalizeBoolean(env.CODEX_EXEC_FULL_AUTO, true),
      dangerouslyBypassApprovals: normalizeBoolean(env.CODEX_EXEC_DANGEROUSLY_BYPASS_APPROVALS_AND_SANDBOX, false),
      skipGitRepoCheck: normalizeBoolean(env.CODEX_EXEC_SKIP_GIT_REPO_CHECK, true),
      additionalWritableDirs: normalizePathList(env.CODEX_EXEC_ADDITIONAL_WRITE_DIRS),
      timeoutMs: normalizePositiveNumber(env.CODEX_EXEC_TIMEOUT_MS, 10 * 60 * 1000)
    },
    cacheEnabled: normalizeBoolean(env.LLM_PROXY_CACHE_ENABLED, true),
    cacheDir: normalizeNonEmpty(env.LLM_PROXY_CACHE_DIR) ?? '.cache/llm-proxy',
    cacheTtlMs: normalizeOptionalNumber(env.LLM_PROXY_CACHE_TTL_MS),
    cacheMaxBodyBytes: normalizePositiveNumber(env.LLM_PROXY_CACHE_MAX_BODY_BYTES, 20 * 1024 * 1024),
    proxyUsers: parseProxyUsers(env.LLM_PROXY_USERS),
    sessionCookieName: normalizeNonEmpty(env.LLM_PROXY_SESSION_COOKIE_NAME) ?? 'llm_proxy_session',
    sessionTtlMs: normalizePositiveNumber(env.LLM_PROXY_SESSION_TTL_MS, 30 * 24 * 60 * 60 * 1000),
    sessionCookieSecure: normalizeBoolean(env.LLM_PROXY_SESSION_COOKIE_SECURE, false),
    proxyAppDir: normalizeNonEmpty(env.LLM_PROXY_APP_DIR) ?? 'testApp/dist'
  };
}

function normalizePort(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '8787', 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 8787;
}

function normalizeNonEmpty(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = normalizeNonEmpty(value)?.toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return fallback;
}

function normalizeOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return undefined;
}

function normalizePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = normalizeOptionalNumber(value);
  return parsed ?? fallback;
}

function normalizeUrl(value: string | undefined, fallback: string): string {
  const normalized = normalizeNonEmpty(value);
  return normalized ? normalized.replace(/\/+$/, '') : fallback;
}

function normalizeCodexSandboxMode(value: string | undefined): CodexExecConfig['sandboxMode'] {
  const normalized = normalizeNonEmpty(value)?.toLowerCase();
  if (normalized === 'read-only' || normalized === 'workspace-write' || normalized === 'danger-full-access') {
    return normalized;
  }
  return 'workspace-write';
}

function normalizePathList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function readRawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readRawBody(request);
  if (body.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(body.toString('utf-8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function readUpstreamResponse(upstreamResponse: Response): Promise<ProxyResponseData> {
  const body = Buffer.from(await upstreamResponse.arrayBuffer());
  const headers: Record<string, string> = {
    'Content-Type': upstreamResponse.headers.get('content-type') ?? 'application/json; charset=utf-8'
  };

  const cacheControl = upstreamResponse.headers.get('cache-control');
  if (cacheControl) {
    headers['Cache-Control'] = cacheControl;
  }

  return {
    status: upstreamResponse.status,
    headers,
    body
  };
}

function writeProxyResponse(
  response: ServerResponse,
  payload: ProxyResponseData,
  cacheStatus: 'HIT' | 'MISS' | 'BYPASS',
  cacheKey: string,
  bodyHash: string,
  cachedAt?: number
): void {
  const headers: Record<string, string> = {
    ...payload.headers,
    'Content-Length': String(payload.body.length),
    'X-LLM-Proxy-Cache': cacheStatus,
    'X-LLM-Proxy-Cache-Key': cacheKey,
    'X-LLM-Proxy-Body-Hash': bodyHash
  };

  if (typeof cachedAt === 'number') {
    headers['X-LLM-Proxy-Cached-At'] = new Date(cachedAt).toISOString();
  }

  response.writeHead(payload.status, headers);
  response.end(payload.body);
}

function writeCorsHeaders(response: ServerResponse, origin: string): void {
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-LLM-Proxy-Auth,X-LLM-Proxy-Cache');
  response.setHeader(
    'Access-Control-Expose-Headers',
    'X-LLM-Proxy-Cache,X-LLM-Proxy-Cache-Key,X-LLM-Proxy-Body-Hash,X-LLM-Proxy-Cached-At'
  );
}

function sendJson(response: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function readHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function stripKnownPrefix(pathname: string, prefixes: string[]): string | null {
  for (const prefix of prefixes) {
    if (pathname.startsWith(prefix)) {
      return pathname.slice(prefix.length);
    }
  }
  return null;
}

function isCacheableResponse(status: number): boolean {
  return status >= 200 && status < 300;
}

function shouldBypassCache(request: IncomingMessage, requestUrl: URL): boolean {
  const header = readHeaderValue(request.headers['x-llm-proxy-cache'])?.trim().toLowerCase();
  if (header === 'bypass' || header === 'refresh') {
    return true;
  }
  const query = requestUrl.searchParams.get('cache')?.trim().toLowerCase();
  return query === 'bypass' || query === 'refresh';
}
