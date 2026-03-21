import {
  EmbeddingAPI,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  type EmbeddingProvider
} from '../../src/index.js';

export type TaskSemanticProvider = Extract<EmbeddingProvider, 'gemini' | 'openai'>;

export interface SemanticChunkBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SemanticTextChunk {
  id: string;
  text: string;
  pageNumber: number;
  bounds: SemanticChunkBounds;
  sentenceIndex: number;
}

export interface SemanticEmbeddedChunk extends SemanticTextChunk {
  embedding: number[];
}

export interface StoredSemanticIndex {
  schemaVersion: number;
  documentId: string;
  documentHash: string;
  provider: TaskSemanticProvider;
  model: string;
  createdAt: string;
  chunkCount: number;
  chunks: SemanticEmbeddedChunk[];
}

export interface SemanticSearchHit {
  chunk: SemanticEmbeddedChunk;
  score: number;
}

export interface TaskServerSemanticConfig {
  openAiBaseUrl: string;
  openAiApiKey?: string;
  geminiBaseUrl: string;
  geminiApiKey?: string;
}

export const SEMANTIC_INDEX_SCHEMA_VERSION = 1;

export async function buildSemanticIndex(
  input: {
    documentId: string;
    documentHash: string;
    provider?: TaskSemanticProvider;
    model?: string;
    chunks: SemanticTextChunk[];
  },
  config: TaskServerSemanticConfig,
  onProgress?: (processed: number, total: number) => void
): Promise<StoredSemanticIndex> {
  const provider = input.provider ?? 'gemini';
  const api = createEmbeddingApi(provider, input.model, config);
  const embeddedChunks: SemanticEmbeddedChunk[] = [];
  const total = input.chunks.length;
  const batchSize = 10;

  for (let index = 0; index < input.chunks.length; index += batchSize) {
    const batch = input.chunks.slice(index, index + batchSize);
    const result = await api.generateEmbedding({
      input: batch.map((chunk) => chunk.text),
      taskType: 'retrieval_document'
    });

    for (let offset = 0; offset < batch.length; offset += 1) {
      const chunk = batch[offset];
      const embedding = result.embeddings[offset];
      if (!chunk || !embedding) {
        continue;
      }
      embeddedChunks.push({
        ...chunk,
        embedding
      });
    }

    onProgress?.(Math.min(index + batch.length, total), total);
  }

  if (embeddedChunks.length === 0) {
    throw new Error('Failed to generate semantic index embeddings.');
  }

  return {
    schemaVersion: SEMANTIC_INDEX_SCHEMA_VERSION,
    documentId: input.documentId,
    documentHash: input.documentHash,
    provider,
    model: api.resolveModel(input.model),
    createdAt: new Date().toISOString(),
    chunkCount: embeddedChunks.length,
    chunks: embeddedChunks
  };
}

export async function searchSemanticIndex(
  input: {
    index: StoredSemanticIndex;
    query: string;
    provider?: TaskSemanticProvider;
    model?: string;
    topK?: number;
    minScore?: number;
  },
  config: TaskServerSemanticConfig
): Promise<{
  provider: TaskSemanticProvider;
  model: string;
  results: SemanticSearchHit[];
}> {
  const provider = input.provider ?? input.index.provider;
  const api = createEmbeddingApi(provider, input.model ?? input.index.model, config);
  const queryResult = await api.generateEmbedding({
    input: input.query,
    taskType: 'retrieval_query'
  });
  const queryEmbedding = queryResult.embeddings[0];
  if (!queryEmbedding) {
    throw new Error('Failed to generate semantic query embedding.');
  }

  const topK = normalizePositiveInteger(input.topK, 10);
  const minScore = normalizeFiniteNumber(input.minScore, 0.3);
  const results = input.index.chunks
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding)
    }))
    .filter((entry) => entry.score >= minScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);

  return {
    provider,
    model: api.resolveModel(input.model ?? input.index.model),
    results
  };
}

export function createSemanticIndexFingerprint(provider: TaskSemanticProvider, model: string): string {
  return `${SEMANTIC_INDEX_SCHEMA_VERSION}:${provider}:${model.trim() || defaultSemanticModel(provider)}`;
}

function createEmbeddingApi(
  provider: TaskSemanticProvider,
  model: string | undefined,
  config: TaskServerSemanticConfig
): EmbeddingAPI {
  if (provider === 'openai') {
    if (!config.openAiApiKey) {
      throw new Error('OPENAI_API_KEY is not configured on the proxy server.');
    }
    return new EmbeddingAPI({
      provider,
      apiKey: config.openAiApiKey,
      endpoint: config.openAiBaseUrl,
      ...(model?.trim() ? { model: model.trim() } : {})
    });
  }

  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the proxy server.');
  }
  return new EmbeddingAPI({
    provider,
    apiKey: config.geminiApiKey,
    endpoint: config.geminiBaseUrl,
    ...(model?.trim() ? { model: model.trim() } : {})
  });
}

function defaultSemanticModel(provider: TaskSemanticProvider): string {
  return provider === 'openai' ? DEFAULT_OPENAI_EMBEDDING_MODEL : DEFAULT_GEMINI_EMBEDDING_MODEL;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function normalizeFiniteNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length) {
    return 0;
  }

  let dotProduct = 0;
  let normLeft = 0;
  let normRight = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dotProduct += leftValue * rightValue;
    normLeft += leftValue * leftValue;
    normRight += rightValue * rightValue;
  }

  const magnitude = Math.sqrt(normLeft) * Math.sqrt(normRight);
  if (magnitude === 0) {
    return 0;
  }
  return dotProduct / magnitude;
}
