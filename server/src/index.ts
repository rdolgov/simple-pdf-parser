import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isBackofficeAllowedUser, listBackofficeAllowedUsers } from './backofficeUsers.js';
import { executeCodexResponses, type CodexExecConfig, type CodexProxyResponse } from './codexExecProxy.js';
import { renderGeminiBackofficeHtml } from './geminiBackoffice.js';
import { GeminiAnalyticsStore } from './geminiAnalyticsStore.js';
import { resolveGeminiProxyUpstreamPath } from './geminiProxyModel.js';
import { extractGeminiUsageMetadata } from './geminiUsageMetadata.js';
import {
  ProxyAsyncJobStore,
  type ProxyAsyncCacheStatus,
  type ProxyAsyncJobProvider,
  type ProxyAsyncJobResponse,
  type ProxyAsyncJobSnapshot
} from './proxyAsyncJobs.js';
import { summarizeCodexResponsesBody } from './codexRequestIntents.js';
import { FileResponseCache } from './requestCache.js';
import { loadLocalEnvFiles } from './loadLocalEnv.js';
import { ProxySessionAuth, parseProxyUsers } from './sessionAuth.js';
import { StaticProxyApp } from './staticProxyApp.js';

type ServerConfig = {
  host: string;
  port: number;
  proxyAuthToken?: string;
  corsOrigin: string;
  openAiBaseUrl: string;
  openAiApiKey?: string;
  geminiBaseUrl: string;
  geminiApiKey?: string;
  geminiModel: string;
  geminiBinaryInputModel?: string;
  geminiAnalytics: {
    dataDir: string;
    retentionDays: number;
    dailyMaxCalls: number;
    dailyMaxTotalTokens: number;
  };
  codexExec: CodexExecConfig;
  cacheEnabled: boolean;
  cacheDir: string;
  cacheTtlMs?: number;
  cacheMaxBodyBytes: number;
  asyncJobs: {
    retentionMs: number;
    maxJobs: number;
    pollIntervalMs: number;
  };
  proxyUsers: Map<string, string>;
  sessionCookieName: string;
  sessionTtlMs: number;
  sessionCookieSecure: boolean;
  proxyAppDir: string;
  rootRedirectPath?: string;
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
const JOBS_PROXY_PREFIX = '/api/llm/jobs/';
const PROXY_OPENAI_PROXY_PREFIX = '/proxy/api/llm/openai/';
const PROXY_GEMINI_PROXY_PREFIX = '/proxy/api/llm/gemini/';
const PROXY_CODEX_PROXY_PREFIX = '/proxy/api/llm/codex/';
const PROXY_JOBS_PROXY_PREFIX = '/proxy/api/llm/jobs/';
const HEALTH_PATHS = new Set(['/health', '/api/health', '/proxy/api/health']);
const AUTH_SESSION_PATHS = new Set(['/api/auth/session', '/proxy/api/auth/session']);
const AUTH_LOGIN_PATHS = new Set(['/api/auth/login', '/proxy/api/auth/login']);
const AUTH_LOGOUT_PATHS = new Set(['/api/auth/logout', '/proxy/api/auth/logout']);
const BACKOFFICE_ANALYTICS_HTML_PATHS = new Set([
  '/backoffice/gemini-analytics',
  '/proxy/backoffice/gemini-analytics'
]);
const BACKOFFICE_ANALYTICS_API_PATHS = new Set([
  '/api/backoffice/gemini-analytics',
  '/proxy/api/backoffice/gemini-analytics'
]);

loadLocalEnvFiles();
const config = loadConfig();
const responseCache = new FileResponseCache({
  enabled: config.cacheEnabled,
  cacheDir: config.cacheDir,
  ttlMs: config.cacheTtlMs,
  maxBodyBytes: config.cacheMaxBodyBytes
});
const asyncJobStore = new ProxyAsyncJobStore(config.asyncJobs);
const geminiAnalyticsStore = new GeminiAnalyticsStore(config.geminiAnalytics);
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
let proxyRequestSequence = 0;

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    console.error('[llm-proxy] Unhandled request error', error);
    if (!response.headersSent) {
      writeCorsHeaders(response, config.corsOrigin);
      writeSecurityHeaders(response);
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    response.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unexpected proxy error.'
      })
    );
  });
});

server.listen(config.port, config.host, () => {
  console.log(`[llm-proxy] Listening on http://${config.host}:${config.port}`);
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
  console.log(
    '[llm-proxy] Async jobs:',
    `enabled pollIntervalMs=${config.asyncJobs.pollIntervalMs} retentionMs=${config.asyncJobs.retentionMs} maxJobs=${config.asyncJobs.maxJobs}`
  );
  console.log(
    '[llm-proxy] Gemini analytics:',
    `dir=${config.geminiAnalytics.dataDir} retentionDays=${config.geminiAnalytics.retentionDays} dailyMaxCalls=${config.geminiAnalytics.dailyMaxCalls} dailyMaxTotalTokens=${config.geminiAnalytics.dailyMaxTotalTokens}`
  );
  console.log(
    '[llm-proxy] Backoffice:',
    `${[...BACKOFFICE_ANALYTICS_HTML_PATHS].join(', ')} users=${listBackofficeAllowedUsers().join(',') || 'none'}`
  );
  console.log('[llm-proxy] Proxy app route:', `${PROXY_APP_PREFIX} -> ${staticProxyApp.appDir}`);
  console.log('[llm-proxy] Root redirect:', config.rootRedirectPath ? `/ -> ${config.rootRedirectPath}` : 'disabled');
});

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  writeCorsHeaders(response, config.corsOrigin);
  writeSecurityHeaders(response);

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
        modelSelection: {
          gemini: {
            textModel: config.geminiModel,
            binaryInputModel: config.geminiBinaryInputModel ?? null
          }
        },
        analytics: {
          gemini: {
            dataDir: config.geminiAnalytics.dataDir,
            retentionDays: config.geminiAnalytics.retentionDays,
            dailyMaxCalls: config.geminiAnalytics.dailyMaxCalls,
            dailyMaxTotalTokens: config.geminiAnalytics.dailyMaxTotalTokens,
            backofficeUsers: listBackofficeAllowedUsers()
          }
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
        asyncJobs: {
          pollIntervalMs: config.asyncJobs.pollIntervalMs,
          retentionMs: config.asyncJobs.retentionMs,
          maxJobs: config.asyncJobs.maxJobs
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

  if (request.method === 'GET' && BACKOFFICE_ANALYTICS_API_PATHS.has(requestUrl.pathname)) {
    await handleGeminiBackofficeApiRequest(request, response);
    return;
  }

  if (request.method === 'GET' && BACKOFFICE_ANALYTICS_HTML_PATHS.has(requestUrl.pathname)) {
    await handleGeminiBackofficeHtmlRequest(request, response);
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
    const jobId = stripKnownPrefix(requestUrl.pathname, [JOBS_PROXY_PREFIX, PROXY_JOBS_PROXY_PREFIX]);
    if (jobId !== null && jobId.length > 0) {
      handleAsyncJobStatusRequest(request, response, requestUrl, jobId, config);
      return;
    }
    if (requestUrl.pathname === '/' && config.rootRedirectPath) {
      response.writeHead(302, { Location: config.rootRedirectPath });
      response.end();
      return;
    }
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
  const requestKind = normalizeRequestKind('openai', upstreamPath);
  const startedAt = Date.now();
  const sequence = ++proxyRequestSequence;
  logProxyRequest('openai', requestKind, requestUrl.pathname);

  if (!isAuthorized(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth)) {
    sendJson(response, 401, { error: 'Proxy authorization failed.' });
    logProxyCompletion({
      sequence,
      provider: 'openai',
      requestKind,
      cacheStatus: 'ERROR',
      durationMs: Date.now() - startedAt,
      extras: 'status=401'
    });
    return;
  }

  if (!currentConfig.openAiApiKey) {
    sendJson(response, 500, { error: 'OPENAI_API_KEY is not configured on the proxy server.' });
    logProxyCompletion({
      sequence,
      provider: 'openai',
      requestKind,
      cacheStatus: 'ERROR',
      durationMs: Date.now() - startedAt,
      extras: 'status=500'
    });
    return;
  }

  if (!isAllowedOpenAiPath(upstreamPath)) {
    sendJson(response, 404, { error: 'Unsupported OpenAI proxy path.' });
    logProxyCompletion({
      sequence,
      provider: 'openai',
      requestKind,
      cacheStatus: 'ERROR',
      durationMs: Date.now() - startedAt,
      extras: 'status=404'
    });
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
      logProxyCompletion({
        sequence,
        provider: 'openai',
        requestKind,
        cacheStatus: 'HIT',
        durationMs: Date.now() - startedAt
      });
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

  if (maybeHandleAsyncProxyJob(request, response, requestUrl, {
    provider: 'openai',
    requestKind,
    sequence,
    startedAt,
    cacheStatus: bypassCache ? 'BYPASS' : 'MISS',
    cacheKey,
    bodyHash,
    runner: async (logProgress) => {
      logProgress(`requesting upstream ${upstreamPath}`);
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
        return createJsonErrorResponse(502, 'Failed to reach OpenAI upstream.');
      }

      logProgress(`received upstream status=${upstreamResponse.status}`);
      const upstream = await readUpstreamResponse(upstreamResponse);
      if (isCacheableResponse(upstream.status)) {
        try {
          await responseCache.set(cacheKey, upstream);
        } catch (error) {
          console.warn('[llm-proxy] Failed to store OpenAI cache entry', error);
        }
      }
      return upstream;
    }
  })) {
    return;
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
    logProxyCompletion({
      sequence,
      provider: 'openai',
      requestKind,
      cacheStatus: 'ERROR',
      durationMs: Date.now() - startedAt,
      extras: 'status=502'
    });
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
  logProxyCompletion({
    sequence,
    provider: 'openai',
    requestKind,
    cacheStatus: bypassCache ? 'BYPASS' : 'MISS',
    durationMs: Date.now() - startedAt,
    extras: `status=${upstream.status}`
  });
  writeProxyResponse(response, upstream, bypassCache ? 'BYPASS' : 'MISS', cacheKey, bodyHash);
}

async function proxyGeminiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  upstreamPath: string,
  currentConfig: ServerConfig
): Promise<void> {
  const requestKind = normalizeRequestKind('gemini', upstreamPath);
  const startedAt = Date.now();
  const sequence = ++proxyRequestSequence;
  logProxyRequest('gemini', requestKind, requestUrl.pathname);

  if (!isAuthorized(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth)) {
    sendJson(response, 401, { error: 'Proxy authorization failed.' });
    logProxyCompletion({
      sequence,
      provider: 'gemini',
      requestKind,
      cacheStatus: 'ERROR',
      durationMs: Date.now() - startedAt,
      extras: 'status=401'
    });
    return;
  }

  const actor = resolveRequestActor(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth);

  if (!currentConfig.geminiApiKey) {
    sendJson(response, 500, { error: 'GEMINI_API_KEY is not configured on the proxy server.' });
    logProxyCompletion({
      sequence,
      provider: 'gemini',
      requestKind,
      cacheStatus: 'ERROR',
      durationMs: Date.now() - startedAt,
      extras: 'status=500'
    });
    return;
  }

  if (!isAllowedGeminiPath(upstreamPath)) {
    sendJson(response, 404, { error: 'Unsupported Gemini proxy path.' });
    logProxyCompletion({
      sequence,
      provider: 'gemini',
      requestKind,
      cacheStatus: 'ERROR',
      durationMs: Date.now() - startedAt,
      extras: 'status=404'
    });
    return;
  }

  const body = await readRawBody(request);
  const modelSelection = resolveGeminiProxyUpstreamPath(upstreamPath, body, {
    textModel: currentConfig.geminiModel,
    binaryInputModel: currentConfig.geminiBinaryInputModel
  });
  const resolvedUpstreamPath = modelSelection.upstreamPath;
  const upstreamUrl = new URL(joinUrl(currentConfig.geminiBaseUrl, resolvedUpstreamPath));
  const searchParams = new URLSearchParams(requestUrl.searchParams);
  searchParams.set('key', currentConfig.geminiApiKey);
  upstreamUrl.search = searchParams.toString();
  console.log(
    `[llm-proxy] seq=${sequence} gemini model mode=${modelSelection.mode} requested=${modelSelection.requestedModel ?? 'n/a'} selected=${modelSelection.selectedModel ?? 'n/a'}`
  );
  const accept = readHeaderValue(request.headers.accept);
  const contentType = readHeaderValue(request.headers['content-type']);
  const cacheEntry = responseCache.buildKey({
    provider: 'gemini',
    upstreamBaseUrl: currentConfig.geminiBaseUrl,
    upstreamPath: resolvedUpstreamPath,
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
      logProxyCompletion({
        sequence,
        provider: 'gemini',
        requestKind,
        cacheStatus: 'HIT',
        durationMs: Date.now() - startedAt
      });
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

  if (maybeHandleAsyncProxyJob(request, response, requestUrl, {
    provider: 'gemini',
    requestKind,
    sequence,
    startedAt,
    cacheStatus: bypassCache ? 'BYPASS' : 'MISS',
    cacheKey,
    bodyHash,
    runner: async (logProgress) => {
      const upstream = await executeGeminiUpstreamRequest({
        actor,
        requestKind,
        model: modelSelection.selectedModel ?? modelSelection.requestedModel ?? 'unknown',
        sequence,
        upstreamUrl,
        upstreamPath: resolvedUpstreamPath,
        accept,
        contentType,
        body,
        logProgress
      });
      if (isCacheableResponse(upstream.status)) {
        try {
          await responseCache.set(cacheKey, upstream);
        } catch (error) {
          console.warn('[llm-proxy] Failed to store Gemini cache entry', error);
        }
      }
      return upstream;
    },
    completionExtras: () => `model=${modelSelection.selectedModel ?? 'n/a'}`
  })) {
    return;
  }

  const upstream = await executeGeminiUpstreamRequest({
    actor,
    requestKind,
    model: modelSelection.selectedModel ?? modelSelection.requestedModel ?? 'unknown',
    sequence,
    upstreamUrl,
    upstreamPath: resolvedUpstreamPath,
    accept,
    contentType,
    body
  });
  if (isCacheableResponse(upstream.status)) {
    try {
      await responseCache.set(cacheKey, upstream);
    } catch (error) {
      console.warn('[llm-proxy] Failed to store Gemini cache entry', error);
    }
  }
  logProxyCompletion({
    sequence,
    provider: 'gemini',
    requestKind,
    cacheStatus: bypassCache ? 'BYPASS' : 'MISS',
    durationMs: Date.now() - startedAt,
    extras: `status=${upstream.status} model=${modelSelection.selectedModel ?? 'n/a'}`
  });
  writeProxyResponse(response, upstream, bypassCache ? 'BYPASS' : 'MISS', cacheKey, bodyHash);
}

async function proxyCodexRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  upstreamPath: string,
  currentConfig: ServerConfig
): Promise<void> {
  const requestKind = normalizeRequestKind('codex', upstreamPath);
  const startedAt = Date.now();
  const sequence = ++proxyRequestSequence;

  if (!isAuthorized(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth)) {
    sendJson(response, 401, { error: 'Proxy authorization failed.' });
    logProxyCompletion({
      sequence,
      provider: 'codex',
      requestKind,
      cacheStatus: 'ERROR',
      durationMs: Date.now() - startedAt,
      extras: 'status=401'
    });
    return;
  }

  if (!currentConfig.codexExec.enabled) {
    sendJson(response, 500, { error: 'CODEX_EXEC_ENABLED is not configured on the proxy server.' });
    logProxyCompletion({
      sequence,
      provider: 'codex',
      requestKind,
      cacheStatus: 'ERROR',
      durationMs: Date.now() - startedAt,
      extras: 'status=500'
    });
    return;
  }

  if (!isAllowedCodexPath(upstreamPath)) {
    sendJson(response, 404, { error: 'Unsupported Codex proxy path.' });
    logProxyCompletion({
      sequence,
      provider: 'codex',
      requestKind,
      cacheStatus: 'ERROR',
      durationMs: Date.now() - startedAt,
      extras: 'status=404'
    });
    return;
  }

  const body = await readRawBody(request);
  const codexSummary = summarizeCodexResponsesBody(body);
  logCodexProxyRequest({
    sequence,
    pathname: requestUrl.pathname,
    requestKind,
    model: codexSummary.model,
    intent: codexSummary.intent,
    textChars: codexSummary.textChars,
    attachmentCount: codexSummary.attachmentCount
  });
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
      logProxyCompletion({
        sequence,
        provider: 'codex',
        requestKind,
        cacheStatus: 'HIT',
        durationMs: Date.now() - startedAt,
        extras: `intent=${codexSummary.intent}`
      });
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

  if (maybeHandleAsyncProxyJob(request, response, requestUrl, {
    provider: 'codex',
    requestKind,
    sequence,
    startedAt,
    cacheStatus: bypassCache ? 'BYPASS' : 'MISS',
    cacheKey,
    bodyHash,
    runner: async (logProgress) => {
      let upstream: CodexProxyResponse;
      try {
        upstream = await executeCodexResponses(body, currentConfig.codexExec, (event) => {
          if (event.type === 'workspace') {
            const message =
              `workspace intent=${event.intent} keep=${event.keepWorkspace ? 'true' : 'false'} dir=${event.workspaceDir}` +
              `${event.artifactPaths.length > 0 ? ` artifacts=${event.artifactPaths.join(',')}` : ''}`;
            logCodexProxyEvent(sequence, message);
            logProgress(message);
            return;
          }
          const message = event.type === 'phase' ? event.message : `${event.stream} ${event.line}`;
          logCodexProxyEvent(sequence, message);
          logProgress(message);
        });
      } catch (error) {
        console.error('[llm-proxy] Codex exec request failed', error);
        return createJsonErrorResponse(
          502,
          error instanceof Error ? error.message : 'Failed to execute codex exec.'
        );
      }

      return upstream;
    },
    completionExtras: (job) => `intent=${codexSummary.intent} job=${job.id}`
  })) {
    return;
  }

  let upstream: CodexProxyResponse;
  try {
    upstream = await executeCodexResponses(body, currentConfig.codexExec, (event) => {
      if (event.type === 'workspace') {
        logCodexProxyEvent(
          sequence,
          `workspace intent=${event.intent} keep=${event.keepWorkspace ? 'true' : 'false'} dir=${event.workspaceDir}${event.artifactPaths.length > 0 ? ` artifacts=${event.artifactPaths.join(',')}` : ''}`
        );
        return;
      }
      if (event.type === 'phase') {
        logCodexProxyEvent(sequence, event.message);
        return;
      }
      logCodexProxyEvent(sequence, `${event.stream} ${event.line}`);
    });
  } catch (error) {
    console.error('[llm-proxy] Codex exec request failed', error);
    logProxyCompletion({
      sequence,
      provider: 'codex',
      requestKind,
      cacheStatus: 'ERROR',
      durationMs: Date.now() - startedAt,
      extras: `intent=${codexSummary.intent}`
    });
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
  logProxyCompletion({
    sequence,
    provider: 'codex',
    requestKind,
    cacheStatus: bypassCache ? 'BYPASS' : 'MISS',
    durationMs: Date.now() - startedAt,
    extras: `intent=${codexSummary.intent} workspace=${upstream.debug.workspaceDir} kept=${upstream.debug.keptWorkspace ? 'true' : 'false'}`
  });
  writeProxyResponse(response, upstream, bypassCache ? 'BYPASS' : 'MISS', cacheKey, bodyHash);
}

async function executeGeminiUpstreamRequest(input: {
  actor: string;
  requestKind: string;
  model: string;
  sequence: number;
  upstreamUrl: URL;
  upstreamPath: string;
  accept: string | undefined;
  contentType: string | undefined;
  body: Buffer;
  logProgress?: (message: string) => void;
}): Promise<ProxyAsyncJobResponse> {
  const startedAt = Date.now();
  const begin = await geminiAnalyticsStore.beginRequest({
    actor: input.actor,
    model: input.model,
    requestKind: input.requestKind
  });

  if (!begin.allowed) {
    input.logProgress?.(`blocked by Gemini daily limits day=${begin.day}`);
    return createJsonErrorResponse(429, begin.reason, {
      code: 'GEMINI_DAILY_LIMIT_REACHED',
      day: begin.day,
      usage: begin.snapshot.totals
    }, {
      'Retry-After': '3600'
    });
  }

  input.logProgress?.(`requesting upstream ${input.upstreamPath} actor=${input.actor}`);

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(input.upstreamUrl, {
      method: 'POST',
      headers: {
        Accept: input.accept ?? 'application/json',
        'Content-Type': input.contentType ?? 'application/json'
      },
      body: input.body
    });
  } catch (error) {
    console.error('[llm-proxy] Gemini upstream request failed', error);
    await geminiAnalyticsStore.finalizeRequest({
      reservationId: begin.reservationId,
      status: 502,
      durationMs: Date.now() - startedAt,
      usage: null
    });
    return createJsonErrorResponse(502, 'Failed to reach Gemini upstream.');
  }

  input.logProgress?.(`received upstream status=${upstreamResponse.status}`);
  const upstream = await readUpstreamResponse(upstreamResponse);
  const usage = extractGeminiUsageMetadata(upstream.body);
  if (usage) {
    input.logProgress?.(
      `usage input=${usage.inputTokens} output=${usage.outputTokens} total=${usage.totalTokens}`
    );
  }

  await geminiAnalyticsStore.finalizeRequest({
    reservationId: begin.reservationId,
    status: upstream.status,
    durationMs: Date.now() - startedAt,
    usage
  });

  return upstream;
}

function maybeHandleAsyncProxyJob(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  input: {
    provider: ProxyAsyncJobProvider;
    requestKind: string;
    sequence: number;
    startedAt: number;
    cacheStatus: ProxyAsyncCacheStatus;
    cacheKey: string;
    bodyHash: string;
    runner: (logProgress: (message: string) => void) => Promise<ProxyAsyncJobResponse>;
    completionExtras?: (job: ProxyAsyncJobSnapshot) => string;
  }
): boolean {
  if (!isAsyncPollRequested(request, requestUrl)) {
    return false;
  }

  const { job, reused } = asyncJobStore.createOrReuse({
    provider: input.provider,
    requestKind: input.requestKind,
    cacheKey: input.cacheKey,
    bodyHash: input.bodyHash,
    cacheStatus: input.cacheStatus,
    sequence: input.sequence
  });
  const pollPath = buildAsyncJobPollPath(requestUrl.pathname, job.id);

  if (reused) {
    console.log(
      `[llm-proxy] seq=${input.sequence} job reuse provider=${input.provider} kind=${input.requestKind} job=${job.id} status=${job.state}`
    );
  } else {
    console.log(
      `[llm-proxy] seq=${input.sequence} job create provider=${input.provider} kind=${input.requestKind} job=${job.id} poll=${pollPath}`
    );
    void runAsyncProxyJob(job.id, input);
  }

  writeAsyncJobAccepted(response, job, pollPath, config.asyncJobs.pollIntervalMs);
  return true;
}

async function runAsyncProxyJob(
  jobId: string,
  input: {
    provider: ProxyAsyncJobProvider;
    requestKind: string;
    sequence: number;
    startedAt: number;
    cacheStatus: ProxyAsyncCacheStatus;
    runner: (logProgress: (message: string) => void) => Promise<ProxyAsyncJobResponse>;
    completionExtras?: (job: ProxyAsyncJobSnapshot) => string;
  }
): Promise<void> {
  asyncJobStore.markRunning(jobId, 'job started');
  try {
    const response = await input.runner((message) => {
      asyncJobStore.appendEvent(jobId, message);
    });
    asyncJobStore.complete(jobId, response);
    const snapshot = asyncJobStore.get(jobId);
    const finalStatus =
      response.status >= 400
        ? 'ERROR'
        : input.cacheStatus;
    logProxyCompletion({
      sequence: input.sequence,
      provider: input.provider,
      requestKind: input.requestKind,
      cacheStatus: finalStatus,
      durationMs: Date.now() - input.startedAt,
      extras: [
        `job=${jobId}`,
        `status=${response.status}`,
        snapshot && input.completionExtras ? input.completionExtras(snapshot) : ''
      ].filter(Boolean).join(' ')
    });
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Async proxy job failed.';
    console.error('[llm-proxy] Async proxy job failed', error);
    asyncJobStore.complete(jobId, createJsonErrorResponse(502, message));
    logProxyCompletion({
      sequence: input.sequence,
      provider: input.provider,
      requestKind: input.requestKind,
      cacheStatus: 'ERROR',
      durationMs: Date.now() - input.startedAt,
      extras: `job=${jobId} status=502`
    });
  }
}

function handleAsyncJobStatusRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  jobId: string,
  currentConfig: ServerConfig
): void {
  if (!isAuthorized(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth)) {
    sendJson(response, 401, { error: 'Proxy authorization failed.' });
    return;
  }

  const job = asyncJobStore.get(jobId);
  if (!job) {
    sendJson(response, 404, { error: 'Unknown async proxy job.' });
    return;
  }

  const pollPath = buildAsyncJobPollPath(requestUrl.pathname, job.id);
  if (job.state === 'pending' || job.state === 'running') {
    writeAsyncJobAccepted(response, job, pollPath, asyncJobStore.getPollIntervalMs());
    return;
  }

  const result = asyncJobStore.getResponse(jobId);
  if (!result) {
    sendJson(response, 500, { error: 'Async proxy job completed without a response payload.' });
    return;
  }

  writeProxyResponse(
    response,
    result,
    job.cacheStatus,
    job.cacheKey,
    job.bodyHash,
    undefined,
    {
      'Cache-Control': 'no-store',
      'X-LLM-Proxy-Job-Id': job.id,
      'X-LLM-Proxy-Async-Status': job.state
    }
  );
}

function isAsyncPollRequested(request: IncomingMessage, requestUrl: URL): boolean {
  const header = readHeaderValue(request.headers['x-llm-proxy-async'])?.trim().toLowerCase();
  if (header === 'poll') {
    return true;
  }
  const query = requestUrl.searchParams.get('async')?.trim().toLowerCase();
  return query === 'poll';
}

function buildAsyncJobPollPath(pathname: string, jobId: string): string {
  const prefix = pathname.startsWith(PROXY_APP_PREFIX) ? PROXY_JOBS_PROXY_PREFIX : JOBS_PROXY_PREFIX;
  return `${prefix}${encodeURIComponent(jobId)}`;
}

function writeAsyncJobAccepted(
  response: ServerResponse,
  job: ProxyAsyncJobSnapshot,
  pollPath: string,
  pollIntervalMs: number
): void {
  const retryAfterSeconds = Math.max(1, Math.ceil(pollIntervalMs / 1000));
  response.writeHead(202, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Location: pollPath,
    'Retry-After': String(retryAfterSeconds),
    'X-LLM-Proxy-Job-Id': job.id,
    'X-LLM-Proxy-Async-Status': job.state
  });
  response.end(JSON.stringify({
    jobId: job.id,
    status: job.state,
    provider: job.provider,
    requestKind: job.requestKind,
    pollUrl: pollPath,
    retryAfterMs: pollIntervalMs,
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
    ...(job.lastEvent ? { lastEvent: job.lastEvent } : {})
  }));
}

function createJsonErrorResponse(
  status: number,
  error: string,
  extraBody: Record<string, unknown> = {},
  extraHeaders: Record<string, string> = {}
): ProxyAsyncJobResponse {
  return {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders
    },
    body: Buffer.from(JSON.stringify({ error, ...extraBody }), 'utf8')
  };
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

function logProxyRequest(provider: 'openai' | 'gemini' | 'codex', requestKind: string, pathname: string): void {
  console.log(`[llm-proxy] request provider=${provider} kind=${requestKind} path=${pathname}`);
}

function logCodexProxyRequest(input: {
  sequence: number;
  pathname: string;
  requestKind: string;
  model?: string;
  intent: string;
  textChars: number;
  attachmentCount: number;
}): void {
  const modelPart = input.model ? ` model=${input.model}` : '';
  console.log(
    `[llm-proxy] seq=${input.sequence} start provider=codex kind=${input.requestKind} intent=${input.intent}${modelPart} chars=${input.textChars} attachments=${input.attachmentCount} path=${input.pathname}`
  );
}

function logProxyCompletion(input: {
  sequence?: number;
  provider: 'openai' | 'gemini' | 'codex';
  requestKind: string;
  cacheStatus: 'HIT' | 'MISS' | 'BYPASS' | 'ERROR';
  durationMs: number;
  extras?: string;
}): void {
  console.log(
    `[llm-proxy]${typeof input.sequence === 'number' ? ` seq=${input.sequence}` : ''} end provider=${input.provider} kind=${input.requestKind} cache=${input.cacheStatus} durationMs=${input.durationMs}${input.extras ? ` ${input.extras}` : ''}`
  );
}

function logCodexProxyEvent(sequence: number, message: string): void {
  console.log(`[llm-proxy] seq=${sequence} ${message}`);
}

function normalizeRequestKind(provider: 'openai' | 'gemini' | 'codex', upstreamPath: string): string {
  if (provider === 'openai' || provider === 'codex') {
    return upstreamPath || 'unknown';
  }

  const operationMatch = /:([A-Za-z0-9_]+)$/.exec(upstreamPath);
  if (operationMatch?.[1]) {
    return operationMatch[1];
  }

  return upstreamPath || 'unknown';
}

async function handleGeminiBackofficeApiRequest(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const username = requireBackofficeUser(request, response);
  if (!username) {
    return;
  }

  const overview = await geminiAnalyticsStore.getOverview();
  sendJson(response, 200, {
    ok: true,
    username,
    overview
  });
}

async function handleGeminiBackofficeHtmlRequest(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const username = requireBackofficeUser(request, response);
  if (!username) {
    return;
  }

  const overview = await geminiAnalyticsStore.getOverview();
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(renderGeminiBackofficeHtml(overview));
}

function requireBackofficeUser(
  request: IncomingMessage,
  response: ServerResponse
): string | null {
  const session = sessionAuth.getSessionFromRequest(request);
  if (!session) {
    sendJson(response, 401, { error: 'Backoffice access requires a logged-in proxy session.' });
    return null;
  }

  if (!isBackofficeAllowedUser(session.username)) {
    sendJson(response, 403, { error: 'Backoffice access is not enabled for this user.' });
    return null;
  }

  return session.username;
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

function resolveRequestActor(
  request: IncomingMessage,
  requestUrl: URL,
  expectedToken: string | undefined,
  auth: ProxySessionAuth
): string {
  const session = auth.getSessionFromRequest(request);
  if (session) {
    return session.username;
  }

  const headerValue = request.headers.authorization?.trim();
  if (expectedToken && headerValue === `Bearer ${expectedToken}`) {
    return 'shared-token';
  }

  const alternateHeader = request.headers['x-llm-proxy-auth'];
  if (expectedToken && typeof alternateHeader === 'string' && alternateHeader.trim() === expectedToken) {
    return 'shared-token';
  }

  const queryToken = requestUrl.searchParams.get('key')?.trim();
  if (expectedToken && queryToken === expectedToken) {
    return 'shared-token';
  }

  return 'anonymous';
}

function loadConfig(): ServerConfig {
  const env = process.env;

  return {
    host: normalizeListenHost(env.LLM_PROXY_HOST),
    port: normalizePort(env.PORT),
    proxyAuthToken: normalizeNonEmpty(env.LLM_PROXY_AUTH_TOKEN),
    corsOrigin: normalizeNonEmpty(env.LLM_PROXY_CORS_ORIGIN) ?? '*',
    openAiBaseUrl: normalizeUrl(env.OPENAI_BASE_URL, 'https://api.openai.com/v1'),
    openAiApiKey: normalizeNonEmpty(env.OPENAI_API_KEY),
    geminiBaseUrl: normalizeUrl(env.GEMINI_BASE_URL, 'https://generativelanguage.googleapis.com'),
    geminiApiKey: normalizeNonEmpty(env.GEMINI_API_KEY),
    geminiModel: normalizeNonEmpty(env.LLM_PROXY_GEMINI_MODEL) ?? 'gemini-3-flash-preview',
    geminiBinaryInputModel: normalizeNonEmpty(env.LLM_PROXY_GEMINI_BINARY_MODEL),
    geminiAnalytics: {
      dataDir: normalizeNonEmpty(env.LLM_PROXY_GEMINI_ANALYTICS_DIR) ?? '.cache/llm-proxy-analytics',
      retentionDays: normalizePositiveNumber(env.LLM_PROXY_GEMINI_ANALYTICS_RETENTION_DAYS, 14),
      dailyMaxCalls: normalizePositiveNumber(env.LLM_PROXY_GEMINI_DAILY_MAX_CALLS, 1000),
      dailyMaxTotalTokens: normalizePositiveNumber(env.LLM_PROXY_GEMINI_DAILY_MAX_TOKENS, 1_000_000)
    },
    codexExec: {
      enabled: normalizeBoolean(env.CODEX_EXEC_ENABLED, false),
      command: normalizeNonEmpty(env.CODEX_EXEC_COMMAND) ?? 'codex',
      workspaceParentDir: normalizeNonEmpty(env.CODEX_EXEC_WORKDIR),
      defaultModel: normalizeNonEmpty(env.CODEX_EXEC_MODEL),
      sandboxMode: normalizeCodexSandboxMode(env.CODEX_EXEC_SANDBOX_MODE),
      profile: normalizeNonEmpty(env.CODEX_EXEC_PROFILE),
      reasoningEffort: normalizeCodexReasoningEffort(env.CODEX_EXEC_REASONING_EFFORT),
      fullAuto: normalizeBoolean(env.CODEX_EXEC_FULL_AUTO, false),
      dangerouslyBypassApprovals: normalizeBoolean(env.CODEX_EXEC_DANGEROUSLY_BYPASS_APPROVALS_AND_SANDBOX, false),
      skipGitRepoCheck: normalizeBoolean(env.CODEX_EXEC_SKIP_GIT_REPO_CHECK, true),
      additionalWritableDirs: normalizePathList(env.CODEX_EXEC_ADDITIONAL_WRITE_DIRS),
      keepInteractiveWidgetWorkspaces: normalizeBoolean(env.CODEX_EXEC_KEEP_INTERACTIVE_WIDGET_WORKSPACES, true),
      timeoutMs: normalizePositiveNumber(env.CODEX_EXEC_TIMEOUT_MS, 10 * 60 * 1000)
    },
    cacheEnabled: normalizeBoolean(env.LLM_PROXY_CACHE_ENABLED, true),
    cacheDir: normalizeNonEmpty(env.LLM_PROXY_CACHE_DIR) ?? '.cache/llm-proxy',
    cacheTtlMs: normalizeOptionalNumber(env.LLM_PROXY_CACHE_TTL_MS),
    cacheMaxBodyBytes: normalizePositiveNumber(env.LLM_PROXY_CACHE_MAX_BODY_BYTES, 20 * 1024 * 1024),
    asyncJobs: {
      retentionMs: normalizePositiveNumber(env.LLM_PROXY_ASYNC_JOB_TTL_MS, 60 * 60 * 1000),
      maxJobs: normalizePositiveNumber(env.LLM_PROXY_ASYNC_MAX_JOBS, 100),
      pollIntervalMs: normalizePositiveNumber(env.LLM_PROXY_ASYNC_POLL_INTERVAL_MS, 1500)
    },
    proxyUsers: parseProxyUsers(env.LLM_PROXY_USERS),
    sessionCookieName: normalizeNonEmpty(env.LLM_PROXY_SESSION_COOKIE_NAME) ?? 'llm_proxy_session',
    sessionTtlMs: normalizePositiveNumber(env.LLM_PROXY_SESSION_TTL_MS, 30 * 24 * 60 * 60 * 1000),
    sessionCookieSecure: normalizeBoolean(env.LLM_PROXY_SESSION_COOKIE_SECURE, false),
    proxyAppDir: normalizeNonEmpty(env.LLM_PROXY_APP_DIR) ?? 'testApp/dist',
    rootRedirectPath: normalizeRedirectPath(env.LLM_PROXY_ROOT_REDIRECT_PATH)
  };
}

function normalizeListenHost(value: string | undefined): string {
  return normalizeNonEmpty(value) ?? '127.0.0.1';
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

function normalizeRedirectPath(value: string | undefined): string | undefined {
  const normalized = normalizeNonEmpty(value);
  if (!normalized) {
    return undefined;
  }
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
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

function normalizeCodexReasoningEffort(value: string | undefined): CodexExecConfig['reasoningEffort'] {
  const normalized = normalizeNonEmpty(value)?.toLowerCase();
  if (normalized === 'none' || normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'xhigh') {
    return normalized;
  }
  return 'low';
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
  cachedAt?: number,
  extraHeaders?: Record<string, string>
): void {
  const headers: Record<string, string> = {
    ...payload.headers,
    'Content-Length': String(payload.body.length),
    'X-LLM-Proxy-Cache': cacheStatus,
    'X-LLM-Proxy-Cache-Key': cacheKey,
    'X-LLM-Proxy-Body-Hash': bodyHash,
    ...extraHeaders
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
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization,Content-Type,X-LLM-Proxy-Auth,X-LLM-Proxy-Cache,X-LLM-Proxy-Async'
  );
  response.setHeader(
    'Access-Control-Expose-Headers',
    'Location,Retry-After,X-LLM-Proxy-Cache,X-LLM-Proxy-Cache-Key,X-LLM-Proxy-Body-Hash,X-LLM-Proxy-Cached-At,X-LLM-Proxy-Job-Id,X-LLM-Proxy-Async-Status'
  );
}

function writeSecurityHeaders(response: ServerResponse): void {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
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
