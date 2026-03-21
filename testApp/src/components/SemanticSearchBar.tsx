import { useState, useCallback, useRef, useEffect } from 'react';
import type { KeyboardEvent, FocusEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { IndexingProgress, KeywordSearchResult, SemanticSearchResult } from '../search';
import type { ExtractState, GeminiExtractionState } from '../hooks';
import type { AiDetectionSupport } from '../utils/aiDetectionSupport';
import { getAiExtractionStatusView } from '../utils/aiExtractionStatus';
import type { TopTaskStatusView } from '../utils/topTaskStatus';
import {
  type SearchHistoryEntry,
  addSearchToHistory,
  getSearchHistory,
  deleteSearchFromHistory
} from '../storage/searchHistoryStorage';
import { TopTaskStatusStrip } from './TopTaskStatusStrip';

interface SemanticSearchBarProps {
  isIndexed: boolean;
  isIndexing: boolean;
  indexingProgress: IndexingProgress;
  zoomIndicator: string;
  canUseZoom: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  isLassoMode: boolean;
  onToggleLasso: () => void;
  onStartIndexing: () => void;
  onSearch: (query: string) => Promise<SemanticSearchResult[]>;
  onClearSearch: () => void;
  searchResults: SemanticSearchResult[];
  isSearching: boolean;
  onKeywordSearch: (query: string) => Promise<KeywordSearchResult[]>;
  onClearKeywordSearch: () => void;
  keywordSearchResults: KeywordSearchResult[];
  isKeywordSearching: boolean;
  disabled?: boolean;
  activeResultIndex: number;
  onNavigateResult: (index: number) => void;
  activeKeywordResultIndex: number;
  onNavigateKeywordResult: (index: number) => void;
  documentId?: string;
  extractState: ExtractState;
  geminiExtractionState: GeminiExtractionState;
  aiDetectionSupport: AiDetectionSupport;
  aiDetectionModeDescription: string;
  onRunAiDetection: () => Promise<void>;
  topTaskStatus?: TopTaskStatusView | null;
}

export function SemanticSearchBar({
  isIndexed,
  isIndexing,
  indexingProgress,
  zoomIndicator,
  canUseZoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  isLassoMode,
  onToggleLasso,
  onStartIndexing,
  onSearch,
  onClearSearch,
  searchResults,
  isSearching,
  onKeywordSearch,
  onClearKeywordSearch,
  keywordSearchResults,
  isKeywordSearching,
  disabled = false,
  activeResultIndex,
  onNavigateResult,
  activeKeywordResultIndex,
  onNavigateKeywordResult,
  documentId,
  extractState,
  geminiExtractionState,
  aiDetectionSupport,
  aiDetectionModeDescription,
  onRunAiDetection,
  topTaskStatus = null
}: SemanticSearchBarProps): JSX.Element {
  const [searchMode, setSearchMode] = useState<'semantic' | 'keyword'>('semantic');
  const [semanticQuery, setSemanticQuery] = useState('');
  const [keywordQuery, setKeywordQuery] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [lastSemanticQuery, setLastSemanticQuery] = useState('');
  const [lastKeywordQuery, setLastKeywordQuery] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const isSemanticMode = searchMode === 'semantic';
  const query = isSemanticMode ? semanticQuery : keywordQuery;
  const hasResults = isSemanticMode ? searchResults.length > 0 : keywordSearchResults.length > 0;
  const lastSearchedQuery = isSemanticMode ? lastSemanticQuery : lastKeywordQuery;
  const queryChanged = query.trim() !== lastSearchedQuery;
  const isActiveSearching = isSemanticMode ? isSearching : isKeywordSearching;
  const activeResultsCount = isSemanticMode ? searchResults.length : keywordSearchResults.length;
  const currentResultIndex = isSemanticMode ? activeResultIndex : activeKeywordResultIndex;
  const isAiDetectionRunning = extractState.status === 'loading' || geminiExtractionState.status === 'loading';
  const isAiDetectionReady = extractState.status === 'ready' && geminiExtractionState.status === 'ready';
  const aiDetectionButtonLabel = !aiDetectionSupport.supported
    ? 'AI Unsupported'
    : isAiDetectionRunning
      ? 'Detecting...'
      : isAiDetectionReady
        ? 'Re-run AI'
        : 'Run AI';
  const aiDetectionButtonTitle = aiDetectionSupport.supported
    ? aiDetectionModeDescription
    : aiDetectionSupport.message ?? 'AI detection is not supported for this PDF.';
  const aiExtractionStatus = getAiExtractionStatusView({
    extractState,
    geminiExtractionState,
    aiDetectionSupport
  });

  // Load search history on mount and when expanded
  useEffect(() => {
    if (isExpanded) {
      getSearchHistory().then(setSearchHistory).catch(() => setSearchHistory([]));
    }
  }, [isExpanded]);

  // Close history dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: globalThis.MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowHistory(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const refreshHistory = useCallback(() => {
    getSearchHistory().then(setSearchHistory).catch(() => setSearchHistory([]));
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed || isActiveSearching || (isSemanticMode && !isIndexed)) {
      return;
    }

    if (!queryChanged && hasResults) {
      if (isSemanticMode) {
        const nextIndex = (activeResultIndex + 1) % searchResults.length;
        onNavigateResult(nextIndex);
      } else {
        const nextIndex = (activeKeywordResultIndex + 1) % keywordSearchResults.length;
        onNavigateKeywordResult(nextIndex);
      }
      return;
    }

    setShowHistory(false);
    if (isSemanticMode) {
      onClearKeywordSearch();
      await onSearch(trimmed);
      setLastSemanticQuery(trimmed);
      await addSearchToHistory(trimmed, documentId);
      refreshHistory();
      return;
    }

    onClearSearch();
    await onKeywordSearch(trimmed);
    setLastKeywordQuery(trimmed);
  }, [
    query,
    isActiveSearching,
    isSemanticMode,
    isIndexed,
    queryChanged,
    hasResults,
    activeResultIndex,
    searchResults.length,
    onNavigateResult,
    activeKeywordResultIndex,
    keywordSearchResults.length,
    onNavigateKeywordResult,
    onClearKeywordSearch,
    onSearch,
    documentId,
    refreshHistory,
    onClearSearch,
    onKeywordSearch
  ]);

  const handleHistoryClick = useCallback(async (entry: SearchHistoryEntry) => {
    setSemanticQuery(entry.query);
    setShowHistory(false);
    setHistoryIndex(-1);

    if (isIndexed && !isSearching) {
      onClearKeywordSearch();
      await onSearch(entry.query);
      setLastSemanticQuery(entry.query);
      await addSearchToHistory(entry.query, documentId);
      refreshHistory();
    }
  }, [isIndexed, isSearching, onClearKeywordSearch, onSearch, documentId, refreshHistory]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (isSemanticMode && showHistory && searchHistory.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHistoryIndex((prev) => Math.min(prev + 1, searchHistory.length - 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHistoryIndex((prev) => Math.max(prev - 1, -1));
        return;
      }
      if (event.key === 'Enter' && historyIndex >= 0) {
        event.preventDefault();
        const selected = searchHistory[historyIndex];
        if (selected) {
          void handleHistoryClick(selected);
        }
        return;
      }
    }

    if (event.key === 'Enter') {
      void handleSubmit();
    } else if (event.key === 'Escape') {
      if (showHistory) {
        setShowHistory(false);
        setHistoryIndex(-1);
      } else {
        if (isSemanticMode) {
          setSemanticQuery('');
          setLastSemanticQuery('');
          onClearSearch();
        } else {
          setKeywordQuery('');
          setLastKeywordQuery('');
          onClearKeywordSearch();
        }
        inputRef.current?.blur();
      }
    }
  }, [
    handleSubmit,
    isSemanticMode,
    onClearSearch,
    onClearKeywordSearch,
    showHistory,
    searchHistory,
    historyIndex,
    handleHistoryClick
  ]);

  const handleClear = useCallback(() => {
    if (isSemanticMode) {
      setSemanticQuery('');
      setLastSemanticQuery('');
      onClearSearch();
    } else {
      setKeywordQuery('');
      setLastKeywordQuery('');
      onClearKeywordSearch();
    }
    inputRef.current?.focus();
  }, [isSemanticMode, onClearSearch, onClearKeywordSearch]);

  const handleToggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
    if (!isExpanded) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isExpanded]);

  const handleInputFocus = useCallback(() => {
    if (isSemanticMode && searchHistory.length > 0) {
      setShowHistory(true);
      setHistoryIndex(-1);
    }
  }, [isSemanticMode, searchHistory.length]);

  const handleInputBlur = useCallback((event: FocusEvent<HTMLInputElement>) => {
    // Don't close if clicking within the container (history dropdown)
    const relatedTarget = event.relatedTarget as Node | null;
    if (containerRef.current?.contains(relatedTarget)) {
      return;
    }
    // Delay to allow click events on history items
    setTimeout(() => setShowHistory(false), 150);
  }, []);

  const handleDeleteHistory = useCallback(async (event: ReactMouseEvent<HTMLButtonElement>, id: string) => {
    event.stopPropagation();
    await deleteSearchFromHistory(id);
    refreshHistory();
  }, [refreshHistory]);

  const handleToggleHistory = useCallback(() => {
    if (showHistory) {
      setShowHistory(false);
    } else {
      refreshHistory();
      setShowHistory(true);
      setHistoryIndex(-1);
    }
  }, [showHistory, refreshHistory]);

  useEffect(() => {
    if (searchResults.length > 0 || keywordSearchResults.length > 0) {
      setIsExpanded(true);
    }
  }, [searchResults.length, keywordSearchResults.length]);

  const handleModeChange = useCallback((mode: 'semantic' | 'keyword') => {
    if (mode === searchMode) {
      return;
    }
    setSearchMode(mode);
    setShowHistory(false);
    setHistoryIndex(-1);
    if (mode === 'semantic') {
      onClearKeywordSearch();
    } else {
      onClearSearch();
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [searchMode, onClearKeywordSearch, onClearSearch]);

  const progressPercent = indexingProgress.totalChunks > 0
    ? Math.round((indexingProgress.processedChunks / indexingProgress.totalChunks) * 100)
    : 0;

  const formatTimestamp = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  return (
    <div
      ref={containerRef}
      className={`semantic-search-bar ${isExpanded ? 'semantic-search-bar--expanded' : ''}`}
    >
      <div className="semantic-search-bar-inner">
        {/* Search Icon / Toggle */}
        <button
          type="button"
          className="semantic-search-toggle"
          onClick={handleToggleExpand}
          aria-label={isExpanded ? 'Collapse search' : 'Expand search'}
          title="Search"
        >
          <SearchIcon />
        </button>

        <div className={`semantic-search-input-wrapper ${isExpanded ? 'semantic-search-input-wrapper--visible' : ''}`}>
          <div className="semantic-search-mode-toggle" role="tablist" aria-label="Search mode">
            <button
              type="button"
              className={`semantic-search-mode-btn${isSemanticMode ? ' semantic-search-mode-btn--active' : ''}`}
              onClick={() => handleModeChange('semantic')}
              role="tab"
              aria-selected={isSemanticMode}
            >
              Semantic
            </button>
            <button
              type="button"
              className={`semantic-search-mode-btn${!isSemanticMode ? ' semantic-search-mode-btn--active' : ''}`}
              onClick={() => handleModeChange('keyword')}
              role="tab"
              aria-selected={!isSemanticMode}
            >
              Keyword
            </button>
          </div>

          <input
            ref={inputRef}
            type="text"
            className="semantic-search-input"
            placeholder={
              isSemanticMode
                ? (isIndexed ? 'Search document semantically...' : 'Index document first...')
                : 'Find exact words on the page...'
            }
            value={query}
            onChange={(e) => {
              if (isSemanticMode) {
                setSemanticQuery(e.target.value);
              } else {
                setKeywordQuery(e.target.value);
              }
              setHistoryIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            disabled={disabled || isActiveSearching || (isSemanticMode && !isIndexed)}
          />

          {isSemanticMode && isIndexed && searchHistory.length > 0 && (
            <button
              type="button"
              className={`semantic-search-history-btn ${showHistory ? 'semantic-search-history-btn--active' : ''}`}
              onClick={handleToggleHistory}
              aria-label="Search history"
              title="Search history"
            >
              <HistoryIcon />
            </button>
          )}

          {query && (
            <button
              type="button"
              className="semantic-search-clear"
              onClick={handleClear}
              aria-label="Clear search"
            >
              <ClearIcon />
            </button>
          )}

          <button
            type="button"
            className="semantic-search-submit"
            onClick={handleSubmit}
            disabled={!query.trim() || isActiveSearching || (isSemanticMode && !isIndexed)}
            aria-label="Search"
          >
            {isActiveSearching ? <LoadingIcon /> : <ArrowIcon />}
          </button>

          {isSemanticMode && showHistory && searchHistory.length > 0 && (
            <div className="semantic-search-history">
              <div className="semantic-search-history-header">
                <HistoryIcon />
                <span>Recent searches</span>
              </div>
              <div className="semantic-search-history-list">
                {searchHistory.map((entry, index) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={`semantic-search-history-item ${index === historyIndex ? 'semantic-search-history-item--selected' : ''}`}
                    onClick={() => handleHistoryClick(entry)}
                  >
                    <SearchIcon />
                    <span className="semantic-search-history-query">{entry.query}</span>
                    <span className="semantic-search-history-time">{formatTimestamp(entry.timestamp)}</span>
                    <button
                      type="button"
                      className="semantic-search-history-delete"
                      onClick={(e) => handleDeleteHistory(e, entry.id)}
                      aria-label="Remove from history"
                    >
                      <ClearIcon />
                    </button>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {isSemanticMode && !isIndexed && !isIndexing && (
          <button
            type="button"
            className="semantic-search-index-btn"
            onClick={onStartIndexing}
            disabled={disabled}
            title="Index document for semantic search"
          >
            <IndexIcon />
            <span>Index</span>
          </button>
        )}

        {isSemanticMode && isIndexing && (
          <div className="semantic-search-progress">
            <div className="semantic-search-progress-bar">
              <div
                className="semantic-search-progress-fill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="semantic-search-progress-text">
              {indexingProgress.message || `${progressPercent}%`}
            </span>
          </div>
        )}

        {activeResultsCount > 0 && (
          <div className="semantic-search-results-count">
            {currentResultIndex + 1} / {activeResultsCount}
          </div>
        )}

        {isSemanticMode && isIndexed && !isIndexing && searchResults.length === 0 && !semanticQuery && (
          <div className="semantic-search-indexed-badge" title={`${indexingProgress.totalChunks} chunks indexed`}>
            <CheckIcon />
            <span>Indexed</span>
          </div>
        )}

        <div className="semantic-search-zoom" role="group" aria-label="Zoom controls">
          <button
            type="button"
            className="semantic-search-zoom-btn"
            onClick={onZoomOut}
            disabled={!canUseZoom}
            aria-label="Zoom out"
            title="Zoom out"
          >
            -
          </button>
          <button
            type="button"
            className="semantic-search-zoom-indicator"
            onClick={onZoomReset}
            disabled={!canUseZoom}
            aria-label={`Reset zoom to default, current zoom ${zoomIndicator}`}
            title="Reset zoom"
          >
            {zoomIndicator}
          </button>
          <button
            type="button"
            className="semantic-search-zoom-btn"
            onClick={onZoomIn}
            disabled={!canUseZoom}
            aria-label="Zoom in"
            title="Zoom in"
          >
            +
          </button>
        </div>

        <button
          type="button"
          className={`semantic-search-lasso-btn${isLassoMode ? ' semantic-search-lasso-btn--active' : ''}`}
          onClick={onToggleLasso}
          disabled={disabled}
          aria-pressed={isLassoMode}
          title={isLassoMode ? 'Lasso mode is on. Draw on a page to select a region.' : 'Turn on lasso mode'}
        >
          <LassoIcon />
          <span>{isLassoMode ? 'Draw' : 'Lasso'}</span>
        </button>

        <div
          className={`semantic-search-ai-status semantic-search-ai-status--${aiExtractionStatus.tone}`}
          title={aiExtractionStatus.title}
          aria-label={aiExtractionStatus.title}
        >
          <span>{aiExtractionStatus.label}</span>
        </div>

        <button
          type="button"
          className={`semantic-search-ai-btn${aiDetectionSupport.supported ? '' : ' semantic-search-ai-btn--unsupported'}`}
          onClick={() => {
            void onRunAiDetection();
          }}
          disabled={disabled || isAiDetectionRunning || !aiDetectionSupport.supported}
          title={aiDetectionButtonTitle}
        >
          <SparkIcon />
          <span>{aiDetectionButtonLabel}</span>
        </button>
      </div>
      {topTaskStatus ? <TopTaskStatusStrip status={topTaskStatus} /> : null}
    </div>
  );
}

function SearchIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12.5 12.5L17 17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ClearIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3 8h10M9 4l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LoadingIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="spin">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3" />
      <path d="M14 8a6 6 0 0 1-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IndexIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
      <rect x="2" y="2" width="14" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 6h8M5 9h8M5 12h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SparkIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 18 18" width="14" height="14" aria-hidden="true">
      <path
        d="M9 2.5l1.4 3.1 3.1 1.4-3.1 1.4L9 11.5 7.6 8.4 4.5 7l3.1-1.4L9 2.5zM13.5 10.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8.8-1.7z"
        fill="currentColor"
      />
    </svg>
  );
}

function CheckIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M3 8l3.5 3.5L13 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LassoIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 18 18" width="14" height="14" aria-hidden="true">
      <path
        d="M6.1 3.2c-2 0-3.6 1.3-3.6 3.1 0 1.9 1.7 2.8 3.6 2.8h4.7c2 0 3.6 1 3.6 2.9 0 1.6-1.3 2.8-3 2.8-1.3 0-2.3-.7-2.3-1.8 0-.8.6-1.4 1.4-1.4.7 0 1.2.5 1.2 1.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="11.1" cy="11.7" r="0.9" fill="currentColor" />
    </svg>
  );
}

function HistoryIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.5V8l2.5 2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
