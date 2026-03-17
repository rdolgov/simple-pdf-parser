import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { FileResponseCache } from './requestCache.js';

type ServerConfig = {
  port: number;
  proxyAuthToken?: string;
  corsOrigin: string;
  openAiBaseUrl: string;
  openAiApiKey?: string;
  geminiBaseUrl: string;
  geminiApiKey?: string;
  cacheEnabled: boolean;
  cacheDir: string;
  cacheTtlMs?: number;
  cacheMaxBodyBytes: number;
};

type ProxyResponseData = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

const OPENAI_PROXY_PREFIX = '/api/llm/openai/';
const GEMINI_PROXY_PREFIX = '/api/llm/gemini/';

const config = loadConfig();
const responseCache = new FileResponseCache({
  enabled: config.cacheEnabled,
  cacheDir: config.cacheDir,
  ttlMs: config.cacheTtlMs,
  maxBodyBytes: config.cacheMaxBodyBytes
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
  console.log('[llm-proxy] OpenAI route:', `${OPENAI_PROXY_PREFIX}responses`);
  console.log('[llm-proxy] Gemini route:', `${GEMINI_PROXY_PREFIX}v1beta/models/{model}:generateContent`);
  console.log(
    '[llm-proxy] Cache:',
    responseCache.isEnabled()
      ? `enabled dir=${responseCache.getCacheDir()} ttlMs=${responseCache.getTtlMs() ?? 'none'}`
      : 'disabled'
  );
});

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  writeCorsHeaders(response, config.corsOrigin);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (request.method === 'GET' && requestUrl.pathname === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(
      JSON.stringify({
        ok: true,
        providers: {
          openai: Boolean(config.openAiApiKey),
          gemini: Boolean(config.geminiApiKey)
        },
        cache: {
          enabled: config.cacheEnabled,
          dir: config.cacheDir,
          ttlMs: config.cacheTtlMs ?? null,
          maxBodyBytes: config.cacheMaxBodyBytes
        }
      })
    );
    return;
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Only POST is supported for proxy routes.' });
    return;
  }

  if (requestUrl.pathname.startsWith(OPENAI_PROXY_PREFIX)) {
    await proxyOpenAiRequest(request, response, requestUrl, config);
    return;
  }

  if (requestUrl.pathname.startsWith(GEMINI_PROXY_PREFIX)) {
    await proxyGeminiRequest(request, response, requestUrl, config);
    return;
  }

  sendJson(response, 404, { error: 'Unknown proxy route.' });
}

async function proxyOpenAiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  currentConfig: ServerConfig
): Promise<void> {
  if (!isAuthorized(request, requestUrl, currentConfig.proxyAuthToken)) {
    sendJson(response, 401, { error: 'Proxy authorization failed.' });
    return;
  }

  if (!currentConfig.openAiApiKey) {
    sendJson(response, 500, { error: 'OPENAI_API_KEY is not configured on the proxy server.' });
    return;
  }

  const upstreamPath = requestUrl.pathname.slice(OPENAI_PROXY_PREFIX.length);
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
  currentConfig: ServerConfig
): Promise<void> {
  if (!isAuthorized(request, requestUrl, currentConfig.proxyAuthToken)) {
    sendJson(response, 401, { error: 'Proxy authorization failed.' });
    return;
  }

  if (!currentConfig.geminiApiKey) {
    sendJson(response, 500, { error: 'GEMINI_API_KEY is not configured on the proxy server.' });
    return;
  }

  const upstreamPath = requestUrl.pathname.slice(GEMINI_PROXY_PREFIX.length);
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

function isAllowedOpenAiPath(pathname: string): boolean {
  return pathname === 'responses' || pathname === 'embeddings' || pathname === 'images/generations';
}

function isAllowedGeminiPath(pathname: string): boolean {
  return /^v[0-9a-z]+(?:[a-z]*)\/models\/[^/]+:(generateContent|batchEmbedContents|embedContent)$/i.test(pathname);
}

function isAuthorized(request: IncomingMessage, requestUrl: URL, expectedToken?: string): boolean {
  if (!expectedToken) {
    return true;
  }

  const headerValue = request.headers.authorization?.trim();
  if (headerValue === `Bearer ${expectedToken}`) {
    return true;
  }

  const alternateHeader = request.headers['x-llm-proxy-auth'];
  if (typeof alternateHeader === 'string' && alternateHeader.trim() === expectedToken) {
    return true;
  }

  const queryToken = requestUrl.searchParams.get('key')?.trim();
  return queryToken === expectedToken;
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
    cacheEnabled: normalizeBoolean(env.LLM_PROXY_CACHE_ENABLED, true),
    cacheDir: normalizeNonEmpty(env.LLM_PROXY_CACHE_DIR) ?? '.cache/llm-proxy',
    cacheTtlMs: normalizeOptionalNumber(env.LLM_PROXY_CACHE_TTL_MS),
    cacheMaxBodyBytes: normalizePositiveNumber(env.LLM_PROXY_CACHE_MAX_BODY_BYTES, 20 * 1024 * 1024)
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
