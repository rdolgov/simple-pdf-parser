import {
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  type EmbeddingProvider
} from 'pdf-layout-parser';
import {
  buildSemanticIndexTask,
  searchSemanticTask,
  type ProxyTaskSemanticChunk
} from '../api/proxyTaskApi';
import {
  getSemanticSearchModel,
  getSemanticSearchProvider,
  type SemanticSearchProvider
} from '../utils/semanticSearchSettings';

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
  chunkCount: number;
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
  embedding?: {
    provider?: EmbeddingProvider;
    model?: string;
  };
  batchSize?: number;
  minChunkLength?: number;
  maxChunkLength?: number;
  topK?: number;
  minScore?: number;
}

interface ResolvedSemanticEmbeddingConfig {
  provider: SemanticSearchProvider;
  model: string;
}

const SEMANTIC_EMBEDDINGS_SCHEMA_VERSION = 3;

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
      .map((row) => (row.cells ?? []).map((cell) => cell.text ?? '').join(' | '))
      .join(' ')
      .trim();
  }

  return '';
}

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
      if (block.type === 'image') {
        continue;
      }

      const text = extractBlockText(block);
      if (text.length < minLength) {
        continue;
      }

      const bounds = block.bounds ?? {
        minX: 0,
        minY: 0,
        maxX: 100,
        maxY: 100
      };
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
      globalBlockIndex += 1;
    }
  }

  return chunks;
}

export function chunkDocument(
  pages: PageData[],
  config?: { minLength?: number; maxLength?: number }
): TextChunk[] {
  const minLength = config?.minLength ?? 10;
  const maxLength = config?.maxLength ?? 1000;
  const chunks: TextChunk[] = [];
  let globalIndex = 0;

  for (const page of pages) {
    const paragraphs = groupTextItemsIntoParagraphs(page.textItems);
    for (const paragraph of paragraphs) {
      if (paragraph.text.length < minLength) {
        continue;
      }

      const chunkText = paragraph.text.length > maxLength
        ? paragraph.text.substring(0, maxLength)
        : paragraph.text;

      chunks.push({
        id: `p${page.number}-b${globalIndex}`,
        text: chunkText,
        pageNumber: page.number,
        bounds: paragraph.bounds,
        sentenceIndex: globalIndex
      });
      globalIndex += 1;
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

function groupTextItemsIntoParagraphs(items: PageTextItem[], lineGapThreshold = 5): ParagraphData[] {
  if (items.length === 0) {
    return [];
  }

  const sorted = [...items].sort((left, right) => {
    const yDiff = right.bounds.maxY - left.bounds.maxY;
    if (Math.abs(yDiff) > 2) {
      return yDiff;
    }
    return left.bounds.minX - right.bounds.minX;
  });

  const paragraphs: ParagraphData[] = [];
  let currentParagraph: ParagraphData | null = null;
  let lastY = Infinity;

  for (const item of sorted) {
    const gap = lastY - item.bounds.maxY;
    const averageLineHeight = item.bounds.maxY - item.bounds.minY;
    const isNewParagraph = gap > averageLineHeight * 1.5 || gap > lineGapThreshold * 3;

    if (!currentParagraph || isNewParagraph) {
      if (currentParagraph) {
        paragraphs.push(currentParagraph);
      }
      currentParagraph = {
        text: item.text,
        bounds: { ...item.bounds }
      };
    } else {
      currentParagraph.text += ` ${item.text}`;
      currentParagraph.bounds.minX = Math.min(currentParagraph.bounds.minX, item.bounds.minX);
      currentParagraph.bounds.maxX = Math.max(currentParagraph.bounds.maxX, item.bounds.maxX);
      currentParagraph.bounds.minY = Math.min(currentParagraph.bounds.minY, item.bounds.minY);
      currentParagraph.bounds.maxY = Math.max(currentParagraph.bounds.maxY, item.bounds.maxY);
    }

    lastY = item.bounds.minY;
  }

  if (currentParagraph) {
    paragraphs.push(currentParagraph);
  }

  return paragraphs;
}

function resolveSemanticEmbeddingConfig(config?: SemanticSearchConfig): ResolvedSemanticEmbeddingConfig {
  const provider = normalizeSemanticProvider(config?.embedding?.provider) ?? getSemanticSearchProvider();
  const configuredModel = config?.embedding?.model?.trim() || getSemanticSearchModel(provider) || undefined;
  const defaultModel = provider === 'openai' ? DEFAULT_OPENAI_EMBEDDING_MODEL : DEFAULT_GEMINI_EMBEDDING_MODEL;
  return {
    provider,
    model: configuredModel && configuredModel.length > 0 ? configuredModel : defaultModel
  };
}

export function isSemanticIndexCompatibleWithConfig(
  index: DocumentEmbeddings,
  config?: SemanticSearchConfig
): boolean {
  const resolved = resolveSemanticEmbeddingConfig(config);
  const provider = (index.provider ?? 'gemini') as SemanticSearchProvider;
  const model = index.model?.trim() || '';
  return provider === resolved.provider && model === resolved.model;
}

export interface IndexDocumentOptions {
  documentId: string;
  documentHash: string;
  pages?: PageData[];
  htmlLayout?: HtmlDocumentLayout;
  config?: SemanticSearchConfig;
  onProgress?: (progress: IndexingProgress) => void;
}

export async function indexDocument(options: IndexDocumentOptions): Promise<DocumentEmbeddings> {
  const { documentId, documentHash, pages, htmlLayout, config, onProgress } = options;
  onProgress?.({
    status: 'chunking',
    totalChunks: 0,
    processedChunks: 0,
    message: 'Chunking document into semantic blocks...'
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
    throw new Error('Either pages or htmlLayout must be provided.');
  }

  if (chunks.length === 0) {
    throw new Error('No semantic search text chunks were found in the document.');
  }

  const resolved = resolveSemanticEmbeddingConfig(config);
  onProgress?.({
    status: 'embedding',
    totalChunks: chunks.length,
    processedChunks: 0,
    message: `Building semantic index with ${resolved.provider}...`
  });

  const response = await buildSemanticIndexTask({
    documentId,
    documentHash,
    chunks: chunks as ProxyTaskSemanticChunk[],
    provider: resolved.provider,
    model: resolved.model
  });

  onProgress?.({
    status: 'ready',
    totalChunks: response.chunkCount,
    processedChunks: response.chunkCount,
    message: `Indexed ${response.chunkCount} chunks`
  });

  return {
    documentId: response.documentId,
    documentHash: response.documentHash,
    provider: response.provider,
    model: response.model,
    schemaVersion: SEMANTIC_EMBEDDINGS_SCHEMA_VERSION,
    createdAt: Date.parse(response.createdAt) || Date.now(),
    chunkCount: response.chunkCount
  };
}

export async function semanticSearch(
  query: string,
  index: DocumentEmbeddings,
  config?: SemanticSearchConfig
): Promise<SemanticSearchResult[]> {
  if (!isSemanticIndexCompatibleWithConfig(index, config)) {
    const current = resolveSemanticEmbeddingConfig(config);
    const existingProvider = (index.provider ?? 'gemini') as SemanticSearchProvider;
    throw new Error(
      `Semantic index was built with ${existingProvider}/${index.model}. Re-index to use ${current.provider}/${current.model}.`
    );
  }

  const resolved = resolveSemanticEmbeddingConfig(config);
  const response = await searchSemanticTask({
    documentId: index.documentId,
    query,
    provider: resolved.provider,
    model: resolved.model,
    ...(typeof config?.topK === 'number' ? { topK: config.topK } : {}),
    ...(typeof config?.minScore === 'number' ? { minScore: config.minScore } : {})
  });
  return response.results as SemanticSearchResult[];
}

function normalizeSemanticProvider(value: EmbeddingProvider | undefined): SemanticSearchProvider | null {
  if (value === 'gemini' || value === 'openai') {
    return value;
  }
  return null;
}
