import { LMStudioAPI, type LMStudioConfig } from './lmStudioApi.js';
import { normalizeProviderApiError, readFormattedOpenAiErrorBody } from './apiErrorUtils.js';
import { fetchWithLlmProxyPolling } from './llmProxyPolling.js';

export type EmbeddingProvider = 'lmstudio' | 'openai' | 'gemini';
export type EmbeddingTaskType = 'retrieval_document' | 'retrieval_query';

export interface EmbeddingApiConfig {
  provider?: EmbeddingProvider;
  apiKey?: string;
  model?: string;
  endpoint?: string;
  apiVersion?: string;
  lmStudio?: LMStudioConfig;
}

export interface EmbeddingRequest {
  input: string | string[];
  model?: string;
  taskType?: EmbeddingTaskType;
  title?: string;
}

export interface EmbeddingResult {
  embeddings: number[][];
  model: string;
  provider: EmbeddingProvider;
  usage?: Record<string, unknown>;
  raw: unknown;
}

export const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';

const DEFAULT_OPENAI_EMBEDDINGS_ENDPOINT = 'https://api.openai.com/v1/embeddings';
const DEFAULT_GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com';
const DEFAULT_GEMINI_API_VERSION = 'v1beta';

export class EmbeddingAPI {
  private readonly provider: EmbeddingProvider;
  private readonly apiKey?: string;
  private readonly defaultModel?: string;
  private readonly endpoint?: string;
  private readonly apiVersion?: string;
  private readonly lmStudio?: LMStudioConfig;

  constructor(config?: EmbeddingApiConfig) {
    this.provider = config?.provider ?? 'lmstudio';
    this.apiKey = config?.apiKey;
    this.defaultModel = config?.model;
    this.endpoint = config?.endpoint;
    this.apiVersion = config?.apiVersion;
    this.lmStudio = config?.lmStudio;
  }

  async generateEmbedding(request: EmbeddingRequest): Promise<EmbeddingResult> {
    switch (this.provider) {
      case 'openai':
        return this.generateOpenAiEmbedding(request);
      case 'gemini':
        return this.generateGeminiEmbedding(request);
      case 'lmstudio':
      default:
        return this.generateLmStudioEmbedding(request);
    }
  }

  resolveModel(model?: string): string {
    const requested = model?.trim();
    if (requested) {
      return requested;
    }
    const configured = this.defaultModel?.trim();
    if (configured) {
      return configured;
    }
    switch (this.provider) {
      case 'openai':
        return DEFAULT_OPENAI_EMBEDDING_MODEL;
      case 'gemini':
        return DEFAULT_GEMINI_EMBEDDING_MODEL;
      case 'lmstudio':
      default:
        return this.lmStudio?.defaultModel?.trim() || 'text-embedding-nomic-embed-text-v2-moe';
    }
  }

  private async generateLmStudioEmbedding(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const client = new LMStudioAPI(this.lmStudio);
    const result = await client.generateEmbedding({
      input: request.input,
      model: request.model ?? this.defaultModel
    });
    return {
      embeddings: result.embeddings,
      model: result.model,
      provider: 'lmstudio',
      usage: result.usage as Record<string, unknown> | undefined,
      raw: result.raw
    };
  }

  private async generateOpenAiEmbedding(request: EmbeddingRequest): Promise<EmbeddingResult> {
    if (!this.apiKey || this.apiKey.trim().length === 0) {
      throw new Error('OpenAI API key is required for semantic search embeddings.');
    }

    const model = this.resolveModel(request.model);
    const fetchImpl = resolveFetch();
    let response: Response;
    try {
      response = await fetchWithLlmProxyPolling(fetchImpl, normalizeOpenAiEmbeddingsEndpoint(this.endpoint), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey.trim()}`
        },
        body: JSON.stringify({
          model,
          input: request.input
        })
      });
    } catch (error) {
      throw normalizeProviderApiError('OpenAI', error);
    }

    if (!response.ok) {
      const message = await readFormattedOpenAiErrorBody(response);
      throw new Error(`OpenAI embeddings request failed with status ${response.status}: ${message}`);
    }

    const raw = (await response.json()) as Record<string, unknown>;
    const embeddings = extractEmbeddingsFromOpenAi(raw);
    const responseModel = readString(raw.model) ?? model;
    const usage = isRecord(raw.usage) ? raw.usage : undefined;

    return {
      embeddings,
      model: responseModel,
      provider: 'openai',
      usage,
      raw
    };
  }

  private async generateGeminiEmbedding(request: EmbeddingRequest): Promise<EmbeddingResult> {
    if (!this.apiKey || this.apiKey.trim().length === 0) {
      throw new Error('Gemini API key is required for semantic search embeddings.');
    }

    const model = this.resolveModel(request.model);
    const inputs = Array.isArray(request.input) ? request.input : [request.input];
    if (inputs.length === 0) {
      throw new Error('Gemini embeddings request input is empty.');
    }

    const batchResult = await this.tryGeminiBatchEmbedding(inputs, model, request);
    if (batchResult) {
      return batchResult;
    }

    const embeddings: number[][] = [];
    const rawResponses: unknown[] = [];
    for (const text of inputs) {
      const single = await this.generateGeminiSingleEmbedding(text, model, request);
      embeddings.push(single.embedding);
      rawResponses.push(single.raw);
    }

    return {
      embeddings,
      model,
      provider: 'gemini',
      raw: { fallback: 'single', responses: rawResponses }
    };
  }

  private async tryGeminiBatchEmbedding(
    inputs: string[],
    model: string,
    request: EmbeddingRequest
  ): Promise<EmbeddingResult | null> {
    const fetchImpl = resolveFetch();
    let response: Response;
    try {
      response = await fetchWithLlmProxyPolling(
        fetchImpl,
        buildGeminiBatchEmbeddingsUrl(this.endpoint, this.apiVersion, model, this.apiKey as string),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            requests: inputs.map((text) => buildGeminiEmbeddingRequestBody(text, model, request))
          })
        }
      );
    } catch (error) {
      throw normalizeProviderApiError('Gemini', error);
    }

    if (!response.ok) {
      if (response.status === 400 || response.status === 404) {
        return null;
      }
      const message = normalizeProviderApiError('Gemini', await safeReadText(response)).message;
      throw new Error(`Gemini embeddings request failed with status ${response.status}: ${message}`);
    }

    const raw = (await response.json()) as Record<string, unknown>;
    const embeddings = extractEmbeddingsFromGemini(raw);
    return {
      embeddings,
      model,
      provider: 'gemini',
      raw
    };
  }

  private async generateGeminiSingleEmbedding(
    text: string,
    model: string,
    request: EmbeddingRequest
  ): Promise<{ embedding: number[]; raw: unknown }> {
    const fetchImpl = resolveFetch();
    let response: Response;
    try {
      response = await fetchWithLlmProxyPolling(
        fetchImpl,
        buildGeminiSingleEmbeddingUrl(this.endpoint, this.apiVersion, model, this.apiKey as string),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(buildGeminiEmbeddingRequestBody(text, model, request, true))
        }
      );
    } catch (error) {
      throw normalizeProviderApiError('Gemini', error);
    }

    if (!response.ok) {
      const message = normalizeProviderApiError('Gemini', await safeReadText(response)).message;
      throw new Error(`Gemini embeddings request failed with status ${response.status}: ${message}`);
    }

    const raw = (await response.json()) as Record<string, unknown>;
    const embedding = extractSingleEmbeddingFromGemini(raw);
    return { embedding, raw };
  }
}

function normalizeOpenAiEmbeddingsEndpoint(endpoint?: string): string {
  if (!endpoint) {
    return DEFAULT_OPENAI_EMBEDDINGS_ENDPOINT;
  }
  const trimmed = endpoint.trim();
  if (trimmed.length === 0) {
    return DEFAULT_OPENAI_EMBEDDINGS_ENDPOINT;
  }
  if (trimmed.endsWith('/embeddings')) {
    return trimmed;
  }
  if (trimmed.endsWith('/responses')) {
    return `${trimmed.slice(0, -'/responses'.length)}/embeddings`;
  }
  return `${trimmed.replace(/\/+$/, '')}/embeddings`;
}

function buildGeminiBatchEmbeddingsUrl(endpoint: string | undefined, apiVersion: string | undefined, model: string, apiKey: string): string {
  const base = normalizeGeminiEndpointBase(endpoint);
  const version = normalizeGeminiApiVersion(apiVersion);
  const modelId = normalizeGeminiModelId(model);
  return `${base}/${version}/models/${encodeURIComponent(modelId)}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`;
}

function buildGeminiSingleEmbeddingUrl(endpoint: string | undefined, apiVersion: string | undefined, model: string, apiKey: string): string {
  const base = normalizeGeminiEndpointBase(endpoint);
  const version = normalizeGeminiApiVersion(apiVersion);
  const modelId = normalizeGeminiModelId(model);
  return `${base}/${version}/models/${encodeURIComponent(modelId)}:embedContent?key=${encodeURIComponent(apiKey)}`;
}

function normalizeGeminiEndpointBase(endpoint?: string): string {
  const raw = endpoint?.trim();
  if (!raw) {
    return DEFAULT_GEMINI_ENDPOINT;
  }
  return raw.replace(/\/+$/, '');
}

function normalizeGeminiApiVersion(apiVersion?: string): string {
  const raw = apiVersion?.trim();
  if (!raw) {
    return DEFAULT_GEMINI_API_VERSION;
  }
  return raw.replace(/^\/+/, '').replace(/\/+$/, '');
}

function normalizeGeminiModelId(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return DEFAULT_GEMINI_EMBEDDING_MODEL;
  }
  return trimmed.replace(/^models\//, '');
}

function buildGeminiEmbeddingRequestBody(
  text: string,
  model: string,
  request: EmbeddingRequest,
  singleEndpoint = false
): Record<string, unknown> {
  const taskType = toGeminiTaskType(request.taskType);
  const body: Record<string, unknown> = {
    content: {
      parts: [{ text }]
    }
  };

  if (!singleEndpoint) {
    body.model = `models/${normalizeGeminiModelId(model)}`;
  }
  if (taskType) {
    body.taskType = taskType;
  }
  if (request.title && request.title.trim().length > 0) {
    body.title = request.title.trim();
  }
  return body;
}

function toGeminiTaskType(taskType: EmbeddingTaskType | undefined): string | undefined {
  if (!taskType) {
    return undefined;
  }
  return taskType === 'retrieval_query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';
}

function extractEmbeddingsFromOpenAi(raw: Record<string, unknown>): number[][] {
  const data = raw.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('OpenAI embeddings response did not include data');
  }
  const embeddings: number[][] = [];
  for (const item of data) {
    if (!isRecord(item)) {
      continue;
    }
    const embedding = item.embedding;
    if (Array.isArray(embedding) && embedding.every((value) => typeof value === 'number')) {
      embeddings.push(embedding as number[]);
    }
  }
  if (embeddings.length === 0) {
    throw new Error('OpenAI embeddings response did not include embedding vectors');
  }
  return embeddings;
}

function extractEmbeddingsFromGemini(raw: Record<string, unknown>): number[][] {
  const direct = raw.embeddings;
  if (!Array.isArray(direct) || direct.length === 0) {
    throw new Error('Gemini embeddings response did not include embeddings');
  }
  const embeddings: number[][] = [];
  for (const item of direct) {
    if (!isRecord(item)) {
      continue;
    }
    const values = item.values;
    if (Array.isArray(values) && values.every((value) => typeof value === 'number')) {
      embeddings.push(values as number[]);
      continue;
    }
    if (isRecord(item.embedding) && Array.isArray(item.embedding.values)) {
      const nestedValues = item.embedding.values;
      if (nestedValues.every((value) => typeof value === 'number')) {
        embeddings.push(nestedValues as number[]);
      }
    }
  }
  if (embeddings.length === 0) {
    throw new Error('Gemini embeddings response did not include embedding vectors');
  }
  return embeddings;
}

function extractSingleEmbeddingFromGemini(raw: Record<string, unknown>): number[] {
  if (isRecord(raw.embedding) && Array.isArray(raw.embedding.values)) {
    const values = raw.embedding.values;
    if (values.every((value) => typeof value === 'number')) {
      return values as number[];
    }
  }
  const all = extractEmbeddingsFromGemini({
    embeddings: Array.isArray(raw.embeddings) ? raw.embeddings : []
  });
  if (all[0]) {
    return all[0];
  }
  throw new Error('Gemini embeddings response did not include embedding values');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveFetch(): typeof fetch {
  if (typeof fetch === 'function') {
    return fetch;
  }
  if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') {
    return globalThis.fetch;
  }
  throw new Error('A global fetch implementation is required to call embedding providers.');
}

async function safeReadText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 0 ? text : response.statusText;
  } catch (error) {
    return error instanceof Error ? error.message : 'unable to read error body';
  }
}
