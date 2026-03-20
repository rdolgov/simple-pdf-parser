import { useState } from 'react';
import type { KeyboardEvent } from 'react';

import type { KeywordSearchResult } from '../search';

interface KeywordSearchBarProps {
  onSearch: (query: string) => Promise<KeywordSearchResult[]>;
  onClearSearch: () => void;
  searchResults: KeywordSearchResult[];
  isSearching: boolean;
  disabled?: boolean;
  activeResultIndex: number;
  onNavigateResult: (index: number) => void;
}

export function KeywordSearchBar({
  onSearch,
  onClearSearch,
  searchResults,
  isSearching,
  disabled = false,
  activeResultIndex,
  onNavigateResult
}: KeywordSearchBarProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [lastSearchedQuery, setLastSearchedQuery] = useState('');
  const hasResults = searchResults.length > 0;
  const queryChanged = query.trim() !== lastSearchedQuery;
  const resultLabel = hasResults ? `${activeResultIndex + 1} / ${searchResults.length}` : 'No matches';

  async function handleSubmit(): Promise<void> {
    const trimmed = query.trim();
    if (!trimmed || isSearching || disabled) {
      return;
    }

    if (!queryChanged && hasResults) {
      const nextIndex = (activeResultIndex + 1) % searchResults.length;
      onNavigateResult(nextIndex);
      return;
    }

    const results = await onSearch(trimmed);
    setLastSearchedQuery(trimmed);
    if (results.length > 0) {
      onNavigateResult(0);
    }
  }

  function handleClear(): void {
    setQuery('');
    setLastSearchedQuery('');
    onClearSearch();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      void handleSubmit();
      return;
    }
    if (event.key === 'Escape') {
      handleClear();
    }
  }

  return (
    <div className="keyword-search-bar">
      <div className="keyword-search-bar__inner">
        <div className="keyword-search-bar__label">Keyword Search</div>
        <input
          type="text"
          className="keyword-search-bar__input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Find words on the page"
          disabled={disabled}
        />
        <button
          type="button"
          className="keyword-search-bar__button"
          onClick={() => void handleSubmit()}
          disabled={disabled || isSearching || !query.trim()}
        >
          {isSearching ? 'Searching…' : hasResults && !queryChanged ? 'Next' : 'Search'}
        </button>
        <button
          type="button"
          className="keyword-search-bar__button keyword-search-bar__button--ghost"
          onClick={handleClear}
          disabled={disabled || (!query && searchResults.length === 0)}
        >
          Clear
        </button>
        <div className="keyword-search-bar__status" aria-live="polite">
          {resultLabel}
        </div>
      </div>
    </div>
  );
}
