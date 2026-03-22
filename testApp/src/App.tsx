import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  convertLayoutToHtml,
  renderHtmlLayout,
  createRelevanceRenderPlan,
  renderRelevanceLayout,
  DEFAULT_THEME,
  MockRelevanceService,
  DefaultRelevanceAugmenter,
  getOpenAiCompatibleProviderLabel,
  type HtmlDocumentLayout,
  type HtmlPageLayout,
  type PDFLayout,
  type RelevanceServiceConfig
} from 'pdf-layout-parser';
import { buildStructuredTables, type TableModel } from '@viewer/htmlStructuredDataRenderer';
import { loadStructuredData, renderStructuredData, SAMPLE_STRUCTURED_ASSETS_BASE } from '@viewer/htmlStructuredDataRenderer';

import type {
  FocusProvider,
  CanvasHighlightSelection,
  StructuredDataState,
  StructuredSelection
} from './types';
import {
  createFocusRecording,
  formatRecordingLabel,
  formatRecordingTimestamp,
  formatJsonOutput
} from './utils/recording';
import { applyFocusQueryContext } from './utils/query';
import { filterLayoutForPdfFocus } from './utils/layout';
import { cleanupFocusPdfDecorations } from './utils/pdfDecoration';
import { ViewerColumn } from './components/ViewerColumn';
import { ControlsSidebar } from './components/ControlsSidebar';
import { EmptyView } from './components/EmptyView';
import { GlobalErrorDialog } from './components/GlobalErrorDialog';
import { findChapterBounds, getHeadingLevel, collectChapterText, collectChapterBlocks } from './utils/structured';
import { useKeywordSearch, useSemanticSearch } from './search';
import { SemanticSearchBar } from './components/SemanticSearchBar';
import {
  useZoom,
  useViewMode,
  useRecordings,
  useDocumentLoader,
  useGeminiExtraction,
  useCanvasRenderCoordinator,
  useLogicalStructure
} from './hooks';
import { useGlobalFetchActivity } from './hooks/useGlobalFetchActivity';
import { useProxyAuthSession } from './hooks/useProxyAuthSession';
import { useTaskStatusNotice } from './hooks/useTaskStatusNotice';
import { isProxyAppRoute } from './utils/proxyRoute';
import { ProxyLoginGate } from './components/ProxyLoginGate';
import { isOpenAiCompatibleAppProvider } from './utils/providerMetadata';
import { analyzeRelevanceTask } from './api/proxyTaskApi';
import type { TopTaskStatusView } from './utils/topTaskStatus';
import {
  describeAiDetectionMode,
  parseAiDetectionMode,
  shouldAutoRunStructuredExtract
} from './utils/aiDetectionActivation';

function useCompletionNotice(
  count: number,
  notice: TopTaskStatusView,
  showNotice: (status: TopTaskStatusView, durationMs?: number) => void
): void {
  const previousCountRef = useRef(count);

  useEffect(() => {
    const previousCount = previousCountRef.current;
    if (previousCount > 0 && count === 0) {
      showNotice(notice);
    }
    previousCountRef.current = count;
  }, [count, notice, showNotice]);
}

export default function App(): JSX.Element {
  const isManagedProxyRoute = useMemo(() => isProxyAppRoute(), []);
  const aiDetectionMode = useMemo(
    () => (typeof window === 'undefined' ? 'all' : parseAiDetectionMode(window.location.search)),
    []
  );
  const enableAiDrivenTextHover = aiDetectionMode !== 'manual';
  const {
    state: proxyAuthState,
    login: loginProxySession,
    logout: logoutProxySession,
    refresh: refreshProxySession
  } = useProxyAuthSession(isManagedProxyRoute);
  const aiDetectionModeDescription = useMemo(
    () => describeAiDetectionMode(aiDetectionMode),
    [aiDetectionMode]
  );
  const devicePixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const { viewMode, setViewMode, showFocusView } = useViewMode('canvas');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [includeImageData, setIncludeImageData] = useState(false);
  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const htmlContainerRef = useRef<HTMLDivElement | null>(null);
  const structuredContainerRef = useRef<HTMLDivElement | null>(null);
  const [structuredState, setStructuredState] = useState<StructuredDataState>({ status: 'idle' });
  const [focusProvider, setFocusProvider] = useState<FocusProvider>('mock');
  const [inlineImageGenerationCount, setInlineImageGenerationCount] = useState(0);
  const [interactiveWidgetGenerationCount, setInteractiveWidgetGenerationCount] = useState(0);
  const [inlineSuggestionAnalysisCount, setInlineSuggestionAnalysisCount] = useState(0);
  const [chatActivityCount, setChatActivityCount] = useState(0);
  const [imageExplanationActivityCount, setImageExplanationActivityCount] = useState(0);
  const [formulaExplanationActivityCount, setFormulaExplanationActivityCount] = useState(0);
  const [tableInfographicActivityCount, setTableInfographicActivityCount] = useState(0);
  const [openAiConfig, setOpenAiConfig] = useState<RelevanceServiceConfig>({
    provider: 'openai',
    model: 'gpt-5.2',
    temperature: 0.2
  });
  const [structuredSelection, setStructuredSelection] = useState<StructuredSelection | null>(null);
  const {
    focusRecordings,
    setFocusRecordings,
    selectedRecordingId,
    setSelectedRecordingId,
    recordFocusExchanges,
    setRecordFocusExchanges,
    useRecordingPlayback,
    setUseRecordingPlayback,
    handleClearRecordings,
    selectedRecording: selectedRecordingFromHook
  } = useRecordings();
  // Use null instead of undefined for consistency with ViewerColumn props
  const selectedRecording = selectedRecordingFromHook ?? null;

  // useZoom hook handles renderer and zoom state
  const { zoom, setZoom, handleZoomIn, handleZoomOut, handleZoomReset, renderer } = useZoom({
    devicePixelRatio
  });

  // Focus state needs to be declared before useDocumentLoader callback
  const [focusQuery, setFocusQuery] = useState('');
  const [focusState, setFocusState] = useState<
    | { status: 'idle' }
    | { status: 'loading'; query: string }
    | { status: 'ready'; query: string; layout: any }
    | { status: 'empty'; query: string }
    | { status: 'error'; message: string }
  >({ status: 'idle' });
  const [lassoMode, setLassoMode] = useState(false);

  // Document loader hook with callback for canvas/zoom/focus reset
  const handleDocumentLoad = useCallback(() => {
    setViewMode('canvas');
    setZoom(renderer.resetZoom());
    setFocusState({ status: 'idle' });
    setFocusQuery('');
    setLassoMode(false);
  }, [renderer, setViewMode, setZoom]);

  const {
    state,
    setState,
    isOpeningFile,
    loadedFileName,
    loadedFileHash,
    taskDocumentId,
    loadedPdfData,
    aiDetectionSupport,
    extractState,
    extractedTables,
    extractDocument,
    extractParsedTables,
    extractAssetMap,
    cachedFiles,
    openFile,
    triggerExtract: triggerStructuredExtract,
    handleFileChange,
    handleOpenCachedFile,
    handleDeleteCachedFile
  } = useDocumentLoader({
    onDocumentLoad: handleDocumentLoad,
    autoExtract: shouldAutoRunStructuredExtract(aiDetectionMode)
  });

  const { lastError, dismissLastError } = useGlobalFetchActivity();
  const { notice: topTaskNotice, showNotice: showTopTaskNotice } = useTaskStatusNotice();
  const handleInlineImageGenerationActivityChange = useCallback((delta: number) => {
    setInlineImageGenerationCount((count) => Math.max(0, count + delta));
  }, []);
  const handleInteractiveWidgetGenerationActivityChange = useCallback((delta: number) => {
    setInteractiveWidgetGenerationCount((count) => Math.max(0, count + delta));
  }, []);
  const handleInlineSuggestionAnalysisActivityChange = useCallback((delta: number) => {
    setInlineSuggestionAnalysisCount((count) => Math.max(0, count + delta));
  }, []);
  const handleChatActivityChange = useCallback((delta: number) => {
    setChatActivityCount((count) => Math.max(0, count + delta));
  }, []);
  const handleImageExplanationActivityChange = useCallback((delta: number) => {
    setImageExplanationActivityCount((count) => Math.max(0, count + delta));
  }, []);
  const handleFormulaExplanationActivityChange = useCallback((delta: number) => {
    setFormulaExplanationActivityCount((count) => Math.max(0, count + delta));
  }, []);
  const handleTableInfographicActivityChange = useCallback((delta: number) => {
    setTableInfographicActivityCount((count) => Math.max(0, count + delta));
  }, []);

  // Derive interactive layout metadata from the structured extract response.
  const {
    state: geminiExtractionState,
  } = useGeminiExtraction({
    documentHash: loadedFileHash || null,
    extractDocument,
    extractState,
    aiDetectionSupport
  });

  useCompletionNotice(chatActivityCount, {
    tone: 'success',
    title: 'Chat reply ready',
    message: 'The assistant response has been added to the chat window.',
    detail: null,
    progress: null
  }, showTopTaskNotice);
  useCompletionNotice(inlineImageGenerationCount, {
    tone: 'success',
    title: 'Image ready',
    message: 'The generated image is ready.',
    detail: 'It should appear next to the selected passage.',
    progress: null
  }, showTopTaskNotice);
  useCompletionNotice(interactiveWidgetGenerationCount, {
    tone: 'success',
    title: 'Interactive widget ready',
    message: 'The generated widget is ready.',
    detail: 'The popup will update automatically.',
    progress: null
  }, showTopTaskNotice);
  useCompletionNotice(imageExplanationActivityCount, {
    tone: 'success',
    title: 'Image explanation ready',
    message: 'The image analysis is complete.',
    detail: null,
    progress: null
  }, showTopTaskNotice);
  useCompletionNotice(formulaExplanationActivityCount, {
    tone: 'success',
    title: 'Formula explanation ready',
    message: 'The formula explanation is ready.',
    detail: null,
    progress: null
  }, showTopTaskNotice);
  useCompletionNotice(tableInfographicActivityCount, {
    tone: 'success',
    title: 'Infographic ready',
    message: 'The table infographic is ready.',
    detail: null,
    progress: null
  }, showTopTaskNotice);

  const previousExtractStatusRef = useRef(extractState.status);
  useEffect(() => {
    const previousStatus = previousExtractStatusRef.current;
    if (previousStatus === 'loading' && extractState.status === 'ready') {
      showTopTaskNotice({
        tone: 'success',
        title: 'AI extraction ready',
        message: 'Structured extraction finished for this PDF.',
        detail:
          typeof extractState.totalPages === 'number'
            ? `${extractState.totalPages} pages are ready for references, formulas, tables, and layout-aware actions.`
            : 'References, formulas, tables, and layout-aware actions are now available.',
        progress: null
      });
    }
    if (previousStatus === 'loading' && extractState.status === 'error') {
      showTopTaskNotice({
        tone: 'error',
        title: 'AI extraction failed',
        message: extractState.message ?? 'The structured extraction request failed.',
        detail: null,
        progress: null
      }, 6000);
    }
    previousExtractStatusRef.current = extractState.status;
  }, [extractState.message, extractState.status, extractState.totalPages, showTopTaskNotice]);

  const handleRunAiDetection = useCallback(async () => {
    if (!aiDetectionSupport.supported) {
      return;
    }
    await triggerStructuredExtract();
  }, [aiDetectionSupport.supported, triggerStructuredExtract]);

  const handleCanvasRenderError = useCallback((message: string) => {
    setState({ status: 'error', message });
  }, [setState]);

  const readyDocument = state.status === 'ready' ? state.document : null;
  const {
    canvasRefs,
    canvasRevision,
    backgroundRenderProgress,
    getCanvasRef,
    getPageRenderState,
    shouldRenderPageOnMainThread
  } = useCanvasRenderCoordinator({
    document: readyDocument,
    pdfData: loadedPdfData,
    zoom,
    devicePixelRatio,
    viewMode,
    onRenderError: handleCanvasRenderError
  });
  const structuredTables = useMemo<TableModel[]>(() => {
    if (structuredState.status !== 'ready') {
      return [];
    }
    return buildStructuredTables(structuredState.document.elements);
  }, [structuredState]);

  useEffect(() => {
    if (!readyDocument) {
      return;
    }
    if (viewMode !== 'canvas' && viewMode !== 'focus-pdf') {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const mainThreadPageNumbers = readyDocument.pages
          .filter((page) => shouldRenderPageOnMainThread(page.number))
          .map((page) => page.number);
        const renderMainThreadPages = () => {
          renderer.setScale(zoom);
          for (const pageNumber of mainThreadPageNumbers) {
            const canvas = canvasRefs.current.get(pageNumber);
            if (!canvas) {
              continue;
            }
            renderer.render(canvas, readyDocument, pageNumber);
          }
        };

        renderMainThreadPages();
        const didLoadEmbeddedFonts = await renderer.preparePageRangeFonts(readyDocument, mainThreadPageNumbers);
        if (cancelled || !didLoadEmbeddedFonts) {
          return;
        }
        renderMainThreadPages();
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Failed to render page.';
        setState({ status: 'error', message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canvasRefs, canvasRevision, readyDocument, renderer, shouldRenderPageOnMainThread, viewMode, zoom]);

  const totalPages = readyDocument?.pages.length ?? 0;
  const pageInfo = readyDocument ? `Pages: ${totalPages}` : 'No document loaded';
  const zoomIndicator = `${Math.round(zoom * 100)}%`;
  const documentText = useMemo(() => readyDocument?.getText() ?? '', [readyDocument]);

  const pdfLayout = useMemo<PDFLayout | null>(() => {
    if (state.status !== 'ready') {
      return null;
    }
    return {
      pages: state.document.pages.map((page) => ({
        number: page.number,
        size: { ...page.size },
        textItems: page.textItems.map((item) => ({
          ...item,
          bounds: { ...item.bounds }
        })),
        imageItems: page.imageItems.slice()
      }))
    };
  }, [state]);

  const htmlLayout = useMemo<HtmlDocumentLayout | null>(() => {
    if (!pdfLayout) {
      return null;
    }
    return convertLayoutToHtml(pdfLayout);
  }, [pdfLayout]);
  const logicalStructure = useLogicalStructure({
    fileHash: loadedFileHash,
    taskDocumentId,
    htmlLayout,
    enabled: enableAiDrivenTextHover
  });

  // Semantic search document data - prefer htmlLayout for block-level chunking
  const semanticDocumentData = useMemo(() => {
    if (!readyDocument || !loadedFileHash || !taskDocumentId) {
      return null;
    }
    return {
      documentId: taskDocumentId,
      documentHash: loadedFileHash,
      // Include htmlLayout for block-level semantic chunking (paragraphs, headings, tables)
      htmlLayout: htmlLayout ?? undefined,
      // Fallback pages data for sentence-level chunking if htmlLayout unavailable
      pages: readyDocument.pages.map((page) => ({
        number: page.number,
        textItems: page.textItems.map((item) => ({
          text: item.text,
          bounds: { ...item.bounds }
        }))
      }))
    };
  }, [readyDocument, loadedFileHash, taskDocumentId, htmlLayout]);

  // Semantic search hook
  const {
    search: keywordSearchFn,
    searchResults: keywordSearchResults,
    isSearching: isKeywordSearching,
    clearResults: clearKeywordSearchResults
  } = useKeywordSearch(readyDocument);

  const {
    isIndexed,
    isIndexing,
    indexingProgress,
    search: semanticSearchFn,
    searchResults: semanticSearchResults,
    isSearching,
    clearResults: clearSemanticResults
  } = useSemanticSearch(semanticDocumentData, { autoIndex: true });

  // Sort semantic results by relevance score (best match first)
  const sortedSemanticResults = useMemo(() => {
    if (semanticSearchResults.length === 0) return semanticSearchResults;
    return [...semanticSearchResults].sort((a, b) => b.score - a.score);
  }, [semanticSearchResults]);

  const [activeSemanticResultIndex, setActiveSemanticResultIndex] = useState(0);
  const [activeKeywordResultIndex, setActiveKeywordResultIndex] = useState(0);

  const topTaskStatus = useMemo<TopTaskStatusView | null>(() => {
    if (chatActivityCount > 0) {
      return {
        tone: 'running',
        title: 'Answering question',
        message: 'Generating a response for the selected document context.',
        detail: enableWebSearch ? 'Web search is enabled for this chat.' : null,
        progress: null
      };
    }

    if (inlineImageGenerationCount > 0) {
      return {
        tone: 'running',
        title: 'Generating image',
        message: 'Creating an image from the selected passage.',
        detail: 'The image popup will update automatically when it is ready.',
        progress: null
      };
    }

    if (tableInfographicActivityCount > 0) {
      return {
        tone: 'running',
        title: 'Generating infographic',
        message: 'Building a visual summary for the selected table.',
        detail: 'The table popup will update automatically when it is ready.',
        progress: null
      };
    }

    if (interactiveWidgetGenerationCount > 0) {
      return {
        tone: 'running',
        title: 'Generating interactive widget',
        message: 'Creating a teaching widget for the selected content.',
        detail: 'The widget popup will update automatically when it is ready.',
        progress: null
      };
    }

    if (imageExplanationActivityCount > 0) {
      return {
        tone: 'running',
        title: 'Explaining image',
        message: 'Analyzing the selected image.',
        detail: null,
        progress: null
      };
    }

    if (formulaExplanationActivityCount > 0) {
      return {
        tone: 'running',
        title: 'Explaining formula',
        message: 'Analyzing the selected formula.',
        detail: null,
        progress: null
      };
    }

    if (isOpeningFile) {
      return {
        tone: 'running',
        title: 'Opening PDF',
        message: 'Reading and parsing the PDF without calling any AI APIs.',
        progress: null,
        detail: loadedFileName ? `File: ${loadedFileName}` : null
      };
    }

    if (extractState.status === 'loading') {
      const progress =
        typeof extractState.totalPages === 'number' && extractState.totalPages > 0
          ? Math.min(
              1,
              Math.max(
                0,
                (extractState.publishedPages ?? extractState.completedPages ?? 0) / extractState.totalPages
              )
            )
          : null;
      const detailParts = [
        loadedFileName ? `Processing ${loadedFileName}` : null,
        typeof extractState.totalPages === 'number'
          ? `Published ${extractState.publishedPages ?? 0} of ${extractState.totalPages} pages`
          : null,
        typeof extractState.totalPages === 'number' && typeof extractState.completedPages === 'number'
          ? `completed AI calls for ${extractState.completedPages} pages`
          : null
      ].filter((value): value is string => Boolean(value));
      return {
        tone: 'running',
        title: 'Running AI Extraction',
        message: 'Processing pages incrementally so early pages can appear before the full document finishes.',
        progress,
        detail: detailParts.length > 0 ? detailParts.join(' · ') : 'AI extraction is running.'
      };
    }

    if (isIndexing) {
      const total = indexingProgress.totalChunks;
      const processed = indexingProgress.processedChunks;
      const progress = total > 0 ? processed / total : null;
      return {
        tone: 'running',
        title: 'Building Semantic Index',
        message: 'Creating embeddings for semantic search and RAG-style lookup.',
        progress,
        detail:
          indexingProgress.message ??
          (total > 0 ? `Processed ${Math.min(processed, total)} of ${total} chunks.` : 'Preparing chunks...')
      };
    }

    if (isSearching) {
      return {
        tone: 'running',
        title: 'Running Semantic Search',
        message: 'Querying embeddings and ranking the most relevant passages.',
        progress: null,
        detail: null
      };
    }

    if (focusState.status === 'loading') {
      return {
        tone: 'running',
        title: 'Analyzing Relevance',
        message: 'Calling the AI model to highlight relevant sections for your query.',
        progress: null,
        detail: focusState.query ? `Query: ${focusState.query}` : null
      };
    }

    if (inlineSuggestionAnalysisCount > 0) {
      return {
        tone: 'running',
        title: 'Checking formulas',
        message: 'Scanning the selected text for math content.',
        detail: null,
        progress: null
      };
    }

    if (structuredState.status === 'loading') {
      return {
        tone: 'running',
        title: 'Loading Structured View',
        message: 'Loading structured demo data for the current view.',
        progress: null,
        detail: null
      };
    }

    return topTaskNotice;
  }, [
    chatActivityCount,
    enableWebSearch,
    inlineImageGenerationCount,
    tableInfographicActivityCount,
    interactiveWidgetGenerationCount,
    imageExplanationActivityCount,
    formulaExplanationActivityCount,
    isOpeningFile,
    loadedFileName,
    extractState.status,
    extractState.totalPages,
    extractState.completedPages,
    extractState.publishedPages,
    isIndexing,
    indexingProgress.totalChunks,
    indexingProgress.processedChunks,
    indexingProgress.message,
    isSearching,
    focusState,
    inlineSuggestionAnalysisCount,
    structuredState.status,
    topTaskNotice
  ]);

  // Reset active index when results change and auto-navigate to first result
  useEffect(() => {
    setActiveSemanticResultIndex(0);
    // Auto-navigate to the first result when new search results arrive
    if (sortedSemanticResults.length > 0) {
      const firstResult = sortedSemanticResults[0];
      const pageNumber = firstResult.chunk.pageNumber;
      const pageElement = document.querySelector(`[data-page-number="${pageNumber}"]`);
      if (pageElement) {
        pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [sortedSemanticResults]);

  useEffect(() => {
    setActiveKeywordResultIndex(0);
    if (keywordSearchResults.length > 0) {
      const firstResult = keywordSearchResults[0];
      const pageElement = document.querySelector(`[data-page-number="${firstResult.pageNumber}"]`);
      if (pageElement) {
        pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [keywordSearchResults]);

  // Scroll to active result
  const handleNavigateSemanticResult = useCallback((index: number) => {
    setActiveSemanticResultIndex(index);
    const result = sortedSemanticResults[index];
    if (!result) return;

    // Find the page element and scroll to it
    const pageNumber = result.chunk.pageNumber;
    const pageElement = document.querySelector(`[data-page-number="${pageNumber}"]`);
    if (pageElement) {
      pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [sortedSemanticResults]);

  const handleNavigateKeywordResult = useCallback((index: number) => {
    setActiveKeywordResultIndex(index);
    const result = keywordSearchResults[index];
    if (!result) {
      return;
    }

    const pageElement = document.querySelector(`[data-page-number="${result.pageNumber}"]`);
    if (pageElement) {
      pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [keywordSearchResults]);

  const [canvasHighlight, setCanvasHighlight] = useState<CanvasHighlightSelection | null>(null);
  const [enableFormulaHighlight, setEnableFormulaHighlight] = useState(true);
  const [enableTableHighlight, setEnableTableHighlight] = useState(true);
  const htmlPageLayouts = useMemo<Map<number, HtmlPageLayout>>(() => {
    if (!htmlLayout) {
      return new Map();
    }
    return new Map(htmlLayout.pages.map((page) => [page.number, page]));
  }, [htmlLayout]);

  useEffect(() => {
    setCanvasHighlight(null);
  }, [htmlLayout]);

  const layoutJson = useMemo(() => {
    if (state.status !== 'ready') {
      return '';
    }
    const payload = {
      pages: state.document.pages.map((page) => ({
        number: page.number,
        size: page.size,
        textItems: page.textItems.map((item) => ({
          text: item.text,
          bounds: item.bounds,
          font: item.font ?? null,
          fontSize: item.fontSize ?? null
        })),
        imageItems: page.imageItems.map((item) => ({
          name: item.name,
          bounds: item.bounds,
          width: item.width ?? null,
          height: item.height ?? null,
          sourceWidth: item.sourceWidth ?? null,
          sourceHeight: item.sourceHeight ?? null,
          mimeType: item.mimeType ?? null,
          dataUri: includeImageData ? item.dataUri ?? null : '[hidden]'
        }))
      }))
    };
    return JSON.stringify(payload, null, 2);
  }, [state, includeImageData]);

  const htmlFriendlyJson = useMemo(() => {
    if (!htmlLayout) {
      return '';
    }
    const replacer = includeImageData
      ? undefined
      : (key: string, value: unknown) => {
          if (key === 'dataUri' && typeof value === 'string') {
            return '[hidden]';
          }
          return value;
        };
    return JSON.stringify(htmlLayout, replacer, 2);
  }, [htmlLayout, includeImageData]);

  const handleProxyLogout = useCallback(async () => {
    await logoutProxySession();
  }, [logoutProxySession]);

  useEffect(() => {
    if (focusQuery.trim().length === 0 && focusState.status !== 'idle') {
      setFocusState({ status: 'idle' });
      if (viewMode === 'focus-render' || viewMode === 'focus-pdf') {
        setViewMode('canvas');
      }
    }
  }, [focusQuery, focusState.status, viewMode]);

  const handleRunFocus = useCallback(async () => {
    const query = focusQuery.trim();
    if (query.length === 0) {
      return;
    }

    const currentLayout = htmlLayout;
    const augmenter = new DefaultRelevanceAugmenter();

    if (useRecordingPlayback) {
      if (!selectedRecording) {
        setFocusState({ status: 'error', message: 'Select a recording to replay.' });
        return;
      }
      if (!isOpenAiCompatibleAppProvider(focusProvider)) {
        setFocusState({ status: 'error', message: 'Recording playback is available only for OpenAI-compatible providers.' });
        return;
      }
      if (selectedRecording.query !== query) {
        setFocusState({
          status: 'error',
          message: `Recording captured query "${selectedRecording.query}". Update the focus query or disable replay.`
        });
        return;
      }
      const baseLayout = currentLayout ?? selectedRecording.document;
      if (!baseLayout) {
        setFocusState({
          status: 'error',
          message: 'No layout available to replay the recording.'
        });
        return;
      }
      const replayResponse = {
        annotations: selectedRecording.annotations,
        model: selectedRecording.responseModel,
        createdAt: selectedRecording.responseCreatedAt,
        querySummary: selectedRecording.querySummary
      };
      const augmented = augmenter.augment(baseLayout, replayResponse, { query, defaultState: 'hidden' });
      applyFocusQueryContext(augmented, query);
      const hasHighlights = augmented.pages.some((page) =>
        page.content.some((block) => block.relevance?.state === 'highlight')
      );

      if (!hasHighlights) {
        setFocusState({ status: 'empty', query });
        showFocusView('focus-pdf');
        return;
      }

      setFocusState({ status: 'ready', query, layout: augmented });
      showFocusView('focus-pdf');
      return;
    }

    if (!currentLayout) {
      return;
    }

    setFocusState({ status: 'loading', query });

    try {
      const response = focusProvider === 'mock'
        ? await new MockRelevanceService().analyze({
            query,
            document: currentLayout
          })
        : await analyzeRelevanceTask({
            query,
            document: currentLayout as unknown as Record<string, unknown>,
            provider: focusProvider,
            model: openAiConfig.model && openAiConfig.model.length > 0 ? openAiConfig.model : 'gpt-5.2',
            maxContextTokens: 6000
          });
      const augmented = augmenter.augment(currentLayout, response, { query, defaultState: 'hidden' });
      applyFocusQueryContext(augmented, query);
      const hasHighlights = augmented.pages.some((page) =>
        page.content.some((block) => block.relevance?.state === 'highlight')
      );

      if (!hasHighlights) {
        setFocusState({ status: 'empty', query });
        showFocusView('focus-pdf');
        return;
      }

      setFocusState({ status: 'ready', query, layout: augmented });
      showFocusView('focus-pdf');

      if (isOpenAiCompatibleAppProvider(focusProvider) && recordFocusExchanges) {
        const recording = createFocusRecording({
          provider: focusProvider,
          query,
          response,
          layout: currentLayout,
          exchange: {
            provider: focusProvider,
            query,
            prompt: '[handled via proxy task analyze-relevance]',
            requestPayload: {
              query,
              provider: focusProvider,
              model: openAiConfig.model,
              pageCount: currentLayout.pages.length
            },
            responsePayload: response
          }
        });
        setFocusRecordings((prev) => [recording, ...prev]);
        setSelectedRecordingId(recording.id);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : isOpenAiCompatibleAppProvider(focusProvider)
            ? `Unable to query ${getOpenAiCompatibleProviderLabel(focusProvider)}. Check the backend provider configuration and selected model.`
            : 'Unable to highlight relevant sections.';
      setFocusState({ status: 'error', message });
    }
  }, [
    focusQuery,
    htmlLayout,
    useRecordingPlayback,
    selectedRecording,
    focusProvider,
    openAiConfig,
    recordFocusExchanges,
    showFocusView
  ]);

  const focusPdfProjection = useMemo(() => {
    if (focusState.status !== 'ready') {
      return { layout: null, hiddenPageCount: 0 };
    }
    return filterLayoutForPdfFocus(focusState.layout);
  }, [focusState]);

  const hiddenPdfPageCount = viewMode === 'focus-pdf' ? focusPdfProjection.hiddenPageCount : 0;
  const focusHighlightCount = useMemo(() => {
    if (focusState.status !== 'ready') {
      return 0;
    }
    let count = 0;
    for (const page of focusState.layout.pages) {
      for (const block of page.content) {
        if (block.relevance?.state === 'highlight') {
          count += 1;
        }
      }
    }
    return count;
  }, [focusState]);

  const pagesWithMatches = useMemo(() => {
    if (focusState.status !== 'ready') {
      return new Set<number>();
    }
    const pages = new Set<number>();
    for (const page of focusState.layout.pages) {
      const pageNum = page.pageNumber ?? page.number;
      for (const block of page.content) {
        if (block.relevance?.state === 'highlight') {
          pages.add(pageNum);
          break;
        }
      }
    }
    return pages;
  }, [focusState]);

  const handleCanvasHighlight = useCallback((selection: CanvasHighlightSelection | null) => {
    setCanvasHighlight(selection);
  }, []);

  const handleToggleLassoMode = useCallback(() => {
    setCanvasHighlight(null);
    setLassoMode((current) => !current);
  }, []);

  useEffect(() => {
    if (viewMode !== 'canvas' && viewMode !== 'focus-pdf') {
      setLassoMode(false);
    }
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== 'html-render') {
      return;
    }
    if (!htmlLayout) {
      return;
    }
    const container = htmlContainerRef.current;
    if (!container) {
      return;
    }
    renderHtmlLayout(container, htmlLayout, { scale: zoom, positioning: 'flow' });
  }, [viewMode, htmlLayout, zoom]);

  useEffect(() => {
    const isFocusView = viewMode === 'focus-render';
    const container = htmlContainerRef.current;
    if (!isFocusView) {
      if (container) {
        container.dataset.focusMode = 'disabled';
        delete container.dataset.focusLayout;
        cleanupFocusPdfDecorations(container);
      }
      return;
    }
    if (focusState.status !== 'ready' || !container) {
      return;
    }
    const plan = createRelevanceRenderPlan(focusState.layout, { scale: zoom, theme: DEFAULT_THEME });
    renderRelevanceLayout(container, plan, {
      showSummaries: true,
      positioning: 'flow',
      pageGap: undefined
    });
    container.dataset.focusMode = 'enabled';
    container.dataset.focusLayout = 'flow';
    cleanupFocusPdfDecorations(container);
  }, [viewMode, focusState, zoom]);

  const handleFocusProviderChange = useCallback((provider: FocusProvider) => {
    setFocusProvider(provider);
    setFocusState({ status: 'idle' });
  }, []);

  const recordingPlaybackDisabled =
    !isOpenAiCompatibleAppProvider(focusProvider) ||
    !selectedRecording ||
    focusRecordings.length === 0 ||
    focusState.status === 'loading';
  const canUseZoom =
    state.status === 'ready' || (viewMode === 'structured-data' && structuredState.status === 'ready');

  const handleStructuredElementClick = useCallback(
    (payload: {
      event: MouseEvent;
      element: HTMLElement;
      pageNumber: number;
      path?: string;
      text?: string;
      rect: { left: number; top: number; width: number; height: number };
      tableId?: string | null;
      elementId?: number | null;
    }) => {
      const container = structuredContainerRef.current;
      if (!container) {
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const elementRect = payload.element.getBoundingClientRect();
      const left = elementRect.left - containerRect.left + container.scrollLeft;
      const top = elementRect.top - containerRect.top + container.scrollTop;
      const table = payload.tableId
        ? structuredTables.find((model) => model.id === payload.tableId) ?? null
        : null;
      if (table) {
        setStructuredSelection({
          kind: 'table',
          page: payload.pageNumber,
          path: payload.path,
          rect: {
            left,
            top,
            width: elementRect.width,
            height: elementRect.height
          },
          tableId: payload.tableId,
          table,
          elementId: payload.elementId ?? null
        });
        return;
      }

      const headingLevel = payload.path ? getHeadingLevel(payload.path) : null;
      if (headingLevel !== null && payload.elementId && structuredState.status === 'ready') {
        const chapterBounds = findChapterBounds({
          elements: structuredState.document.elements,
          container,
          startElementId: payload.elementId,
          startPage: payload.pageNumber,
          headingLevel,
          pages: structuredState.document.pages
        });
        if (chapterBounds) {
          const chapterText = collectChapterText({
            elements: structuredState.document.elements,
            startElementId: payload.elementId,
            headingLevel,
            startPage: payload.pageNumber
          });
          const chapterBlocks = collectChapterBlocks({
            elements: structuredState.document.elements,
            startElementId: payload.elementId,
            headingLevel,
            startPage: payload.pageNumber
          });
          setStructuredSelection({
            kind: 'text',
            page: payload.pageNumber,
            path: payload.path,
            text: chapterText || payload.text,
            rect: chapterBounds,
            elementId: payload.elementId ?? null,
            chapterBlocks
          });
          return;
        }
      }

      setStructuredSelection({
        kind: 'text',
        page: payload.pageNumber,
        path: payload.path,
        text: payload.text,
        rect: {
          left,
          top,
          width: elementRect.width,
          height: elementRect.height
        },
        elementId: payload.elementId ?? null
      });
    },
    [structuredTables, structuredState]
  );

  useEffect(() => {
    if (viewMode !== 'structured-data') {
      setStructuredSelection(null);
    }
  }, [viewMode]);

  useEffect(() => {
    if (structuredState.status !== 'ready') {
      setStructuredSelection(null);
    }
  }, [structuredState.status]);

  useEffect(() => {
    if (viewMode === 'structured-data') {
      setStructuredSelection(null);
    }
  }, [zoom, viewMode]);

  useEffect(() => {
    if (viewMode !== 'structured-data') {
      return;
    }
    if (structuredState.status !== 'idle' && structuredState.status !== 'error') {
      return;
    }
    let cancelled = false;
    setStructuredState({ status: 'loading' });
    loadStructuredData()
      .then((document) => {
        if (!cancelled) {
          setStructuredState({ status: 'ready', document });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Unable to load structured data.';
          setStructuredState({ status: 'error', message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [viewMode, structuredState.status]);

  useEffect(() => {
    if (viewMode !== 'structured-data') {
      return;
    }
    if (structuredState.status !== 'ready') {
      return;
    }
    const container = structuredContainerRef.current;
    if (!container) {
      return;
    }
    renderStructuredData(
      container,
      structuredState.document,
      {
        assetsBaseUrl: SAMPLE_STRUCTURED_ASSETS_BASE,
        scale: zoom,
        tables: structuredTables
      },
      handleStructuredElementClick
    );
  }, [viewMode, structuredState, zoom, handleStructuredElementClick, structuredTables]);

  if (
    isManagedProxyRoute &&
    (proxyAuthState.status === 'loading' ||
      proxyAuthState.status === 'error' ||
      (proxyAuthState.authEnabled && !proxyAuthState.authenticated))
  ) {
    return (
      <ProxyLoginGate
        error={proxyAuthState.error}
        isLoading={proxyAuthState.status === 'loading'}
        onLogin={loginProxySession}
        onRetry={refreshProxySession}
      />
    );
  }

  return (
    <div className="app-shell">
      {(state.status !== 'idle' || isOpeningFile) && (
        <SemanticSearchBar
          isIndexed={isIndexed}
          isIndexing={isIndexing}
          indexingProgress={indexingProgress}
          zoomIndicator={zoomIndicator}
          canUseZoom={canUseZoom}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
          isLassoMode={lassoMode}
          onToggleLasso={handleToggleLassoMode}
          onSearch={semanticSearchFn}
          onClearSearch={clearSemanticResults}
          searchResults={sortedSemanticResults}
          isSearching={isSearching}
          onKeywordSearch={keywordSearchFn}
          onClearKeywordSearch={clearKeywordSearchResults}
          keywordSearchResults={keywordSearchResults}
          isKeywordSearching={isKeywordSearching}
          disabled={state.status !== 'ready'}
          activeResultIndex={activeSemanticResultIndex}
          onNavigateResult={handleNavigateSemanticResult}
          activeKeywordResultIndex={activeKeywordResultIndex}
          onNavigateKeywordResult={handleNavigateKeywordResult}
          documentId={loadedFileHash || loadedFileName || 'document'}
          extractState={extractState}
          geminiExtractionState={geminiExtractionState}
          aiDetectionSupport={aiDetectionSupport}
          aiDetectionModeDescription={aiDetectionModeDescription}
          onRunAiDetection={handleRunAiDetection}
          topTaskStatus={topTaskStatus}
        />
      )}
      {state.status === 'idle' ? (
        <EmptyView
          onFileChange={handleFileChange}
          recentFiles={cachedFiles}
          onOpenCachedFile={handleOpenCachedFile}
          onDeleteCachedFile={handleDeleteCachedFile}
        />
      ) : (
        <ViewerColumn
          viewMode={viewMode}
          state={state}
          readyDocument={readyDocument}
          documentId={loadedFileHash || loadedFileName || 'document'}
          taskDocumentId={taskDocumentId}
          backgroundRenderProgress={backgroundRenderProgress}
          getCanvasRef={getCanvasRef}
          getPageRenderState={getPageRenderState}
          layoutJson={layoutJson}
          htmlFriendlyJson={htmlFriendlyJson}
          htmlPageLayouts={htmlPageLayouts}
          logicalStructure={logicalStructure}
          enableTextHoverOverlay={enableAiDrivenTextHover}
          canvasHighlight={canvasHighlight}
          onCanvasHighlight={handleCanvasHighlight}
          focusState={focusState}
          focusHighlightCount={focusHighlightCount}
          hiddenPdfPageCount={hiddenPdfPageCount}
          htmlContainerRef={htmlContainerRef}
          focusRecordings={focusRecordings}
          selectedRecording={selectedRecording}
          onClearRecordings={handleClearRecordings}
          formatRecordingTimestamp={formatRecordingTimestamp}
          formatJsonOutput={formatJsonOutput}
          pagesWithMatches={pagesWithMatches}
          zoom={zoom}
          focusProvider={focusProvider}
          extractedTables={extractedTables}
          structuredState={structuredState}
          structuredContainerRef={structuredContainerRef}
          structuredSelection={structuredSelection}
          onClearStructuredSelection={() => setStructuredSelection(null)}
          keywordSearchResults={keywordSearchResults}
          activeKeywordResultId={keywordSearchResults[activeKeywordResultIndex]?.id}
          semanticSearchResults={sortedSemanticResults}
          activeSemanticResultIndex={activeSemanticResultIndex}
          geminiExtraction={geminiExtractionState.extraction}
          lassoMode={lassoMode}
          onLassoModeChange={setLassoMode}
          documentText={documentText}
          totalPages={totalPages}
          enableFormulaHighlight={enableFormulaHighlight}
          enableTableHighlight={enableTableHighlight}
          enableWebSearch={enableWebSearch}
          onChatActivityChange={handleChatActivityChange}
          onImageExplanationActivityChange={handleImageExplanationActivityChange}
          onFormulaExplanationActivityChange={handleFormulaExplanationActivityChange}
          onTableInfographicActivityChange={handleTableInfographicActivityChange}
          onInlineImageGenerationActivityChange={handleInlineImageGenerationActivityChange}
          onInteractiveWidgetGenerationActivityChange={handleInteractiveWidgetGenerationActivityChange}
          onInlineSuggestionAnalysisActivityChange={handleInlineSuggestionAnalysisActivityChange}
        />
      )}
      <button
        type="button"
        className={`sidebar-toggle${sidebarCollapsed ? '' : ' sidebar-toggle--expanded'}`}
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        title={sidebarCollapsed ? 'Show settings' : 'Hide settings'}
      >
        {sidebarCollapsed ? '<' : '>'}
      </button>
      {!sidebarCollapsed && (
        <ControlsSidebar
          state={state}
          pageInfo={pageInfo}
          includeImageData={includeImageData}
          setIncludeImageData={setIncludeImageData}
          focusQuery={focusQuery}
          setFocusQuery={setFocusQuery}
          focusProvider={focusProvider}
          onFocusProviderChange={handleFocusProviderChange}
          onRunFocus={handleRunFocus}
          focusState={focusState}
          openAiConfig={openAiConfig}
          setOpenAiConfig={setOpenAiConfig}
          recordFocusExchanges={recordFocusExchanges}
          setRecordFocusExchanges={setRecordFocusExchanges}
          useRecordingPlayback={useRecordingPlayback}
          setUseRecordingPlayback={setUseRecordingPlayback}
          focusRecordings={focusRecordings}
          selectedRecordingId={selectedRecordingId}
          setSelectedRecordingId={setSelectedRecordingId}
          recordingPlaybackDisabled={recordingPlaybackDisabled}
          formatRecordingLabel={formatRecordingLabel}
          viewMode={viewMode}
          setViewMode={setViewMode}
          showFocusView={showFocusView}
          extractState={extractState}
          geminiExtractionState={geminiExtractionState}
          aiDetectionSupport={aiDetectionSupport}
          aiDetectionModeDescription={aiDetectionModeDescription}
          enableFormulaHighlight={enableFormulaHighlight}
          setEnableFormulaHighlight={setEnableFormulaHighlight}
          enableTableHighlight={enableTableHighlight}
          setEnableTableHighlight={setEnableTableHighlight}
          enableWebSearch={enableWebSearch}
          setEnableWebSearch={setEnableWebSearch}
          isProxyRouteManaged={isManagedProxyRoute}
          proxySessionUsername={proxyAuthState.authenticated ? proxyAuthState.username : null}
          onProxyLogout={handleProxyLogout}
        />
      )}
      <GlobalErrorDialog
        error={lastError}
        onClose={dismissLastError}
      />
    </div>
  );
}
