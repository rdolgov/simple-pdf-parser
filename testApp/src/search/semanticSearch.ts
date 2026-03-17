import {
  EmbeddingAPI,
  type EmbeddingApiConfig,
  type EmbeddingProvider,
  type LMStudioConfig,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  DEFAULT_OPENAI_EMBEDDING_MODEL
} from 'pdf-layout-parser';
import {
  getSemanticSearchApiKey,
  getSemanticSearchModel,
  getSemanticSearchProvider,
  type SemanticSearchProvider
} from '../utils/semanticSearchSettings';
import { applyTransportToEmbeddingConfig } from '../utils/llmClients';

// ============================================================================
// Types
// ============================================================================

export interface TextChunk {
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

export interface EmbeddedChunk extends TextChunk {
  embedding: number[];
}

export interface DocumentEmbeddings {
  documentId: string;
  documentHash: string;
  provider?: EmbeddingProvider;
  model: string;
  schemaVersion?: number;
  createdAt: number;
  chunks: EmbeddedChunk[];
}

export interface SemanticSearchResult {
  chunk: EmbeddedChunk;
  score: number;
}

export interface IndexingProgress {
  status: 'idle' | 'chunking' | 'embedding' | 'storing' | 'ready' | 'error';
  totalChunks: number;
  processedChunks: number;
  message?: string;
}

export interface SemanticSearchConfig {
  lmStudio?: LMStudioConfig;
  embedding?: {
    provider?: EmbeddingProvider;
    apiKey?: string;
    model?: string;
    endpoint?: string;
    apiVersion?: string;
  };
  batchSize?: number;
  minChunkLength?: number;
  maxChunkLength?: number;
}

interface ResolvedSemanticEmbeddingConfig {
  provider: EmbeddingProvider;
  apiKey?: string;
  model: string;
  endpoint?: string;
  apiVersion?: string;
  lmStudio?: LMStudioConfig;
}

const SEMANTIC_EMBEDDINGS_SCHEMA_VERSION = 2;

// ============================================================================
// IndexedDB Storage
// ============================================================================

const DB_NAME = 'semantic-search-db';
const DB_VERSION = 1;
const STORE_NAME = 'document-embeddings';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'documentId' });
        store.createIndex('documentHash', 'documentHash', { unique: false });
      }
    };
  });

  return dbPromise;
}

export async function storeDocumentEmbeddings(embeddings: DocumentEmbeddings): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(embeddings);

    request.onerror = () => {
      reject(new Error(`Failed to store embeddings: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve();
    };
  });
}

export async function loadDocumentEmbeddings(documentId: string): Promise<DocumentEmbeddings | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(documentId);

    request.onerror = () => {
      reject(new Error(`Failed to load embeddings: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve(request.result ?? null);
    };
  });
}

export async function loadEmbeddingsByHash(documentHash: string): Promise<DocumentEmbeddings | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('documentHash');
    const request = index.get(documentHash);

    request.onerror = () => {
      reject(new Error(`Failed to load embeddings by hash: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve(request.result ?? null);
    };
  });
}

export async function deleteDocumentEmbeddings(documentId: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(documentId);

    request.onerror = () => {
      reject(new Error(`Failed to delete embeddings: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve();
    };
  });
}

export async function listStoredDocuments(): Promise<Array<{ documentId: string; documentHash: string; createdAt: number; chunkCount: number }>> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onerror = () => {
      reject(new Error(`Failed to list documents: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      const results = (request.result as DocumentEmbeddings[]).map((doc) => ({
        documentId: doc.documentId,
        documentHash: doc.documentHash,
        createdAt: doc.createdAt,
        chunkCount: doc.chunks.length
      }));
      resolve(results);
    };
  });
}

// ============================================================================
// Text Chunking
// ============================================================================

interface PageTextItem {
  text: string;
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

interface PageData {
  number: number;
  textItems: PageTextItem[];
}

// HTML layout block types for semantic chunking
interface HtmlBlock {
  type: 'paragraph' | 'heading' | 'table' | 'image' | 'list';
  text?: string;
  bounds?: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  lines?: Array<{
    text?: string;
    items?: Array<{ text?: string }>;
  }>;
  rows?: Array<{
    cells?: Array<{ text?: string }>;
  }>;
}

interface HtmlPageLayout {
  number: number;
  content: HtmlBlock[];
}

interface HtmlDocumentLayout {
  pages: HtmlPageLayout[];
}

/**
 * Extract text from an HTML block
 */
function extractBlockText(block: HtmlBlock): string {
  if (block.text) {
    return block.text;
  }

  if (block.lines && block.lines.length > 0) {
    return block.lines
      .map((line) => {
        if (line.text) return line.text;
        if (line.items) return line.items.map((item) => item.text ?? '').join('');
        return '';
      })
      .join(' ')
      .trim();
  }

  if (block.type === 'table' && block.rows) {
    return block.rows
      .map((row) =>
        (row.cells ?? []).map((cell) => cell.text ?? '').join(' | ')
      )
      .join(' ')
      .trim();
  }

  return '';
}

/**
 * Chunk a document using HTML layout blocks (paragraphs, headings, tables)
 */
export function chunkDocumentByBlocks(
  htmlLayout: HtmlDocumentLayout,
  config?: { minLength?: number; maxLength?: number }
): TextChunk[] {
  const minLength = config?.minLength ?? 20;
  const maxLength = config?.maxLength ?? 2000;
  const chunks: TextChunk[] = [];
  let globalBlockIndex = 0;

  for (const page of htmlLayout.pages) {
    for (const block of page.content) {
      // Skip images - no text content
      if (block.type === 'image') {
        continue;
      }

      const text = extractBlockText(block);
      if (text.length < minLength) {
        continue;
      }

      // Use block bounds if available, otherwise create default bounds
      const bounds = block.bounds ?? {
        minX: 0,
        minY: 0,
        maxX: 100,
        maxY: 100
      };

      // Truncate very long blocks
      const chunkText = text.length > maxLength ? text.substring(0, maxLength) : text;

      chunks.push({
        id: `p${page.number}-b${globalBlockIndex}`,
        text: chunkText,
        pageNumber: page.number,
        bounds: {
          minX: bounds.minX,
          minY: bounds.minY,
          maxX: bounds.maxX,
          maxY: bounds.maxY
        },
        sentenceIndex: globalBlockIndex
      });

      globalBlockIndex++;
    }
  }

  return chunks;
}

/**
 * Legacy: Chunk a document into sentences with position information
 * @deprecated Use chunkDocumentByBlocks for better semantic chunking
 */
export function chunkDocument(
  pages: PageData[],
  config?: { minLength?: number; maxLength?: number }
): TextChunk[] {
  const minLength = config?.minLength ?? 10;
  const maxLength = config?.maxLength ?? 1000;
  const chunks: TextChunk[] = [];
  let globalIndex = 0;

  for (const page of pages) {
    // Group text items into paragraphs based on vertical gaps
    const paragraphs = groupTextItemsIntoParagraphs(page.textItems);

    for (const para of paragraphs) {
      if (para.text.length < minLength) {
        continue;
      }

      const chunkText = para.text.length > maxLength
        ? para.text.substring(0, maxLength)
        : para.text;

      chunks.push({
        id: `p${page.number}-b${globalIndex}`,
        text: chunkText,
        pageNumber: page.number,
        bounds: para.bounds,
        sentenceIndex: globalIndex
      });

      globalIndex++;
    }
  }

  return chunks;
}

interface ParagraphData {
  text: string;
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

/**
 * Group text items into paragraphs based on vertical spacing
 */
function groupTextItemsIntoParagraphs(items: PageTextItem[], lineGapThreshold = 5): ParagraphData[] {
  if (items.length === 0) {
    return [];
  }

  // Sort by Y (descending for top-to-bottom), then X
  const sorted = [...items].sort((a, b) => {
    const yDiff = b.bounds.maxY - a.bounds.maxY;
    if (Math.abs(yDiff) > 2) {
      return yDiff;
    }
    return a.bounds.minX - b.bounds.minX;
  });

  const paragraphs: ParagraphData[] = [];
  let currentPara: ParagraphData | null = null;
  let lastY = Infinity;

  for (const item of sorted) {
    const itemY = item.bounds.maxY;
    const gap = lastY - item.bounds.maxY;
    const avgLineHeight = item.bounds.maxY - item.bounds.minY;
    const isNewParagraph = gap > avgLineHeight * 1.5 || gap > lineGapThreshold * 3;

    if (!currentPara || isNewParagraph) {
      if (currentPara) {
        paragraphs.push(currentPara);
      }
      currentPara = {
        text: item.text,
        bounds: { ...item.bounds }
      };
    } else {
      // Same paragraph - append text
      currentPara.text += ' ' + item.text;
      currentPara.bounds.minX = Math.min(currentPara.bounds.minX, item.bounds.minX);
      currentPara.bounds.maxX = Math.max(currentPara.bounds.maxX, item.bounds.maxX);
      currentPara.bounds.minY = Math.min(currentPara.bounds.minY, item.bounds.minY);
      currentPara.bounds.maxY = Math.max(currentPara.bounds.maxY, item.bounds.maxY);
    }

    lastY = item.bounds.minY;
  }

  if (currentPara) {
    paragraphs.push(currentPara);
  }

  return paragraphs;
}

function resolveSemanticEmbeddingConfig(config?: SemanticSearchConfig): ResolvedSemanticEmbeddingConfig {
  const provider = config?.embedding?.provider ?? getSemanticSearchProvider();

  if (provider === 'lmstudio') {
    const lmStudioConfig = config?.lmStudio;
    return {
      provider,
      model: config?.embedding?.model?.trim() || lmStudioConfig?.defaultModel?.trim() || 'text-embedding-nomic-embed-text-v2-moe',
      endpoint: config?.embedding?.endpoint,
      lmStudio: lmStudioConfig
    };
  }

  const remoteProvider = provider as SemanticSearchProvider;
  const apiKey = config?.embedding?.apiKey?.trim() || getSemanticSearchApiKey(remoteProvider) || undefined;
  const storedModel = getSemanticSearchModel(remoteProvider) || undefined;
  const configuredModel = config?.embedding?.model?.trim() || storedModel;
  const defaultModel = remoteProvider === 'openai' ? DEFAULT_OPENAI_EMBEDDING_MODEL : DEFAULT_GEMINI_EMBEDDING_MODEL;

  return {
    provider,
    apiKey,
    model: configuredModel && configuredModel.length > 0 ? configuredModel : defaultModel,
    endpoint: config?.embedding?.endpoint,
    apiVersion: config?.embedding?.apiVersion,
    lmStudio: config?.lmStudio
  };
}

function toEmbeddingApiConfig(config?: SemanticSearchConfig): EmbeddingApiConfig {
  const resolved = resolveSemanticEmbeddingConfig(config);
  return applyTransportToEmbeddingConfig({
    provider: resolved.provider,
    apiKey: resolved.apiKey,
    model: resolved.model,
    endpoint: resolved.endpoint,
    apiVersion: resolved.apiVersion,
    lmStudio: resolved.lmStudio
  });
}

export function isEmbeddingsCompatibleWithConfig(
  embeddings: DocumentEmbeddings,
  config?: SemanticSearchConfig
): boolean {
  const resolved = resolveSemanticEmbeddingConfig(config);
  const provider = embeddings.provider ?? 'lmstudio';
  const model = embeddings.model?.trim() || '';

  return provider === resolved.provider && model === resolved.model;
}

// ============================================================================
// Embedding Generation
// ============================================================================

/**
 * Generate embeddings for text chunks using the configured provider
 */
export async function generateChunkEmbeddings(
  chunks: TextChunk[],
  config?: SemanticSearchConfig,
  onProgress?: (processed: number, total: number) => void
): Promise<EmbeddedChunk[]> {
  const batchSize = config?.batchSize ?? 10;
  const api = new EmbeddingAPI(toEmbeddingApiConfig(config));
  const embeddedChunks: EmbeddedChunk[] = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map((c) => c.text);

    try {
      const result = await api.generateEmbedding({
        input: texts,
        taskType: 'retrieval_document'
      });

      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const embedding = result.embeddings[j];
        if (embedding) {
          embeddedChunks.push({
            ...chunk,
            embedding
          });
        }
      }
    } catch (error) {
      console.error(`Failed to generate embeddings for batch ${i / batchSize}:`, error);
      // Continue with other batches
    }

    onProgress?.(Math.min(i + batchSize, chunks.length), chunks.length);
  }

  return embeddedChunks;
}

// ============================================================================
// Semantic Search
// ============================================================================

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) {
    return 0;
  }

  return dotProduct / magnitude;
}

/**
 * Search for semantically similar chunks
 */
export async function semanticSearch(
  query: string,
  embeddings: DocumentEmbeddings,
  config?: SemanticSearchConfig & { topK?: number; minScore?: number }
): Promise<SemanticSearchResult[]> {
  const topK = config?.topK ?? 10;
  const minScore = config?.minScore ?? 0.3;
  if (!isEmbeddingsCompatibleWithConfig(embeddings, config)) {
    const cachedProvider = embeddings.provider ?? 'lmstudio';
    throw new Error(
      `Semantic index was built with ${cachedProvider}/${embeddings.model}. Re-index to use ${resolveSemanticEmbeddingConfig(config).provider}/${resolveSemanticEmbeddingConfig(config).model}.`
    );
  }

  const api = new EmbeddingAPI(toEmbeddingApiConfig(config));

  // Generate embedding for query
  const queryResult = await api.generateEmbedding({
    input: query,
    taskType: 'retrieval_query'
  });
  const queryEmbedding = queryResult.embeddings[0];

  if (!queryEmbedding) {
    throw new Error('Failed to generate query embedding');
  }

  // Score all chunks
  const scored: SemanticSearchResult[] = embeddings.chunks
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding)
    }))
    .filter((result) => result.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

// ============================================================================
// Main Indexing Function
// ============================================================================

export interface IndexDocumentOptions {
  documentId: string;
  documentHash: string;
  pages?: PageData[];
  htmlLayout?: HtmlDocumentLayout;
  config?: SemanticSearchConfig;
  onProgress?: (progress: IndexingProgress) => void;
}

/**
 * Index a document for semantic search
 * Checks for cached embeddings first, generates new ones if needed
 * Prefers htmlLayout for block-level chunking, falls back to pages for paragraph grouping
 */
export async function indexDocument(options: IndexDocumentOptions): Promise<DocumentEmbeddings> {
  const { documentId, documentHash, pages, htmlLayout, config, onProgress } = options;

  // Check for existing embeddings
  onProgress?.({
    status: 'idle',
    totalChunks: 0,
    processedChunks: 0,
    message: 'Checking for cached embeddings...'
  });

  const existing = await loadEmbeddingsByHash(documentHash);
  if (existing && isEmbeddingsCompatibleWithConfig(existing, config)) {
    onProgress?.({
      status: 'ready',
      totalChunks: existing.chunks.length,
      processedChunks: existing.chunks.length,
      message: 'Loaded cached embeddings'
    });
    return existing;
  }
  if (existing) {
    onProgress?.({
      status: 'idle',
      totalChunks: 0,
      processedChunks: 0,
      message: 'Cached embeddings found, but provider/model changed. Re-indexing...'
    });
  }

  // Chunk document - prefer HTML layout for semantic blocks
  onProgress?.({
    status: 'chunking',
    totalChunks: 0,
    processedChunks: 0,
    message: 'Chunking document into blocks...'
  });

  let chunks: TextChunk[];
  if (htmlLayout) {
    chunks = chunkDocumentByBlocks(htmlLayout, {
      minLength: config?.minChunkLength ?? 20,
      maxLength: config?.maxChunkLength ?? 2000
    });
  } else if (pages) {
    chunks = chunkDocument(pages, {
      minLength: config?.minChunkLength,
      maxLength: config?.maxChunkLength
    });
  } else {
    throw new Error('Either pages or htmlLayout must be provided');
  }

  if (chunks.length === 0) {
    throw new Error('No text chunks found in document');
  }

  const resolvedEmbeddingConfig = resolveSemanticEmbeddingConfig(config);

  // Generate embeddings
  onProgress?.({
    status: 'embedding',
    totalChunks: chunks.length,
    processedChunks: 0,
    message: `Generating ${resolvedEmbeddingConfig.provider} embeddings...`
  });

  const embeddedChunks = await generateChunkEmbeddings(
    chunks,
    config,
    (processed, total) => {
      onProgress?.({
        status: 'embedding',
        totalChunks: total,
        processedChunks: processed,
        message: `Generating embeddings (${processed}/${total})...`
      });
    }
  );

  if (embeddedChunks.length === 0) {
    throw new Error('Failed to generate any embeddings');
  }

  // Store embeddings
  onProgress?.({
    status: 'storing',
    totalChunks: embeddedChunks.length,
    processedChunks: embeddedChunks.length,
    message: 'Storing embeddings...'
  });

  const documentEmbeddings: DocumentEmbeddings = {
    documentId,
    documentHash,
    provider: resolvedEmbeddingConfig.provider,
    model: resolvedEmbeddingConfig.model,
    schemaVersion: SEMANTIC_EMBEDDINGS_SCHEMA_VERSION,
    createdAt: Date.now(),
    chunks: embeddedChunks
  };

  await storeDocumentEmbeddings(documentEmbeddings);

  onProgress?.({
    status: 'ready',
    totalChunks: embeddedChunks.length,
    processedChunks: embeddedChunks.length,
    message: `Indexed ${embeddedChunks.length} chunks`
  });

  return documentEmbeddings;
}
