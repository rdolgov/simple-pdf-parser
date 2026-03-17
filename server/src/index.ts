import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

type ProviderName = 'openai' | 'gemini';

type ServerConfig = {
  port: number;
  proxyAuthToken?: string;
  corsOrigin: string;
  openAiBaseUrl: string;
  openAiApiKey?: string;
  geminiBaseUrl: string;
  geminiApiKey?: string;
};

const OPENAI_PROXY_PREFIX = '/api/llm/openai/';
const GEMINI_PROXY_PREFIX = '/api/llm/gemini/';

const config = loadConfig();

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

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        Accept: request.headers.accept ?? 'application/json',
        Authorization: `Bearer ${currentConfig.openAiApiKey}`,
        'Content-Type': request.headers['content-type'] ?? 'application/json'
      },
      body
    });
  } catch (error) {
    console.error('[llm-proxy] OpenAI upstream request failed', error);
    sendJson(response, 502, { error: 'Failed to reach OpenAI upstream.' });
    return;
  }

  await writeUpstreamResponse(response, upstreamResponse);
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

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        Accept: request.headers.accept ?? 'application/json',
        'Content-Type': request.headers['content-type'] ?? 'application/json'
      },
      body
    });
  } catch (error) {
    console.error('[llm-proxy] Gemini upstream request failed', error);
    sendJson(response, 502, { error: 'Failed to reach Gemini upstream.' });
    return;
  }

  await writeUpstreamResponse(response, upstreamResponse);
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
    geminiApiKey: normalizeNonEmpty(env.GEMINI_API_KEY)
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

async function writeUpstreamResponse(response: ServerResponse, upstreamResponse: Response): Promise<void> {
  const body = Buffer.from(await upstreamResponse.arrayBuffer());
  const headers: Record<string, string> = {
    'Content-Type': upstreamResponse.headers.get('content-type') ?? 'application/json; charset=utf-8'
  };

  const cacheControl = upstreamResponse.headers.get('cache-control');
  if (cacheControl) {
    headers['Cache-Control'] = cacheControl;
  }

  response.writeHead(upstreamResponse.status, headers);
  response.end(body);
}

function writeCorsHeaders(response: ServerResponse, origin: string): void {
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-LLM-Proxy-Auth');
}

function sendJson(response: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}
