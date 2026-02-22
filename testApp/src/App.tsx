import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  convertLayoutToHtml,
  renderHtmlLayout,
  createRelevanceRenderPlan,
  renderRelevanceLayout,
  DEFAULT_THEME,
  MockRelevanceService,
  DefaultRelevanceAugmenter,
  OpenAiRelevanceService,
  type HtmlDocumentLayout,
  type HtmlPageLayout,
  type PDFLayout,
  type RelevanceDebugExchange,
  type RelevanceServiceConfig
} from 'pdf-layout-parser';
import { buildStructuredTables, type TableModel } from '@viewer/htmlStructuredDataRenderer';
import { loadStructuredData, renderStructuredData, SAMPLE_STRUCTURED_ASSETS_BASE } from '@viewer/htmlStructuredDataRenderer';

import OpenAI from 'openai';

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
import { findChapterBounds, getHeadingLevel, collectChapterText, collectChapterBlocks } from './utils/structured';
import { useSemanticSearch } from './search';
import { SemanticSearchBar } from './components/SemanticSearchBar';
import { useZoom, useViewMode, useRecordings, useDocumentLoader, useGeminiExtraction } from './hooks';

export default function App(): JSX.Element {
  const { viewMode, setViewMode, showFocusView } = useViewMode('canvas');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [includeImageData, setIncludeImageData] = useState(false);
  const htmlContainerRef = useRef<HTMLDivElement | null>(null);
  const structuredContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const canvasRefCallbacks = useRef<Map<number, (element: HTMLCanvasElement | null) => void>>(new Map());
  const [canvasRevision, setCanvasRevision] = useState(0);
  const [structuredState, setStructuredState] = useState<StructuredDataState>({ status: 'idle' });
  const [focusProvider, setFocusProvider] = useState<FocusProvider>('mock');
  const [openAiConfig, setOpenAiConfig] = useState<RelevanceServiceConfig>({
    provider: 'openai',
    model: 'gpt-4.1-mini',
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
    focusExchangeRef,
    handleClearRecordings,
    selectedRecording: selectedRecordingFromHook
  } = useRecordings();
  // Use null instead of undefined for consistency with ViewerColumn props
  const selectedRecording = selectedRecordingFromHook ?? null;

  // useZoom hook handles renderer and zoom state
  const { zoom, setZoom, handleZoomIn, handleZoomOut, handleZoomReset, renderer } = useZoom();

  // Focus state needs to be declared before useDocumentLoader callback
  const [focusQuery, setFocusQuery] = useState('');
  const [focusState, setFocusState] = useState<
    | { status: 'idle' }
    | { status: 'loading'; query: string }
    | { status: 'ready'; query: string; layout: any }
    | { status: 'empty'; query: string }
    | { status: 'error'; message: string }
  >({ status: 'idle' });

  // Document loader hook with callback for canvas/zoom/focus reset
  const handleDocumentLoad = useCallback(() => {
    canvasRefs.current.clear();
    canvasRefCallbacks.current.clear();
    setCanvasRevision((revision) => revision + 1);
    setViewMode('canvas');
    setZoom(renderer.resetZoom());
    setFocusState({ status: 'idle' });
    setFocusQuery('');
  }, [renderer, setViewMode, setZoom]);

  const {
    state,
    setState,
    loadedFileName,
    loadedFileHash,
    loadedPdfData,
    extractState,
    extractedTables,
    extractDocument,
    extractParsedTables,
    extractAssetMap,
    cachedFiles,
    openFile,
    handleFileChange,
    handleOpenCachedFile,
    handleDeleteCachedFile
  } = useDocumentLoader({ onDocumentLoad: handleDocumentLoad });

  // Gemini extraction for detecting references and other elements
  const {
    state: geminiExtractionState,
    triggerExtraction: triggerGeminiExtraction
  } = useGeminiExtraction({
    documentHash: loadedFileHash || null,
    pdfData: loadedPdfData,
    autoExtract: false
  });

  const readyDocument = state.status === 'ready' ? state.document : null;
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
    try {
      renderer.setScale(zoom);
      for (const page of readyDocument.pages) {
        const canvas = canvasRefs.current.get(page.number);
        if (!canvas) {
          continue;
        }
        renderer.render(canvas, readyDocument, page.number);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to render page.';
      setState({ status: 'error', message });
    }
  }, [readyDocument, renderer, viewMode, zoom, canvasRevision]);

  const getCanvasRef = useCallback(
    (pageNumber: number) => {
      const existing = canvasRefCallbacks.current.get(pageNumber);
      if (existing) {
        return existing;
      }
      const callback = (element: HTMLCanvasElement | null) => {
        if (element) {
          canvasRefs.current.set(pageNumber, element);
        } else {
          canvasRefs.current.delete(pageNumber);
        }
        setCanvasRevision((revision) => revision + 1);
      };
      canvasRefCallbacks.current.set(pageNumber, callback);
      return callback;
    },
    [setCanvasRevision]
  );

  const totalPages = readyDocument?.pages.length ?? 0;
  const pageInfo = readyDocument ? `Pages: ${totalPages}` : 'No document loaded';
  const zoomIndicator = `${Math.round(zoom * 100)}%`;

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

  // Semantic search document data - prefer htmlLayout for block-level chunking
  const semanticDocumentData = useMemo(() => {
    if (!readyDocument || !loadedFileHash) {
      return null;
    }
    return {
      documentId: loadedFileName || 'document',
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
  }, [readyDocument, loadedFileHash, loadedFileName, htmlLayout]);

  // Semantic search hook
  const {
    isIndexed,
    isIndexing,
    indexingProgress,
    startIndexing,
    search: semanticSearchFn,
    searchResults: semanticSearchResults,
    isSearching,
    clearResults: clearSemanticResults
  } = useSemanticSearch(semanticDocumentData);

  // Sort semantic results by relevance score (best match first)
  const sortedSemanticResults = useMemo(() => {
    if (semanticSearchResults.length === 0) return semanticSearchResults;
    return [...semanticSearchResults].sort((a, b) => b.score - a.score);
  }, [semanticSearchResults]);

  const [activeSemanticResultIndex, setActiveSemanticResultIndex] = useState(0);

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

  const [canvasHighlight, setCanvasHighlight] = useState<CanvasHighlightSelection | null>(null);
  const [enableFormulaHighlight, setEnableFormulaHighlight] = useState(true);
  const [enableTableHighlight, setEnableTableHighlight] = useState(true);
  const [enableWebSearch, setEnableWebSearch] = useState(false);

  const htmlPageLayouts = useMemo<Map<number, HtmlPageLayout>>(() => {
    if (!htmlLayout) {
      return new Map();
    }
    return new Map(htmlLayout.pages.map((page) => [page.number, page]));
  }, [htmlLayout]);

  useEffect(() => {
    setCanvasHighlight(null);
  }, [htmlLayout]);

  const createFocusService = useCallback(
    (provider: FocusProvider, config: RelevanceServiceConfig) => {
      if (provider === 'openai') {
        if (!config.apiKey || config.apiKey.length === 0) {
          throw new Error('OpenAI API key is required');
        }
        const clientFactory = () =>
          new OpenAI({
            apiKey: config.apiKey!,
            baseURL: config.endpoint,
            dangerouslyAllowBrowser: true
          });
        return new OpenAiRelevanceService(
          {
            ...config,
            provider: 'openai',
            model: config.model && config.model.length > 0 ? config.model : 'gpt-4.1-mini',
            dangerouslyAllowBrowser: true
          },
          clientFactory
        );
      }
      return new MockRelevanceService();
    },
    []
  );

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

  const handleCaptureExchange = useCallback((exchange: RelevanceDebugExchange) => {
    focusExchangeRef.current = exchange;
  }, []);

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
      if (focusProvider !== 'openai') {
        setFocusState({ status: 'error', message: 'Recording playback is available only for the OpenAI provider.' });
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

    if (!useRecordingPlayback && focusProvider === 'openai' && (!openAiConfig.apiKey || openAiConfig.apiKey.length === 0)) {
      setFocusState({ status: 'error', message: 'Provide an OpenAI API key to use GPT focus mode.' });
      return;
    }

    setFocusState({ status: 'loading', query });
    focusExchangeRef.current = null;

    let service: MockRelevanceService | OpenAiRelevanceService;

    try {
      const serviceConfig =
        focusProvider === 'openai'
          ? {
              ...openAiConfig,
              dangerouslyAllowBrowser: true,
              debugRecorder: recordFocusExchanges ? handleCaptureExchange : undefined
            }
          : openAiConfig;
      service = createFocusService(focusProvider, serviceConfig);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to configure focus service.';
      setFocusState({ status: 'error', message });
      return;
    }

    try {
      const response = await service.analyze({
        query,
        document: currentLayout,
        maxContextTokens: focusProvider === 'openai' ? 6000 : undefined
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

      if (focusProvider === 'openai' && recordFocusExchanges && focusExchangeRef.current) {
        const recording = createFocusRecording({
          provider: focusProvider,
          query,
          response,
          layout: currentLayout,
          exchange: focusExchangeRef.current
        });
        setFocusRecordings((prev) => [recording, ...prev]);
        setSelectedRecordingId(recording.id);
        focusExchangeRef.current = null;
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : focusProvider === 'openai'
            ? 'Unable to query OpenAI. Check your API key and model.'
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
    handleCaptureExchange,
    createFocusService,
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
    focusProvider !== 'openai' ||
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

  return (
    <div className="app-shell">
      {/* Semantic Search Bar - Only show when document is loaded */}
      {state.status === 'ready' && (
        <SemanticSearchBar
          isIndexed={isIndexed}
          isIndexing={isIndexing}
          indexingProgress={indexingProgress}
          onStartIndexing={startIndexing}
          onSearch={semanticSearchFn}
          onClearSearch={clearSemanticResults}
          searchResults={sortedSemanticResults}
          isSearching={isSearching}
          disabled={state.status !== 'ready'}
          activeResultIndex={activeSemanticResultIndex}
          onNavigateResult={handleNavigateSemanticResult}
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
          documentId={loadedFileName || 'document'}
          getCanvasRef={getCanvasRef}
          layoutJson={layoutJson}
          htmlFriendlyJson={htmlFriendlyJson}
          htmlPageLayouts={htmlPageLayouts}
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
          semanticSearchResults={sortedSemanticResults}
          activeSemanticResultIndex={activeSemanticResultIndex}
          geminiExtraction={geminiExtractionState.extraction}
          onTriggerGeminiExtraction={triggerGeminiExtraction}
          enableFormulaHighlight={enableFormulaHighlight}
          enableTableHighlight={enableTableHighlight}
          enableWebSearch={enableWebSearch}
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
          zoomIndicator={zoomIndicator}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
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
          canUseZoom={canUseZoom}
          geminiExtractionState={geminiExtractionState}
          onTriggerGeminiExtraction={triggerGeminiExtraction}
          enableFormulaHighlight={enableFormulaHighlight}
          setEnableFormulaHighlight={setEnableFormulaHighlight}
          enableTableHighlight={enableTableHighlight}
          setEnableTableHighlight={setEnableTableHighlight}
          enableWebSearch={enableWebSearch}
          setEnableWebSearch={setEnableWebSearch}
        />
      )}
    </div>
  );
}
