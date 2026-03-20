import { useCallback, useEffect, useState, useTransition } from 'react';
import type { PDFDocument } from 'pdf-layout-parser';

import {
  keywordSearchDocument,
  type KeywordSearchOptions,
  type KeywordSearchResult
} from './keywordSearch';

export interface UseKeywordSearchReturn {
  searchResults: KeywordSearchResult[];
  isSearching: boolean;
  searchError: string | null;
  search: (query: string) => Promise<KeywordSearchResult[]>;
  clearResults: () => void;
}

export function useKeywordSearch(
  document: PDFDocument | null,
  options?: KeywordSearchOptions
): UseKeywordSearchReturn {
  const [searchResults, setSearchResults] = useState<KeywordSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearching, startSearchTransition] = useTransition();

  useEffect(() => {
    setSearchResults([]);
    setSearchError(null);
  }, [document]);

  const search = useCallback(async (query: string): Promise<KeywordSearchResult[]> => {
    if (!document) {
      setSearchError('Document not loaded');
      return [];
    }

    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchError(null);
      return [];
    }

    try {
      const results = keywordSearchDocument(document, trimmed, options);
      startSearchTransition(() => {
        setSearchResults(results);
        setSearchError(null);
      });
      return results;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Keyword search failed';
      setSearchError(message);
      return [];
    }
  }, [document, options]);

  const clearResults = useCallback(() => {
    startSearchTransition(() => {
      setSearchResults([]);
      setSearchError(null);
    });
  }, []);

  return {
    searchResults,
    isSearching,
    searchError,
    search,
    clearResults
  };
}
