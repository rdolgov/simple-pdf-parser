import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import type { HtmlDocumentLayout } from '../../src/index.js';
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
import {
  executeImageAnalysisTask,
  executeImageGenerationTask,
  executeStructuredDetectTask,
  executeTextTask,
  type TaskImageProvider,
  type TaskTextProvider
} from './taskExecutors.js';
import { executeStructuredDetectTaskProgressive } from './progressiveStructuredDetect.js';
import { executeRelevanceTask } from './taskRelevance.js';
import {
  buildSemanticIndex,
  createSemanticIndexFingerprint,
  searchSemanticIndex,
  type SemanticChunkBounds,
  type SemanticTextChunk,
  type StoredSemanticIndex,
  type TaskSemanticProvider
} from './taskSemanticSearch.js';
import { TaskStore, type StoredDocumentRecord } from './taskStore.js';

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
  tasks: {
    dataDir: string;
    structuredDetectPageConcurrency: number;
    structuredDetectBatchSize: number;
    structuredDetectInitialPageCount: number;
    structuredDetectMinSplitBytes: number;
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
const TASKS_PREFIX = '/api/tasks';
const PROXY_TASKS_PREFIX = '/proxy/api/tasks';
const TASK_DOCUMENTS_PREFIX = `${TASKS_PREFIX}/documents`;
const PROXY_TASK_DOCUMENTS_PREFIX = `${PROXY_TASKS_PREFIX}/documents`;
const TASK_JOBS_PREFIX = `${TASKS_PREFIX}/jobs/`;
const PROXY_TASK_JOBS_PREFIX = `${PROXY_TASKS_PREFIX}/jobs/`;
const TASK_ASK_QUESTION_PATHS = new Set([`${TASKS_PREFIX}/ask-question`, `${PROXY_TASKS_PREFIX}/ask-question`]);
const TASK_ANALYZE_IMAGE_PATHS = new Set([`${TASKS_PREFIX}/analyze-image`, `${PROXY_TASKS_PREFIX}/analyze-image`]);
const TASK_GENERATE_IMAGE_PATHS = new Set([`${TASKS_PREFIX}/generate-image`, `${PROXY_TASKS_PREFIX}/generate-image`]);
const TASK_GENERATE_WIDGET_PATHS = new Set([`${TASKS_PREFIX}/generate-widget`, `${PROXY_TASKS_PREFIX}/generate-widget`]);
const TASK_ANALYZE_FORMULA_PATHS = new Set([`${TASKS_PREFIX}/analyze-formula`, `${PROXY_TASKS_PREFIX}/analyze-formula`]);
const TASK_LOGICAL_STRUCTURE_PATHS = new Set([`${TASKS_PREFIX}/logical-structure`, `${PROXY_TASKS_PREFIX}/logical-structure`]);
const TASK_ANALYZE_RELEVANCE_PATHS = new Set([`${TASKS_PREFIX}/analyze-relevance`, `${PROXY_TASKS_PREFIX}/analyze-relevance`]);
const TASK_BUILD_SEMANTIC_INDEX_PATHS = new Set([
  `${TASKS_PREFIX}/build-semantic-index`,
  `${PROXY_TASKS_PREFIX}/build-semantic-index`
]);
const TASK_SEARCH_SEMANTIC_PATHS = new Set([`${TASKS_PREFIX}/search-semantic`, `${PROXY_TASKS_PREFIX}/search-semantic`]);
const TASK_TABLE_INFOGRAPHIC_PATHS = new Set([
  `${TASKS_PREFIX}/generate-table-infographic`,
  `${PROXY_TASKS_PREFIX}/generate-table-infographic`
]);
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
const LOG_PREVIEW_MAX_CHARS = 220;
const LOG_PREVIEW_STRING_LIMIT = 4;

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
const taskStore = new TaskStore(config.tasks.dataDir);
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
  console.log('[llm-proxy] Task data:', `dir=${config.tasks.dataDir}`);
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
        tasks: {
          dataDir: config.tasks.dataDir
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
    if (requestUrl.pathname === TASK_DOCUMENTS_PREFIX || requestUrl.pathname === PROXY_TASK_DOCUMENTS_PREFIX) {
      await handleTaskDocumentUploadRequest(request, response, requestUrl, config);
      return;
    }
    if (TASK_ASK_QUESTION_PATHS.has(requestUrl.pathname)) {
      await handleTextTaskRequest(request, response, requestUrl, config, 'ask-question');
      return;
    }
    if (TASK_GENERATE_WIDGET_PATHS.has(requestUrl.pathname)) {
      await handleTextTaskRequest(request, response, requestUrl, config, 'generate-widget');
      return;
    }
    if (TASK_ANALYZE_FORMULA_PATHS.has(requestUrl.pathname)) {
      await handleTextTaskRequest(request, response, requestUrl, config, 'analyze-formula', 'json');
      return;
    }
    if (TASK_LOGICAL_STRUCTURE_PATHS.has(requestUrl.pathname)) {
      await handleTextTaskRequest(request, response, requestUrl, config, 'logical-structure', 'json');
      return;
    }
    if (TASK_ANALYZE_RELEVANCE_PATHS.has(requestUrl.pathname)) {
      await handleRelevanceTaskRequest(request, response, requestUrl, config);
      return;
    }
    if (TASK_ANALYZE_IMAGE_PATHS.has(requestUrl.pathname)) {
      await handleImageAnalysisTaskRequest(request, response, requestUrl, config);
      return;
    }
    if (TASK_GENERATE_IMAGE_PATHS.has(requestUrl.pathname)) {
      await handleImageGenerationTaskRequest(request, response, requestUrl, config, 'generate-image');
      return;
    }
    if (TASK_BUILD_SEMANTIC_INDEX_PATHS.has(requestUrl.pathname)) {
      await handleBuildSemanticIndexTaskRequest(request, response, requestUrl, config);
      return;
    }
    if (TASK_SEARCH_SEMANTIC_PATHS.has(requestUrl.pathname)) {
      await handleSearchSemanticTaskRequest(request, response, requestUrl, config);
      return;
    }
    if (TASK_TABLE_INFOGRAPHIC_PATHS.has(requestUrl.pathname)) {
      await handleImageGenerationTaskRequest(request, response, requestUrl, config, 'generate-table-infographic');
      return;
    }

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
    const taskJobId = stripKnownPrefix(requestUrl.pathname, [TASK_JOBS_PREFIX, PROXY_TASK_JOBS_PREFIX]);
    if (taskJobId !== null && taskJobId.length > 0) {
      handleTaskJobStatusRequest(request, response, requestUrl, taskJobId, config);
      return;
    }
    const taskDocumentId = stripKnownPrefix(requestUrl.pathname, [TASK_DOCUMENTS_PREFIX, PROXY_TASK_DOCUMENTS_PREFIX]);
    if (taskDocumentId !== null && taskDocumentId.length > 0) {
      await handleTaskDocumentStatusRequest(
        request,
        response,
        requestUrl,
        decodeURIComponent(taskDocumentId.replace(/^\/+/, '')),
        config
      );
      return;
    }
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

async function handleTaskDocumentUploadRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  currentConfig: ServerConfig
): Promise<void> {
  if (!isAuthorized(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth)) {
    sendJson(response, 401, { error: 'Proxy authorization failed.' });
    return;
  }

  const body = await readRawBody(request);
  if (body.length === 0) {
    sendJson(response, 400, { error: 'Document upload body is required.' });
    return;
  }

  const actor = resolveRequestActor(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth);
  const fileName = normalizeNonEmpty(readHeaderValue(request.headers['x-document-name'])) ?? 'document.pdf';
  const mimeType = normalizeNonEmpty(readHeaderValue(request.headers['content-type'])) ?? 'application/pdf';
  const fileHash =
    normalizeNonEmpty(readHeaderValue(request.headers['x-document-hash'])) ??
    createHash('sha256').update(body).digest('hex');
  const provider = normalizeStructuredDetectProvider(requestUrl.searchParams.get('provider')) ?? 'gemini';
  const model = normalizeNonEmpty(requestUrl.searchParams.get('model') ?? undefined);
  const documentRecord = await taskStore.createOrUpdateDocument({
    actor,
    fileHash,
    fileName,
    mimeType,
    bytes: body
  });

  if (documentRecord.detection.state === 'ready' && !shouldForceTaskRefresh(requestUrl)) {
    const result = await taskStore.getDetectionResult(documentRecord.id);
    sendJson(response, 200, {
      document: serializeDocumentRecord(documentRecord),
      detection: {
        status: 'ready',
        ...(typeof documentRecord.detection.totalPages === 'number' ? { totalPages: documentRecord.detection.totalPages } : {}),
        ...(typeof documentRecord.detection.completedPages === 'number' ? { completedPages: documentRecord.detection.completedPages } : {}),
        ...(typeof documentRecord.detection.publishedPages === 'number' ? { publishedPages: documentRecord.detection.publishedPages } : {}),
        ...(result ? { result } : {}),
        documentUrl: buildTaskDocumentStatusPath(requestUrl.pathname, documentRecord.id)
      }
    });
    return;
  }

  const requestKind = 'document-detect-structure';
  const cacheKey = buildTaskCacheKey(requestKind, actor, body, {
    documentId: documentRecord.id,
    provider,
    ...(model ? { model } : {})
  });
  const bodyHash = responseCache.buildBodyHash(body);
  const sequence = ++proxyRequestSequence;
  const startedAt = Date.now();
  logProxyEvent(
    sequence,
    `document stored id=${documentRecord.id} file=${fileName} bytes=${body.length} path=${documentRecord.filePath} detection=${documentRecord.detection.state}`
  );
  const { job, reused } = asyncJobStore.createOrReuse({
    provider: 'task',
    requestKind,
    cacheKey,
    bodyHash,
    cacheStatus: 'BYPASS',
    sequence
  });
  const taskJobPollPath = buildTaskJobPollPath(requestUrl.pathname, job.id);
  const documentPollPath = buildTaskDocumentStatusPath(requestUrl.pathname, documentRecord.id);

  if (reused) {
    console.log(`[llm-proxy] seq=${sequence} task job reuse kind=${requestKind} job=${job.id} status=${job.state}`);
  } else {
    console.log(`[llm-proxy] seq=${sequence} task job create kind=${requestKind} job=${job.id} poll=${taskJobPollPath}`);
    await taskStore.setDetectionPending(documentRecord.id, {
      jobId: job.id,
      provider,
      ...(model ? { model } : {}),
      completedPages: 0,
      publishedPages: 0
    });
    void runAsyncTaskJob(job.id, {
      requestKind,
      sequence,
      startedAt,
      runner: async (_jobId, logProgress) => {
        logProgress(`uploaded document=${documentRecord.id} file=${fileName} bytes=${body.length} path=${documentRecord.filePath}`);
        try {
          const detection = await executeStructuredDetectTaskProgressive(
            {
              provider,
              ...(model ? { model } : {}),
              filePath: documentRecord.filePath,
              fileName: documentRecord.fileName
            },
            {
              ...currentConfig,
              structuredDetectPageConcurrency: currentConfig.tasks.structuredDetectPageConcurrency,
              structuredDetectBatchSize: currentConfig.tasks.structuredDetectBatchSize,
              structuredDetectInitialPageCount: currentConfig.tasks.structuredDetectInitialPageCount,
              structuredDetectMinSplitBytes: currentConfig.tasks.structuredDetectMinSplitBytes,
              structuredDetectTasksDataDir: currentConfig.tasks.dataDir
            },
            {
              onProgress: async (progress) => {
                await taskStore.setDetectionPending(documentRecord.id, {
                  jobId: job.id,
                  provider,
                  ...(model ? { model } : {}),
                  totalPages: progress.totalPages,
                  completedPages: progress.completedPages,
                  publishedPages: progress.publishedPages
                });
              },
              onPartial: async (partial, progress) => {
                await taskStore.setDetectionPartial(documentRecord.id, {
                  provider,
                  model: partial.model,
                  result: partial as unknown as Record<string, unknown>,
                  totalPages: progress.totalPages,
                  completedPages: progress.completedPages,
                  publishedPages: progress.publishedPages
                });
              }
            }
          );
          const updatedRecord = await taskStore.setDetectionReady(documentRecord.id, {
            provider,
            model: detection.model,
            result: detection as unknown as Record<string, unknown>,
            totalPages: (detection.document as { pages?: unknown[] }).pages?.length
          });
          logProgress(
            `detection ready document=${documentRecord.id} model=${detection.model} resultPath=${updatedRecord?.detection.resultPath ?? 'n/a'}`
          );
          await taskStore.recordInteraction({
            actor,
            documentId: documentRecord.id,
            taskType: requestKind,
            provider,
            model: detection.model,
            status: 'succeeded',
            inputSummary: {
              fileName: documentRecord.fileName,
              fileHash: documentRecord.fileHash
            },
            outputSummary: summarizeDetectionResult(detection)
          });
          return createJsonResponse(200, {
            document: serializeDocumentRecord(updatedRecord ?? documentRecord),
            detection: {
              status: 'ready',
              totalPages: (detection.document as { pages?: unknown[] }).pages?.length ?? null,
              completedPages: (detection.document as { pages?: unknown[] }).pages?.length ?? null,
              publishedPages: (detection.document as { pages?: unknown[] }).pages?.length ?? null,
              result: detection,
              documentUrl: documentPollPath
            }
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to detect document structure.';
          await taskStore.setDetectionError(documentRecord.id, {
            provider,
            ...(model ? { model } : {}),
            error: message
          });
          await taskStore.recordInteraction({
            actor,
            documentId: documentRecord.id,
            taskType: requestKind,
            provider,
            ...(model ? { model } : {}),
            status: 'failed',
            inputSummary: {
              fileName: documentRecord.fileName,
              fileHash: documentRecord.fileHash
            },
            outputSummary: {
              error: message
            }
          });
          return createJsonErrorResponse(500, message, {
            document: serializeDocumentRecord(documentRecord),
            detection: {
              status: 'error',
              documentUrl: documentPollPath
            }
          });
        }
      }
    });
  }

  const latestDocument = (await taskStore.getDocument(documentRecord.id)) ?? documentRecord;
  const partialResult = await taskStore.getDetectionResult(documentRecord.id);
  response.writeHead(202, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Location: documentPollPath,
    'Retry-After': String(Math.max(1, Math.ceil(currentConfig.asyncJobs.pollIntervalMs / 1000))),
    'X-LLM-Proxy-Job-Id': job.id,
    'X-LLM-Proxy-Async-Status': latestDocument.detection.state
  });
  response.end(JSON.stringify({
    document: serializeDocumentRecord(latestDocument),
    detection: {
      status: latestDocument.detection.state,
      jobId: job.id,
      provider,
      ...(model ? { model } : {}),
      ...(typeof latestDocument.detection.totalPages === 'number' ? { totalPages: latestDocument.detection.totalPages } : {}),
      ...(typeof latestDocument.detection.completedPages === 'number' ? { completedPages: latestDocument.detection.completedPages } : {}),
      ...(typeof latestDocument.detection.publishedPages === 'number' ? { publishedPages: latestDocument.detection.publishedPages } : {}),
      ...(partialResult ? { result: partialResult } : {}),
      pollUrl: taskJobPollPath,
      documentUrl: documentPollPath
    }
  }));
}

async function handleTaskDocumentStatusRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  documentId: string,
  currentConfig: ServerConfig
): Promise<void> {
  if (!isAuthorized(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth)) {
    sendJson(response, 401, { error: 'Proxy authorization failed.' });
    return;
  }

  const actor = resolveRequestActor(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth);
  const document = await taskStore.getDocument(documentId);
  if (!document || document.actor !== actor) {
    sendJson(response, 404, { error: 'Unknown task document.' });
    return;
  }
  const result = await taskStore.getDetectionResult(documentId);
  sendJson(response, 200, {
    document: serializeDocumentRecord(document),
    detection: {
      status: document.detection.state,
      ...(document.detection.jobId ? { jobId: document.detection.jobId } : {}),
      ...(document.detection.provider ? { provider: document.detection.provider } : {}),
      ...(document.detection.model ? { model: document.detection.model } : {}),
      ...(typeof document.detection.totalPages === 'number' ? { totalPages: document.detection.totalPages } : {}),
      ...(typeof document.detection.completedPages === 'number' ? { completedPages: document.detection.completedPages } : {}),
      ...(typeof document.detection.publishedPages === 'number' ? { publishedPages: document.detection.publishedPages } : {}),
      ...(document.detection.error ? { error: document.detection.error } : {}),
      ...(result ? { result } : {}),
      documentUrl: buildTaskDocumentStatusPath(requestUrl.pathname, document.id)
    }
  });
}

async function handleTextTaskRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  currentConfig: ServerConfig,
  taskType: 'ask-question' | 'generate-widget' | 'analyze-formula' | 'logical-structure',
  responseFormat: 'text' | 'json' = 'text'
): Promise<void> {
  if (!isAuthorized(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth)) {
    sendJson(response, 401, { error: 'Proxy authorization failed.' });
    return;
  }

  const actor = resolveRequestActor(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth);
  const body = await readJsonBody(request);
  const prompt = normalizeNonEmptyString(body.prompt);
  if (!prompt) {
    sendJson(response, 400, { error: 'Task prompt is required.' });
    return;
  }
  const provider = normalizeTextTaskProvider(body.provider) ?? 'gemini';
  const model = normalizeNonEmptyString(body.model);
  let document: StoredDocumentRecord | null = null;
  try {
    document = await resolveAuthorizedTaskDocument(actor, normalizeNonEmptyString(body.documentId));
  } catch (error) {
    sendJson(response, 404, { error: error instanceof Error ? error.message : 'Unknown task document.' });
    return;
  }
  const enableWebSearch = body.enableWebSearch === true;
  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');

  if (
    maybeHandleAsyncTaskJob(request, response, requestUrl, {
      requestKind: taskType,
      sequence: ++proxyRequestSequence,
      startedAt: Date.now(),
      cacheKey: buildTaskCacheKey(taskType, actor, rawBody, {
        provider,
        ...(model ? { model } : {}),
        ...(document ? { documentId: document.id } : {})
      }),
      bodyHash: responseCache.buildBodyHash(rawBody),
      runner: async (_jobId, logProgress) => {
        logProgress(
          `task-start provider=${provider} task=${taskType} model=${model ?? 'default'} document=${document?.id ?? 'none'} prompt="${summarizeTextForLog(prompt)}"`
        );
        const taskStartedAt = Date.now();
        try {
          const result = await executeTextTask(
            {
              provider,
              ...(model ? { model } : {}),
              prompt,
              responseFormat,
              enableWebSearch
            },
            currentConfig
          );
          logProgress(
            `task-done provider=${provider} task=${taskType} model=${result.model} durationMs=${Date.now() - taskStartedAt} response="${summarizeTextForLog(result.text)}"`
          );
          await taskStore.recordInteraction({
            actor,
            ...(document ? { documentId: document.id } : {}),
            taskType,
            provider,
            model: result.model,
            status: 'succeeded',
            inputSummary: summarizePromptInput(prompt, body),
            outputSummary: summarizeTextOutput(result.text)
          });
          return createJsonResponse(200, {
            text: result.text,
            model: result.model
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : `Failed to run ${taskType}.`;
          await taskStore.recordInteraction({
            actor,
            ...(document ? { documentId: document.id } : {}),
            taskType,
            provider,
            ...(model ? { model } : {}),
            status: 'failed',
            inputSummary: summarizePromptInput(prompt, body),
            outputSummary: { error: message }
          });
          return createJsonErrorResponse(500, message);
        }
      }
    })
  ) {
    return;
  }

  sendJson(response, 400, { error: 'Task requests must use async polling.' });
}

async function handleRelevanceTaskRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  currentConfig: ServerConfig
): Promise<void> {
  if (!isAuthorized(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth)) {
    sendJson(response, 401, { error: 'Proxy authorization failed.' });
    return;
  }

  const actor = resolveRequestActor(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth);
  const body = await readJsonBody(request);
  const query = normalizeNonEmptyString(body.query);
  const documentLayout = normalizeHtmlDocumentLayout(body.document);
  if (!query || !documentLayout) {
    sendJson(response, 400, { error: 'Relevance analysis requires query and document layout.' });
    return;
  }

  const provider = normalizeOpenAiCompatibleTaskProvider(body.provider) ?? 'openai';
  const model = normalizeNonEmptyString(body.model);
  const maxContextTokens = normalizeOptionalFiniteNumber(body.maxContextTokens);
  let document: StoredDocumentRecord | null = null;
  try {
    document = await resolveAuthorizedTaskDocument(actor, normalizeNonEmptyString(body.documentId));
  } catch (error) {
    sendJson(response, 404, { error: error instanceof Error ? error.message : 'Unknown task document.' });
    return;
  }
  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');

  if (
    maybeHandleAsyncTaskJob(request, response, requestUrl, {
      requestKind: 'analyze-relevance',
      sequence: ++proxyRequestSequence,
      startedAt: Date.now(),
      cacheKey: buildTaskCacheKey('analyze-relevance', actor, rawBody, {
        provider,
        ...(model ? { model } : {}),
        ...(document ? { documentId: document.id } : {})
      }),
      bodyHash: responseCache.buildBodyHash(rawBody),
      runner: async (_jobId, logProgress) => {
        logProgress(
          `task-start provider=${provider} task=analyze-relevance model=${model ?? 'default'} document=${document?.id ?? 'none'} query="${summarizeTextForLog(query)}"`
        );
        const taskStartedAt = Date.now();
        try {
          const result = await executeRelevanceTask(
            {
              provider,
              ...(model ? { model } : {}),
              query,
              document: documentLayout,
              ...(typeof maxContextTokens === 'number' ? { maxContextTokens } : {})
            },
            currentConfig
          );
          logProgress(
            `task-done provider=${provider} task=analyze-relevance model=${result.model ?? model ?? provider} durationMs=${Date.now() - taskStartedAt} annotations=${Array.isArray(result.annotations) ? result.annotations.length : 0}`
          );
          await taskStore.recordInteraction({
            actor,
            ...(document ? { documentId: document.id } : {}),
            taskType: 'analyze-relevance',
            provider,
            model: result.model ?? model ?? provider,
            status: 'succeeded',
            inputSummary: {
              queryChars: query.length,
              pageCount: documentLayout.pages.length
            },
            outputSummary: {
              annotations: Array.isArray(result.annotations) ? result.annotations.length : 0,
              model: result.model ?? null
            }
          });
          return createJsonResponse(200, result as unknown as Record<string, unknown>);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to analyze relevance.';
          await taskStore.recordInteraction({
            actor,
            ...(document ? { documentId: document.id } : {}),
            taskType: 'analyze-relevance',
            provider,
            ...(model ? { model } : {}),
            status: 'failed',
            inputSummary: {
              queryChars: query.length,
              pageCount: documentLayout.pages.length
            },
            outputSummary: { error: message }
          });
          return createJsonErrorResponse(500, message);
        }
      }
    })
  ) {
    return;
  }

  sendJson(response, 400, { error: 'Task requests must use async polling.' });
}

async function handleBuildSemanticIndexTaskRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  currentConfig: ServerConfig
): Promise<void> {
  if (!isAuthorized(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth)) {
    sendJson(response, 401, { error: 'Proxy authorization failed.' });
    return;
  }

  const actor = resolveRequestActor(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth);
  const body = await readJsonBody(request);
  const documentId = normalizeNonEmptyString(body.documentId);
  const documentHash = normalizeNonEmptyString(body.documentHash);
  const chunks = normalizeSemanticChunks(body.chunks);
  if (!documentId || !documentHash || !chunks || chunks.length === 0) {
    sendJson(response, 400, { error: 'Semantic indexing requires documentId, documentHash, and chunks.' });
    return;
  }

  const provider = normalizeSemanticTaskProvider(body.provider) ?? 'gemini';
  const model = normalizeNonEmptyString(body.model) ?? defaultSemanticTaskModel(provider);
  let document: StoredDocumentRecord | null = null;
  try {
    document = await resolveAuthorizedTaskDocument(actor, documentId);
  } catch (error) {
    sendJson(response, 404, { error: error instanceof Error ? error.message : 'Unknown task document.' });
    return;
  }
  const authorizedDocument = document;
  if (!authorizedDocument) {
    sendJson(response, 404, { error: 'Unknown task document.' });
    return;
  }

  const fingerprint = createSemanticIndexFingerprint(provider, model);
  if (!shouldForceTaskRefresh(requestUrl)) {
    const existing = await taskStore.getSemanticIndex<StoredSemanticIndex>(authorizedDocument.id, fingerprint);
    if (existing) {
      sendJson(response, 200, {
        documentId: existing.documentId,
        documentHash: existing.documentHash,
        provider: existing.provider,
        model: existing.model,
        chunkCount: existing.chunkCount,
        createdAt: existing.createdAt
      });
      return;
    }
  }

  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
  if (
    maybeHandleAsyncTaskJob(request, response, requestUrl, {
      requestKind: 'build-semantic-index',
      sequence: ++proxyRequestSequence,
      startedAt: Date.now(),
      cacheKey: buildTaskCacheKey('build-semantic-index', actor, rawBody, {
        documentId: authorizedDocument.id,
        provider,
        model,
        chunkCount: chunks.length
      }),
      bodyHash: responseCache.buildBodyHash(rawBody),
      runner: async (_jobId, logProgress) => {
        logProgress(
          `task-start provider=${provider} task=build-semantic-index model=${model} document=${authorizedDocument.id} chunks=${chunks.length}`
        );
        const taskStartedAt = Date.now();
        try {
          const index = await buildSemanticIndex(
            {
              documentId: authorizedDocument.id,
              documentHash,
              provider,
              model,
              chunks
            },
            currentConfig,
            (processed, total) => {
              logProgress(`embedded ${processed}/${total} semantic chunks`);
            }
          );
          logProgress(
            `task-done provider=${provider} task=build-semantic-index model=${index.model} durationMs=${Date.now() - taskStartedAt} chunkCount=${index.chunkCount}`
          );
          await taskStore.setSemanticIndex(authorizedDocument.id, fingerprint, index);
          await taskStore.recordInteraction({
            actor,
            documentId: authorizedDocument.id,
            taskType: 'build-semantic-index',
            provider,
            model: index.model,
            status: 'succeeded',
            inputSummary: {
              chunkCount: chunks.length
            },
            outputSummary: {
              chunkCount: index.chunkCount,
              model: index.model
            }
          });
          return createJsonResponse(200, {
            documentId: index.documentId,
            documentHash: index.documentHash,
            provider: index.provider,
            model: index.model,
            chunkCount: index.chunkCount,
            createdAt: index.createdAt
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to build semantic index.';
          await taskStore.recordInteraction({
            actor,
            documentId: authorizedDocument.id,
            taskType: 'build-semantic-index',
            provider,
            model,
            status: 'failed',
            inputSummary: {
              chunkCount: chunks.length
            },
            outputSummary: { error: message }
          });
          return createJsonErrorResponse(500, message);
        }
      }
    })
  ) {
    return;
  }

  sendJson(response, 400, { error: 'Task requests must use async polling.' });
}

async function handleSearchSemanticTaskRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  currentConfig: ServerConfig
): Promise<void> {
  if (!isAuthorized(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth)) {
    sendJson(response, 401, { error: 'Proxy authorization failed.' });
    return;
  }

  const actor = resolveRequestActor(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth);
  const body = await readJsonBody(request);
  const query = normalizeNonEmptyString(body.query);
  const documentId = normalizeNonEmptyString(body.documentId);
  if (!query || !documentId) {
    sendJson(response, 400, { error: 'Semantic search requires documentId and query.' });
    return;
  }

  const provider = normalizeSemanticTaskProvider(body.provider) ?? 'gemini';
  const model = normalizeNonEmptyString(body.model) ?? defaultSemanticTaskModel(provider);
  const fingerprint = createSemanticIndexFingerprint(provider, model);
  const topK = normalizeOptionalFiniteNumber(body.topK);
  const minScore = normalizeOptionalFiniteNumber(body.minScore);
  let document: StoredDocumentRecord | null = null;
  try {
    document = await resolveAuthorizedTaskDocument(actor, documentId);
  } catch (error) {
    sendJson(response, 404, { error: error instanceof Error ? error.message : 'Unknown task document.' });
    return;
  }
  const authorizedDocument = document;
  if (!authorizedDocument) {
    sendJson(response, 404, { error: 'Unknown task document.' });
    return;
  }

  const index = await taskStore.getSemanticIndex<StoredSemanticIndex>(authorizedDocument.id, fingerprint);
  if (!index) {
    sendJson(response, 404, { error: 'Semantic index not found for this document and provider.' });
    return;
  }

  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
  if (
    maybeHandleAsyncTaskJob(request, response, requestUrl, {
      requestKind: 'search-semantic',
      sequence: ++proxyRequestSequence,
      startedAt: Date.now(),
      cacheKey: buildTaskCacheKey('search-semantic', actor, rawBody, {
        documentId: authorizedDocument.id,
        provider,
        model
      }),
      bodyHash: responseCache.buildBodyHash(rawBody),
      runner: async (_jobId, logProgress) => {
        logProgress(
          `task-start provider=${provider} task=search-semantic model=${model} document=${authorizedDocument.id} query="${summarizeTextForLog(query)}"`
        );
        const taskStartedAt = Date.now();
        try {
          const result = await searchSemanticIndex(
            {
              index,
              query,
              provider,
              model,
              ...(typeof topK === 'number' ? { topK } : {}),
              ...(typeof minScore === 'number' ? { minScore } : {})
            },
            currentConfig
          );
          logProgress(
            `task-done provider=${provider} task=search-semantic model=${result.model} durationMs=${Date.now() - taskStartedAt} hits=${result.results.length}`
          );
          await taskStore.recordInteraction({
            actor,
            documentId: authorizedDocument.id,
            taskType: 'search-semantic',
            provider,
            model: result.model,
            status: 'succeeded',
            inputSummary: {
              queryChars: query.length
            },
            outputSummary: {
              hits: result.results.length,
              model: result.model
            }
          });
          return createJsonResponse(200, {
            provider: result.provider,
            model: result.model,
            results: result.results
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to run semantic search.';
          await taskStore.recordInteraction({
            actor,
            documentId: authorizedDocument.id,
            taskType: 'search-semantic',
            provider,
            model,
            status: 'failed',
            inputSummary: {
              queryChars: query.length
            },
            outputSummary: { error: message }
          });
          return createJsonErrorResponse(500, message);
        }
      }
    })
  ) {
    return;
  }

  sendJson(response, 400, { error: 'Task requests must use async polling.' });
}

async function handleImageAnalysisTaskRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  currentConfig: ServerConfig
): Promise<void> {
  if (!isAuthorized(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth)) {
    sendJson(response, 401, { error: 'Proxy authorization failed.' });
    return;
  }

  const actor = resolveRequestActor(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth);
  const body = await readJsonBody(request);
  const prompt = normalizeNonEmptyString(body.prompt);
  const imagePayload = normalizeTaskImagePayload(body);
  if (!prompt || !imagePayload) {
    sendJson(response, 400, { error: 'Image analysis requires prompt and image data.' });
    return;
  }
  const provider = normalizeImageTaskProvider(body.provider) ?? 'gemini';
  const model = normalizeNonEmptyString(body.model);
  let document: StoredDocumentRecord | null = null;
  try {
    document = await resolveAuthorizedTaskDocument(actor, normalizeNonEmptyString(body.documentId));
  } catch (error) {
    sendJson(response, 404, { error: error instanceof Error ? error.message : 'Unknown task document.' });
    return;
  }
  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');

  if (
    maybeHandleAsyncTaskJob(request, response, requestUrl, {
      requestKind: 'analyze-image',
      sequence: ++proxyRequestSequence,
      startedAt: Date.now(),
      cacheKey: buildTaskCacheKey('analyze-image', actor, rawBody, {
        provider,
        ...(model ? { model } : {}),
        ...(document ? { documentId: document.id } : {})
      }),
      bodyHash: responseCache.buildBodyHash(rawBody),
      runner: async (_jobId, logProgress) => {
        logProgress(
          `task-start provider=${provider} task=analyze-image model=${model ?? 'default'} document=${document?.id ?? 'none'} imageBytes=${Math.floor((imagePayload.base64Data.length * 3) / 4)} prompt="${summarizeTextForLog(prompt)}"`
        );
        const taskStartedAt = Date.now();
        try {
          const result = await executeImageAnalysisTask(
            {
              provider,
              ...(model ? { model } : {}),
              prompt,
              base64Data: imagePayload.base64Data,
              mimeType: imagePayload.mimeType
            },
            currentConfig
          );
          logProgress(
            `task-done provider=${provider} task=analyze-image model=${result.model} durationMs=${Date.now() - taskStartedAt} response="${summarizeTextForLog(result.text)}"`
          );
          await taskStore.recordInteraction({
            actor,
            ...(document ? { documentId: document.id } : {}),
            taskType: 'analyze-image',
            provider,
            model: result.model,
            status: 'succeeded',
            inputSummary: {
              promptChars: prompt.length,
              mimeType: imagePayload.mimeType,
              imageBytes: Math.floor((imagePayload.base64Data.length * 3) / 4)
            },
            outputSummary: summarizeTextOutput(result.text)
          });
          return createJsonResponse(200, {
            text: result.text,
            model: result.model
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to analyze image.';
          await taskStore.recordInteraction({
            actor,
            ...(document ? { documentId: document.id } : {}),
            taskType: 'analyze-image',
            provider,
            ...(model ? { model } : {}),
            status: 'failed',
            inputSummary: {
              promptChars: prompt.length,
              mimeType: imagePayload.mimeType
            },
            outputSummary: { error: message }
          });
          return createJsonErrorResponse(500, message);
        }
      }
    })
  ) {
    return;
  }

  sendJson(response, 400, { error: 'Task requests must use async polling.' });
}

async function handleImageGenerationTaskRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  currentConfig: ServerConfig,
  taskType: 'generate-image' | 'generate-table-infographic'
): Promise<void> {
  if (!isAuthorized(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth)) {
    sendJson(response, 401, { error: 'Proxy authorization failed.' });
    return;
  }

  const actor = resolveRequestActor(request, requestUrl, currentConfig.proxyAuthToken, sessionAuth);
  const body = await readJsonBody(request);
  const prompt = normalizeNonEmptyString(body.prompt);
  if (!prompt) {
    sendJson(response, 400, { error: 'Image generation prompt is required.' });
    return;
  }
  const provider = normalizeImageTaskProvider(body.provider) ?? 'gemini';
  const model = normalizeNonEmptyString(body.model);
  let document: StoredDocumentRecord | null = null;
  try {
    document = await resolveAuthorizedTaskDocument(actor, normalizeNonEmptyString(body.documentId));
  } catch (error) {
    sendJson(response, 404, { error: error instanceof Error ? error.message : 'Unknown task document.' });
    return;
  }
  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');

  if (
    maybeHandleAsyncTaskJob(request, response, requestUrl, {
      requestKind: taskType,
      sequence: ++proxyRequestSequence,
      startedAt: Date.now(),
      cacheKey: buildTaskCacheKey(taskType, actor, rawBody, {
        provider,
        ...(model ? { model } : {}),
        ...(document ? { documentId: document.id } : {})
      }),
      bodyHash: responseCache.buildBodyHash(rawBody),
      runner: async (_jobId, logProgress) => {
        logProgress(
          `task-start provider=${provider} task=${taskType} model=${model ?? 'default'} document=${document?.id ?? 'none'} prompt="${summarizeTextForLog(prompt)}"`
        );
        const taskStartedAt = Date.now();
        try {
          const result = await executeImageGenerationTask(
            {
              provider,
              ...(model ? { model } : {}),
              prompt
            },
            currentConfig
          );
          logProgress(
            `task-done provider=${provider} task=${taskType} model=${result.model} durationMs=${Date.now() - taskStartedAt} mime=${result.mimeType} imageData=${result.dataUri.startsWith('data:') ? 'inline' : 'url'}`
          );
          await taskStore.recordInteraction({
            actor,
            ...(document ? { documentId: document.id } : {}),
            taskType,
            provider,
            model: result.model,
            status: 'succeeded',
            inputSummary: summarizePromptInput(prompt, body),
            outputSummary: {
              mimeType: result.mimeType,
              dataUriChars: result.dataUri.length
            }
          });
          return createJsonResponse(200, {
            dataUri: result.dataUri,
            mimeType: result.mimeType,
            prompt: result.prompt,
            model: result.model
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : `Failed to run ${taskType}.`;
          await taskStore.recordInteraction({
            actor,
            ...(document ? { documentId: document.id } : {}),
            taskType,
            provider,
            ...(model ? { model } : {}),
            status: 'failed',
            inputSummary: summarizePromptInput(prompt, body),
            outputSummary: { error: message }
          });
          return createJsonErrorResponse(500, message);
        }
      }
    })
  ) {
    return;
  }

  sendJson(response, 400, { error: 'Task requests must use async polling.' });
}

function handleTaskJobStatusRequest(
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
  if (!job || job.provider !== 'task') {
    sendJson(response, 404, { error: 'Unknown async task job.' });
    return;
  }

  const pollPath = buildTaskJobPollPath(requestUrl.pathname, job.id);
  if (job.state === 'pending' || job.state === 'running') {
    writeAsyncJobAccepted(response, job, pollPath, asyncJobStore.getPollIntervalMs());
    return;
  }

  const result = asyncJobStore.getResponse(jobId);
  if (!result) {
    sendJson(response, 500, { error: 'Async task job completed without a response payload.' });
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

function maybeHandleAsyncTaskJob(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  input: {
    requestKind: string;
    sequence: number;
    startedAt: number;
    cacheKey: string;
    bodyHash: string;
    runner: (jobId: string, logProgress: (message: string) => void) => Promise<ProxyAsyncJobResponse>;
  }
): boolean {
  if (!isAsyncPollRequested(request, requestUrl)) {
    return false;
  }

  const { job } = asyncJobStore.createOrReuse({
    provider: 'task',
    requestKind: input.requestKind,
    cacheKey: input.cacheKey,
    bodyHash: input.bodyHash,
    cacheStatus: 'BYPASS',
    sequence: input.sequence
  });
  const pollPath = buildTaskJobPollPath(requestUrl.pathname, job.id);

  if (job.state === 'pending') {
    console.log(`[llm-proxy] seq=${input.sequence} task job create kind=${input.requestKind} job=${job.id} poll=${pollPath}`);
    void runAsyncTaskJob(job.id, input);
  } else {
    console.log(`[llm-proxy] seq=${input.sequence} task job reuse kind=${input.requestKind} job=${job.id} status=${job.state}`);
  }

  writeAsyncJobAccepted(response, job, pollPath, config.asyncJobs.pollIntervalMs);
  return true;
}

async function runAsyncTaskJob(
  jobId: string,
  input: {
    requestKind: string;
    sequence: number;
    startedAt: number;
    runner: (jobId: string, logProgress: (message: string) => void) => Promise<ProxyAsyncJobResponse>;
  }
): Promise<void> {
  asyncJobStore.markRunning(jobId, 'task started');
  try {
    const payload = await input.runner(jobId, (message) => {
      asyncJobStore.appendEvent(jobId, message);
      logProxyEvent(input.sequence, message);
    });
    asyncJobStore.complete(jobId, payload);
    logProxyCompletion({
      sequence: input.sequence,
      provider: 'task',
      requestKind: input.requestKind,
      cacheStatus: payload.status >= 400 ? 'ERROR' : 'BYPASS',
      durationMs: Date.now() - input.startedAt,
      extras: `job=${jobId} status=${payload.status}`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Task job failed.';
    asyncJobStore.appendEvent(jobId, message);
    asyncJobStore.complete(jobId, createJsonErrorResponse(502, message));
    logProxyCompletion({
      sequence: input.sequence,
      provider: 'task',
      requestKind: input.requestKind,
      cacheStatus: 'ERROR',
      durationMs: Date.now() - input.startedAt,
      extras: `job=${jobId} status=502`
    });
  }
}

function buildTaskJobPollPath(pathname: string, jobId: string): string {
  const prefix = pathname.startsWith(PROXY_APP_PREFIX) ? PROXY_TASK_JOBS_PREFIX : TASK_JOBS_PREFIX;
  return `${prefix}${encodeURIComponent(jobId)}`;
}

function buildTaskDocumentStatusPath(pathname: string, documentId: string): string {
  const prefix = pathname.startsWith(PROXY_APP_PREFIX) ? PROXY_TASK_DOCUMENTS_PREFIX : TASK_DOCUMENTS_PREFIX;
  return `${prefix}/${encodeURIComponent(documentId)}`;
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
  const requestPreview = summarizeBodyForLog(body, contentType);
  logProxyEvent(sequence, `request provider=openai kind=${requestKind} preview="${requestPreview}"`);
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
      logProgress(`requesting upstream ${upstreamPath} preview="${requestPreview}"`);
      let upstreamResponse: Response;
      try {
        upstreamResponse = await fetch(upstreamUrl, {
          method: 'POST',
          headers: {
            Accept: accept ?? 'application/json',
            Authorization: `Bearer ${currentConfig.openAiApiKey}`,
            'Content-Type': contentType ?? 'application/json'
          },
          body: body as unknown as BodyInit
        });
      } catch (error) {
        console.error('[llm-proxy] OpenAI upstream request failed', error);
        return createJsonErrorResponse(502, 'Failed to reach OpenAI upstream.');
      }

      logProgress(`received upstream status=${upstreamResponse.status}`);
      const upstream = await readUpstreamResponse(upstreamResponse);
      logProgress(`response status=${upstream.status} preview="${summarizeBodyForLog(upstream.body, upstream.headers['content-type'])}"`);
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
      body: body as unknown as BodyInit
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
  logProxyEvent(
    sequence,
    `response provider=openai kind=${requestKind} status=${upstream.status} preview="${summarizeBodyForLog(upstream.body, upstream.headers['content-type'])}"`
  );
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
  const requestPreview = summarizeBodyForLog(body, readHeaderValue(request.headers['content-type']));
  logProxyEvent(sequence, `request provider=gemini kind=${requestKind} preview="${requestPreview}"`);
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
  logProxyEvent(sequence, `request provider=codex kind=${requestKind} preview="${summarizeBodyForLog(body, 'application/json')}"`);
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

      logProgress(`response status=${upstream.status} preview="${summarizeBodyForLog(upstream.body, upstream.headers['content-type'])}"`);
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

  logProxyEvent(
    sequence,
    `response provider=codex kind=${requestKind} status=${upstream.status} preview="${summarizeBodyForLog(upstream.body, upstream.headers['content-type'])}"`
  );
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
  const emitProgress = (message: string) => {
    if (input.logProgress) {
      input.logProgress(message);
      return;
    }
    logProxyEvent(input.sequence, message);
  };
  const begin = await geminiAnalyticsStore.beginRequest({
    actor: input.actor,
    model: input.model,
    requestKind: input.requestKind
  });

  if (!begin.allowed) {
    emitProgress(`blocked by Gemini daily limits day=${begin.day}`);
    return createJsonErrorResponse(429, begin.reason, {
      code: 'GEMINI_DAILY_LIMIT_REACHED',
      day: begin.day,
      usage: begin.snapshot.totals
    }, {
      'Retry-After': '3600'
    });
  }

  emitProgress(`requesting upstream ${input.upstreamPath} actor=${input.actor}`);
  emitProgress(`request preview="${summarizeBodyForLog(input.body, input.contentType)}"`);

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(input.upstreamUrl, {
      method: 'POST',
      headers: {
        Accept: input.accept ?? 'application/json',
        'Content-Type': input.contentType ?? 'application/json'
      },
      body: input.body as unknown as BodyInit
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

  emitProgress(`received upstream status=${upstreamResponse.status}`);
  const upstream = await readUpstreamResponse(upstreamResponse);
  emitProgress(`response preview="${summarizeBodyForLog(upstream.body, upstream.headers['content-type'])}"`);
  const usage = extractGeminiUsageMetadata(upstream.body);
  if (usage) {
    emitProgress(
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
      logProxyEvent(input.sequence, message);
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

function createJsonResponse(
  status: number,
  payload: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
): ProxyAsyncJobResponse {
  return {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders
    },
    body: Buffer.from(JSON.stringify(payload), 'utf8')
  };
}

function serializeDocumentRecord(document: StoredDocumentRecord): Record<string, unknown> {
  return {
    id: document.id,
    actor: document.actor,
    fileHash: document.fileHash,
    fileName: document.fileName,
    mimeType: document.mimeType,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    interactionCount: document.interactionCount,
    detection: {
      status: document.detection.state,
      ...(document.detection.jobId ? { jobId: document.detection.jobId } : {}),
      ...(document.detection.provider ? { provider: document.detection.provider } : {}),
      ...(document.detection.model ? { model: document.detection.model } : {}),
      ...(typeof document.detection.totalPages === 'number' ? { totalPages: document.detection.totalPages } : {}),
      ...(typeof document.detection.completedPages === 'number' ? { completedPages: document.detection.completedPages } : {}),
      ...(typeof document.detection.publishedPages === 'number' ? { publishedPages: document.detection.publishedPages } : {}),
      ...(document.detection.error ? { error: document.detection.error } : {}),
      updatedAt: document.detection.updatedAt
    }
  };
}

async function resolveAuthorizedTaskDocument(
  actor: string,
  documentId: string | null
): Promise<StoredDocumentRecord | null> {
  if (!documentId) {
    return null;
  }
  const document = await taskStore.getDocument(documentId);
  if (!document || document.actor !== actor) {
    throw new Error('Unknown task document.');
  }
  return document;
}

function buildTaskCacheKey(
  taskType: string,
  actor: string,
  body: Buffer,
  meta: Record<string, unknown> = {}
): string {
  return createHash('sha256')
    .update(JSON.stringify({
      taskType,
      actor,
      bodyHash: responseCache.buildBodyHash(body),
      meta
    }))
    .digest('hex');
}

function shouldForceTaskRefresh(requestUrl: URL): boolean {
  const raw = normalizeNonEmpty(requestUrl.searchParams.get('refresh') ?? undefined)?.toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'force';
}

function normalizeStructuredDetectProvider(value: string | null): 'gemini' | 'openai' | null {
  const normalized = normalizeNonEmpty(value ?? undefined)?.toLowerCase();
  if (normalized === 'gemini' || normalized === 'openai') {
    return normalized;
  }
  return null;
}

function normalizeTextTaskProvider(value: unknown): TaskTextProvider | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'gemini' || normalized === 'openai' || normalized === 'codex') {
    return normalized;
  }
  return null;
}

function normalizeOpenAiCompatibleTaskProvider(value: unknown): 'openai' | 'codex' | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'openai' || normalized === 'codex') {
    return normalized;
  }
  return null;
}

function normalizeImageTaskProvider(value: unknown): TaskImageProvider | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'gemini' || normalized === 'openai') {
    return normalized;
  }
  return null;
}

function normalizeSemanticTaskProvider(value: unknown): TaskSemanticProvider | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'gemini' || normalized === 'openai') {
    return normalized;
  }
  return null;
}

function normalizeTaskImagePayload(body: Record<string, unknown>): { mimeType: string; base64Data: string } | null {
  const imageDataUri = normalizeNonEmptyString(body.imageDataUri);
  if (imageDataUri) {
    const match = /^data:([^;,]+);base64,(.+)$/i.exec(imageDataUri);
    if (match) {
      return {
        mimeType: match[1]!,
        base64Data: match[2]!
      };
    }
  }

  const mimeType = normalizeNonEmptyString(body.mimeType);
  const base64Data = normalizeNonEmptyString(body.base64Data);
  if (mimeType && base64Data) {
    return { mimeType, base64Data };
  }
  return null;
}

function summarizePromptInput(prompt: string, body: Record<string, unknown>): Record<string, unknown> {
  return {
    promptChars: prompt.length,
    promptPreview: prompt.slice(0, 240),
    ...(typeof body.selectionText === 'string' ? { selectionChars: body.selectionText.length } : {})
  };
}

function summarizeTextOutput(text: string): Record<string, unknown> {
  return {
    textChars: text.length,
    textPreview: text.slice(0, 240)
  };
}

function summarizeDetectionResult(result: {
  document: Record<string, unknown>;
  parsedTables: unknown[];
  assetMap: Record<string, string>;
  model: string;
}): Record<string, unknown> {
  const document = result.document as { elements?: unknown[]; pages?: unknown[] };
  return {
    model: result.model,
    elements: Array.isArray(document.elements) ? document.elements.length : 0,
    pages: Array.isArray(document.pages) ? document.pages.length : 0,
    parsedTables: result.parsedTables.length,
    assetCount: Object.keys(result.assetMap).length
  };
}

function defaultSemanticTaskModel(provider: TaskSemanticProvider): string {
  return provider === 'openai' ? 'text-embedding-3-small' : 'gemini-embedding-001';
}

function normalizeSemanticChunks(value: unknown): SemanticTextChunk[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const chunks: SemanticTextChunk[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    const candidate = entry as Record<string, unknown>;
    const id = normalizeNonEmptyString(candidate.id);
    const text = normalizeNonEmptyString(candidate.text);
    const pageNumber = normalizeOptionalFiniteNumber(candidate.pageNumber);
    const sentenceIndex = normalizeOptionalFiniteNumber(candidate.sentenceIndex);
    const bounds = normalizeSemanticChunkBounds(candidate.bounds);
    if (!id || !text || typeof pageNumber !== 'number' || typeof sentenceIndex !== 'number' || !bounds) {
      return null;
    }
    chunks.push({
      id,
      text,
      pageNumber,
      sentenceIndex,
      bounds
    });
  }
  return chunks;
}

function normalizeSemanticChunkBounds(value: unknown): SemanticChunkBounds | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const minX = normalizeOptionalFiniteNumber(candidate.minX);
  const minY = normalizeOptionalFiniteNumber(candidate.minY);
  const maxX = normalizeOptionalFiniteNumber(candidate.maxX);
  const maxY = normalizeOptionalFiniteNumber(candidate.maxY);
  if ([minX, minY, maxX, maxY].some((item) => typeof item !== 'number')) {
    return null;
  }
  return {
    minX: minX as number,
    minY: minY as number,
    maxX: maxX as number,
    maxY: maxY as number
  };
}

function normalizeHtmlDocumentLayout(value: unknown): HtmlDocumentLayout | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate.pages) ? (candidate as unknown as HtmlDocumentLayout) : null;
}

function normalizeOptionalFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return undefined;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function logProxyRequest(provider: 'openai' | 'gemini' | 'codex' | 'task', requestKind: string, pathname: string): void {
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
  provider: 'openai' | 'gemini' | 'codex' | 'task';
  requestKind: string;
  cacheStatus: 'HIT' | 'MISS' | 'BYPASS' | 'ERROR';
  durationMs: number;
  extras?: string;
}): void {
  console.log(
    `[llm-proxy]${typeof input.sequence === 'number' ? ` seq=${input.sequence}` : ''} end provider=${input.provider} kind=${input.requestKind} cache=${input.cacheStatus} durationMs=${input.durationMs}${input.extras ? ` ${input.extras}` : ''}`
  );
}

function logProxyEvent(sequence: number, message: string): void {
  console.log(`[llm-proxy] seq=${sequence} ${message}`);
}

function logCodexProxyEvent(sequence: number, message: string): void {
  logProxyEvent(sequence, message);
}

function summarizeTextForLog(value: string, maxChars = LOG_PREVIEW_MAX_CHARS): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`;
}

function summarizeBodyForLog(body: Buffer, contentType?: string): string {
  const normalizedContentType = normalizeNonEmpty(contentType)?.toLowerCase() ?? '';
  if (
    normalizedContentType.includes('application/pdf') ||
    normalizedContentType.includes('application/octet-stream')
  ) {
    return `<binary ${body.length} bytes>`;
  }

  const text = body.toString('utf8').trim();
  if (!text) {
    return '<empty>';
  }

  const parsed = safeParseJson(text);
  if (parsed !== null) {
    const preview = extractStructuredLogPreview(parsed);
    if (preview) {
      return summarizeTextForLog(preview);
    }
  }

  return summarizeTextForLog(text);
}

function extractStructuredLogPreview(value: unknown): string | null {
  const parts: string[] = [];
  collectStructuredLogPreview(value, parts, 0, '');
  if (parts.length === 0) {
    return null;
  }
  return parts.join(' | ');
}

function collectStructuredLogPreview(
  value: unknown,
  parts: string[],
  depth: number,
  key: string
): void {
  if (parts.length >= LOG_PREVIEW_STRING_LIMIT || depth > 6 || value === null || value === undefined) {
    return;
  }

  const normalizedKey = key.toLowerCase();
  if (
    normalizedKey === 'data' ||
    normalizedKey === 'inline_data' ||
    normalizedKey === 'inlinedata' ||
    normalizedKey === 'base64data' ||
    normalizedKey === 'bytes'
  ) {
    return;
  }

  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized || looksLikeEncodedBlob(normalized)) {
      return;
    }
    parts.push(normalized);
    return;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    parts.push(String(value));
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStructuredLogPreview(entry, parts, depth + 1, key);
      if (parts.length >= LOG_PREVIEW_STRING_LIMIT) {
        return;
      }
    }
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
    if (parts.length >= LOG_PREVIEW_STRING_LIMIT) {
      return;
    }
    collectStructuredLogPreview(entryValue, parts, depth + 1, entryKey);
  }
}

function looksLikeEncodedBlob(value: string): boolean {
  return value.length > 80 && /^[A-Za-z0-9+/=:_-]+$/.test(value);
}

function safeParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
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
    tasks: {
      dataDir: normalizeNonEmpty(env.LLM_PROXY_TASKS_DIR) ?? '.cache/llm-proxy-tasks',
      structuredDetectPageConcurrency: normalizePositiveNumber(env.LLM_PROXY_TASKS_DETECT_PAGE_CONCURRENCY, 2),
      structuredDetectBatchSize: normalizePositiveNumber(env.LLM_PROXY_TASKS_DETECT_BATCH_SIZE, 3),
      structuredDetectInitialPageCount: normalizePositiveNumber(env.LLM_PROXY_TASKS_DETECT_FIRST_PAGES, 3),
      structuredDetectMinSplitBytes: normalizePositiveNumber(env.LLM_PROXY_TASKS_DETECT_MIN_SPLIT_BYTES, 1024 * 1024)
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
