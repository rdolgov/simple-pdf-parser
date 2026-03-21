import { fetchWithLlmProxyPolling } from '../../../src/query/llmProxyPolling';
import { getLlmProxyAuthToken, getLlmProxyBaseUrl } from '../utils/llmTransportSettings';

export type ProxyTaskTextProvider = 'gemini' | 'openai' | 'codex';
export type ProxyTaskImageProvider = 'gemini' | 'openai';
export type ProxyTaskSemanticProvider = 'gemini' | 'openai';

export interface ProxyTaskSemanticChunk {
  id: string;
  text: string;
  pageNumber: number;
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  sentenceIndex: number;
}

export interface ProxyTaskDocumentRecord {
  id: string;
  actor: string;
  fileHash: string;
  fileName: string;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
  interactionCount: number;
  detection: {
    status: 'idle' | 'pending' | 'ready' | 'error';
    updatedAt: string;
    jobId?: string;
    provider?: string;
    model?: string;
    totalPages?: number;
    completedPages?: number;
    publishedPages?: number;
    error?: string;
  };
}

export interface ProxyTaskDocumentResponse {
  document: ProxyTaskDocumentRecord;
  detection: {
    status: 'idle' | 'pending' | 'ready' | 'error';
    jobId?: string;
    provider?: string;
    model?: string;
    totalPages?: number;
    completedPages?: number;
    publishedPages?: number;
    error?: string;
    result?: Record<string, unknown> | null;
    pollUrl?: string;
    documentUrl?: string;
  };
}

export interface ProxyTaskTextResponse {
  text: string;
  model: string;
}

export interface ProxyTaskImageResponse {
  dataUri: string;
  mimeType: string;
  model: string;
  prompt?: string;
}

export interface ProxyTaskRelevanceResponse {
  annotations: Array<{
    pageNumber: number;
    blockIndex: number;
    state: 'highlight' | 'dim' | 'hidden';
    summary?: string;
    rewrittenText?: string;
    rationale?: string;
    confidence?: number;
    matchRanges?: Array<{ start: number; end: number }>;
  }>;
  model?: string;
  createdAt?: string;
  querySummary?: string;
}

export interface ProxyTaskSemanticIndexResponse {
  documentId: string;
  documentHash: string;
  provider: ProxyTaskSemanticProvider;
  model: string;
  chunkCount: number;
  createdAt: string;
}

export interface ProxyTaskSemanticSearchResponse {
  provider: ProxyTaskSemanticProvider;
  model: string;
  results: Array<{
    chunk: ProxyTaskSemanticChunk & { embedding: number[] };
    score: number;
  }>;
}

export async function uploadPdfAndStartDetection(input: {
  file: File;
  fileHash?: string | null;
  provider?: 'gemini' | 'openai';
  model?: string | null;
  refresh?: boolean;
}): Promise<ProxyTaskDocumentResponse> {
  const endpoint = new URL(`${getProxyTasksBaseUrl()}/documents`, window.location.origin);
  if (input.provider) {
    endpoint.searchParams.set('provider', input.provider);
  }
  if (input.model?.trim()) {
    endpoint.searchParams.set('model', input.model.trim());
  }
  if (input.refresh) {
    endpoint.searchParams.set('refresh', 'true');
  }

  const response = await fetch(endpoint.toString(), {
    method: 'POST',
    headers: withTaskHeaders({
      'Content-Type': input.file.type || 'application/pdf',
      'X-Document-Name': input.file.name,
      ...(input.fileHash?.trim() ? { 'X-Document-Hash': input.fileHash.trim() } : {})
    }),
    body: await input.file.arrayBuffer()
  });
  return parseJsonResponse<ProxyTaskDocumentResponse>(response);
}

export async function getTaskDocument(documentId: string): Promise<ProxyTaskDocumentResponse> {
  const response = await fetchWithLlmProxyPolling(fetch, `${getProxyTasksBaseUrl()}/documents/${encodeURIComponent(documentId)}`, {
    method: 'GET',
    headers: withTaskHeaders()
  });
  return parseJsonResponse<ProxyTaskDocumentResponse>(response);
}

export async function waitForTaskDocumentDetection(
  documentId: string,
  options?: {
    pollIntervalMs?: number;
    timeoutMs?: number;
    onUpdate?: (response: ProxyTaskDocumentResponse) => void | Promise<void>;
  }
): Promise<ProxyTaskDocumentResponse> {
  const pollIntervalMs = Math.max(100, options?.pollIntervalMs ?? 1500);
  const timeoutMs = Math.max(pollIntervalMs, options?.timeoutMs ?? 15 * 60 * 1000);
  const startedAt = Date.now();

  while (true) {
    const response = await getTaskDocument(documentId);
    await options?.onUpdate?.(response);
    if (response.detection.status === 'ready' && response.detection.result) {
      return response;
    }
    if (response.detection.status === 'error') {
      throw new Error(response.detection.error ?? 'Task document detection failed.');
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Task document detection timed out after ${timeoutMs}ms.`);
    }
    await delay(pollIntervalMs);
  }
}

export async function askQuestionTask(input: {
  documentId?: string | null;
  prompt: string;
  provider?: ProxyTaskTextProvider;
  model?: string | null;
  enableWebSearch?: boolean;
}): Promise<ProxyTaskTextResponse> {
  return postJsonTask<ProxyTaskTextResponse>('ask-question', input);
}

export async function generateWidgetTask(input: {
  documentId?: string | null;
  prompt: string;
  provider?: ProxyTaskTextProvider;
  model?: string | null;
}): Promise<ProxyTaskTextResponse> {
  return postJsonTask<ProxyTaskTextResponse>('generate-widget', input);
}

export async function analyzeFormulaTask(input: {
  documentId?: string | null;
  prompt: string;
  provider?: ProxyTaskTextProvider;
  model?: string | null;
}): Promise<ProxyTaskTextResponse> {
  return postJsonTask<ProxyTaskTextResponse>('analyze-formula', input);
}

export async function generateLogicalStructureTask(input: {
  documentId?: string | null;
  prompt: string;
  provider?: ProxyTaskTextProvider;
  model?: string | null;
}): Promise<ProxyTaskTextResponse> {
  return postJsonTask<ProxyTaskTextResponse>('logical-structure', input);
}

export async function analyzeRelevanceTask(input: {
  documentId?: string | null;
  query: string;
  document: Record<string, unknown>;
  provider?: 'openai' | 'codex';
  model?: string | null;
  maxContextTokens?: number;
}): Promise<ProxyTaskRelevanceResponse> {
  return postJsonTask<ProxyTaskRelevanceResponse>('analyze-relevance', input);
}

export async function analyzeImageTask(input: {
  documentId?: string | null;
  prompt: string;
  imageDataUri: string;
  provider?: ProxyTaskImageProvider;
  model?: string | null;
}): Promise<ProxyTaskTextResponse> {
  return postJsonTask<ProxyTaskTextResponse>('analyze-image', input);
}

export async function generateImageTask(input: {
  documentId?: string | null;
  prompt: string;
  provider?: ProxyTaskImageProvider;
  model?: string | null;
}): Promise<ProxyTaskImageResponse> {
  return postJsonTask<ProxyTaskImageResponse>('generate-image', input);
}

export async function generateTableInfographicTask(input: {
  documentId?: string | null;
  prompt: string;
  provider?: ProxyTaskImageProvider;
  model?: string | null;
}): Promise<ProxyTaskImageResponse> {
  return postJsonTask<ProxyTaskImageResponse>('generate-table-infographic', input);
}

export async function buildSemanticIndexTask(input: {
  documentId: string;
  documentHash: string;
  chunks: ProxyTaskSemanticChunk[];
  provider?: ProxyTaskSemanticProvider;
  model?: string | null;
  refresh?: boolean;
}): Promise<ProxyTaskSemanticIndexResponse> {
  const endpoint = new URL(`${getProxyTasksBaseUrl()}/build-semantic-index`, window.location.origin);
  if (input.refresh) {
    endpoint.searchParams.set('refresh', 'true');
  }
  const response = await fetchWithLlmProxyPolling(fetch, endpoint.toString(), {
    method: 'POST',
    headers: withTaskHeaders({
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify(input)
  });
  return parseJsonResponse<ProxyTaskSemanticIndexResponse>(response);
}

export async function searchSemanticTask(input: {
  documentId: string;
  query: string;
  provider?: ProxyTaskSemanticProvider;
  model?: string | null;
  topK?: number;
  minScore?: number;
}): Promise<ProxyTaskSemanticSearchResponse> {
  return postJsonTask<ProxyTaskSemanticSearchResponse>('search-semantic', input);
}

async function postJsonTask<T>(taskName: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetchWithLlmProxyPolling(fetch, `${getProxyTasksBaseUrl()}/${taskName}`, {
    method: 'POST',
    headers: withTaskHeaders({
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify(body)
  });
  return parseJsonResponse<T>(response);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await safeReadError(response);
    throw new Error(message);
  }
  return (await response.json()) as T;
}

async function safeReadError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
      return payload.error;
    }
  } catch {
    // Ignore JSON parse errors.
  }
  return `Task request failed with status ${response.status}.`;
}

function withTaskHeaders(headers: Record<string, string> = {}): Headers {
  const next = new Headers(headers);
  const authToken = getLlmProxyAuthToken()?.trim();
  if (authToken && !next.has('X-LLM-Proxy-Auth')) {
    next.set('X-LLM-Proxy-Auth', authToken);
  }
  return next;
}

function getProxyTasksBaseUrl(): string {
  return getLlmProxyBaseUrl().trim().replace(/\/+$/, '');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
