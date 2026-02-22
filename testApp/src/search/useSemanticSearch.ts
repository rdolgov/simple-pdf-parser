import { useState, useCallback, useRef, useEffect } from 'react';
import {
  indexDocument,
  semanticSearch,
  loadEmbeddingsByHash,
  type DocumentEmbeddings,
  type IndexingProgress,
  type SemanticSearchResult,
  type SemanticSearchConfig
} from './semanticSearch';

export interface UseSemanticSearchOptions {
  config?: SemanticSearchConfig;
  autoIndex?: boolean;
}

export interface UseSemanticSearchReturn {
  // Indexing
  indexingProgress: IndexingProgress;
  isIndexing: boolean;
  isIndexed: boolean;
  embeddings: DocumentEmbeddings | null;
  indexError: string | null;
  startIndexing: () => Promise<void>;

  // Search
  searchResults: SemanticSearchResult[];
  isSearching: boolean;
  searchError: string | null;
  search: (query: string) => Promise<SemanticSearchResult[]>;
  clearResults: () => void;
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

interface DocumentData {
  documentId: string;
  documentHash: string;
  pages?: Array<{
    number: number;
    textItems: Array<{
      text: string;
      bounds: {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
      };
    }>;
  }>;
  htmlLayout?: HtmlDocumentLayout;
}

export function useSemanticSearch(
  document: DocumentData | null,
  options?: UseSemanticSearchOptions
): UseSemanticSearchReturn {
  const [indexingProgress, setIndexingProgress] = useState<IndexingProgress>({
    status: 'idle',
    totalChunks: 0,
    processedChunks: 0
  });
  const [embeddings, setEmbeddings] = useState<DocumentEmbeddings | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);

  const [searchResults, setSearchResults] = useState<SemanticSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const indexingRef = useRef(false);
  const currentDocHashRef = useRef<string | null>(null);

  // Check for cached embeddings when document changes
  useEffect(() => {
    if (!document) {
      setEmbeddings(null);
      setIndexingProgress({ status: 'idle', totalChunks: 0, processedChunks: 0 });
      setIndexError(null);
      setSearchResults([]);
      currentDocHashRef.current = null;
      return;
    }

    if (currentDocHashRef.current === document.documentHash) {
      return;
    }

    currentDocHashRef.current = document.documentHash;

    // Check for cached embeddings
    loadEmbeddingsByHash(document.documentHash)
      .then((cached) => {
        if (cached && currentDocHashRef.current === document.documentHash) {
          setEmbeddings(cached);
          setIndexingProgress({
            status: 'ready',
            totalChunks: cached.chunks.length,
            processedChunks: cached.chunks.length,
            message: 'Loaded cached embeddings'
          });
        } else if (options?.autoIndex) {
          // Auto-index if enabled and no cache found
          void startIndexingInternal();
        }
      })
      .catch((error) => {
        console.warn('Failed to check cached embeddings:', error);
      });
  }, [document?.documentHash]);

  const startIndexingInternal = useCallback(async () => {
    if (!document || indexingRef.current) {
      return;
    }

    indexingRef.current = true;
    setIndexError(null);
    setEmbeddings(null);

    try {
      const result = await indexDocument({
        documentId: document.documentId,
        documentHash: document.documentHash,
        pages: document.pages,
        htmlLayout: document.htmlLayout,
        config: options?.config,
        onProgress: setIndexingProgress
      });

      if (currentDocHashRef.current === document.documentHash) {
        setEmbeddings(result);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to index document';
      setIndexError(message);
      setIndexingProgress((prev) => ({
        ...prev,
        status: 'error',
        message
      }));
    } finally {
      indexingRef.current = false;
    }
  }, [document, options?.config]);

  const startIndexing = useCallback(async () => {
    await startIndexingInternal();
  }, [startIndexingInternal]);

  const search = useCallback(async (query: string): Promise<SemanticSearchResult[]> => {
    if (!embeddings) {
      setSearchError('Document not indexed yet');
      return [];
    }

    if (!query.trim()) {
      setSearchResults([]);
      return [];
    }

    setIsSearching(true);
    setSearchError(null);

    try {
      const results = await semanticSearch(query, embeddings, options?.config);
      setSearchResults(results);
      return results;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Search failed';
      setSearchError(message);
      return [];
    } finally {
      setIsSearching(false);
    }
  }, [embeddings, options?.config]);

  const clearResults = useCallback(() => {
    setSearchResults([]);
    setSearchError(null);
  }, []);

  return {
    // Indexing
    indexingProgress,
    isIndexing: indexingProgress.status === 'chunking' ||
                indexingProgress.status === 'embedding' ||
                indexingProgress.status === 'storing',
    isIndexed: indexingProgress.status === 'ready' && embeddings !== null,
    embeddings,
    indexError,
    startIndexing,

    // Search
    searchResults,
    isSearching,
    searchError,
    search,
    clearResults
  };
}
