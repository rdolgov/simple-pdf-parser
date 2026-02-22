import type { HtmlPageLayout, PDFDocument } from 'pdf-layout-parser';
import type {
  CanvasHighlightSelection,
  LoadState,
  ViewMode,
  FocusRenderState,
  FocusRecording,
  FocusProvider,
  StructuredDataState,
  StructuredSelection,
  ExtractedTable
} from '../types';
import type { TableModel } from '../viewer/htmlStructuredDataRenderer';
import type { SemanticSearchResult } from '../search';
import type { GeminiDocumentExtraction } from '../storage/geminiExtractionStorage';
import { CanvasPageWithOverlay } from './CanvasPageWithOverlay';
import { StructuredChartOverlay } from './StructuredChartOverlay';
import { StructuredExtractPlayground } from './StructuredExtractPlayground';
import { GeminiPlayground } from './GeminiPlayground';
import { LMStudioPlayground } from './LMStudioPlayground';
import { AIStudioViewer } from './AIStudioViewer';


interface ViewerColumnProps {
  viewMode: ViewMode;
  state: LoadState;
  readyDocument: PDFDocument | null;
  documentId: string;
  getCanvasRef: (pageNumber: number) => (element: HTMLCanvasElement | null) => void;
  layoutJson: string;
  htmlFriendlyJson: string;
  htmlPageLayouts: Map<number, HtmlPageLayout>;
  canvasHighlight: CanvasHighlightSelection | null;
  onCanvasHighlight: (selection: CanvasHighlightSelection | null) => void;
  focusState: FocusRenderState;
  focusHighlightCount: number;
  hiddenPdfPageCount: number;
  htmlContainerRef: React.RefObject<HTMLDivElement>;
  focusRecordings: FocusRecording[];
  selectedRecording: FocusRecording | null;
  onClearRecordings: () => void;
  formatRecordingTimestamp: (value?: string) => string;
  formatJsonOutput: (value: unknown) => string;
  pagesWithMatches: Set<number>;
  zoom: number;
  focusProvider: FocusProvider;
  extractedTables: ExtractedTable[];
  structuredState: StructuredDataState;
  structuredContainerRef: React.RefObject<HTMLDivElement>;
  structuredSelection: StructuredSelection | null;
  onClearStructuredSelection: () => void;
  semanticSearchResults: SemanticSearchResult[];
  activeSemanticResultIndex: number;
  geminiExtraction: GeminiDocumentExtraction | null;
  onTriggerGeminiExtraction: () => Promise<void>;
  enableFormulaHighlight: boolean;
  enableTableHighlight: boolean;
  enableWebSearch: boolean;
}

export function ViewerColumn({
  viewMode,
  state,
  readyDocument,
  documentId,
  getCanvasRef,
  layoutJson,
  htmlFriendlyJson,
  htmlPageLayouts,
  canvasHighlight,
  onCanvasHighlight,
  focusState,
  focusHighlightCount,
  hiddenPdfPageCount,
  htmlContainerRef,
  focusRecordings,
  selectedRecording,
  onClearRecordings,
  formatRecordingTimestamp,
  formatJsonOutput,
  pagesWithMatches,
  zoom,
  focusProvider,
  extractedTables,
  structuredState,
  structuredContainerRef,
  structuredSelection,
  onClearStructuredSelection,
  semanticSearchResults,
  activeSemanticResultIndex,
  geminiExtraction,
  onTriggerGeminiExtraction,
  enableFormulaHighlight,
  enableTableHighlight,
  enableWebSearch
}: ViewerColumnProps): JSX.Element {
  return (
    <div className="viewer-column">
      <div className="viewer-inner">
        <section className="viewer-pane">
          {viewMode === 'canvas' || viewMode === 'focus-pdf' ? (
            <div className="canvas-wrapper">
              {readyDocument ? (
                readyDocument.pages
                  .filter((page) => viewMode === 'canvas' || (viewMode === 'focus-pdf' && (focusState.status !== 'ready' || pagesWithMatches.has(page.number))))
                  .map((page) => (
                    <CanvasPageWithOverlay
                      key={page.number}
                      page={page}
                      pageNumber={page.number}
                      documentId={documentId}
                      documentTitle={geminiExtraction?.document_title}
                      getCanvasRef={getCanvasRef}
                      zoom={zoom}
                      htmlPage={htmlPageLayouts.get(page.number) ?? null}
                      canvasHighlight={canvasHighlight}
                      onCanvasHighlight={onCanvasHighlight}
                      focusMode={viewMode === 'focus-pdf' && focusState.status === 'ready'}
                      focusLayout={focusState.status === 'ready' ? focusState.layout : null}
                      focusProvider={focusProvider}
                      extractedTables={extractedTables}
                      semanticSearchResults={semanticSearchResults.filter((r) => r.chunk.pageNumber === page.number)}
                      activeSemanticResultId={semanticSearchResults[activeSemanticResultIndex]?.chunk.id}
                      geminiExtraction={geminiExtraction}
                      enableFormulaHighlight={enableFormulaHighlight}
                      enableTableHighlight={enableTableHighlight}
                      enableWebSearch={enableWebSearch}
                    />
                  ))
              ) : (
                <div className="canvas-placeholder">No document loaded</div>
              )}
            </div>
          ) : viewMode === 'layout-json' || viewMode === 'html-json' ? (
            <pre className="json-view">{state.status !== 'ready' ? 'No data' : viewMode === 'layout-json' ? layoutJson : htmlFriendlyJson}</pre>
          ) : viewMode === 'focus-render' ? (
            <div className="html-render-wrapper focus-mode" data-focus-layout="flow">
              {focusState.status === 'ready' ? (
                <div className="focus-layout">
                  <div className="focus-main-shell">
                    <div className="focus-toolbar">
                      <div className="focus-toolbar-metric">
                        {focusHighlightCount > 0
                          ? `${focusHighlightCount} highlighted section${focusHighlightCount === 1 ? '' : 's'}`
                          : 'No highlighted sections'}
                      </div>
                    </div>
                    <div ref={htmlContainerRef} className="html-render-surface focus-main" />
                  </div>
                </div>
              ) : focusState.status === 'loading' ? (
                <div className="focus-placeholder">Analyzing document…</div>
              ) : focusState.status === 'empty' ? (
                <div className="focus-placeholder">
                  <p>No sections matched "{focusState.query}".</p>
                  <p>Try broadening your keywords.</p>
                </div>
              ) : focusState.status === 'error' ? (
                <div className="focus-placeholder error">{focusState.message}</div>
              ) : (
                <div className="focus-placeholder">Enter a query to highlight relevant sections.</div>
              )}
            </div>
          ) : viewMode === 'focus-debug' ? (
            <div className="focus-debug-panel">
              {focusRecordings.length === 0 ? (
                <div className="focus-placeholder">No recordings yet.</div>
              ) : !selectedRecording ? (
                <div className="focus-placeholder">Select a recording to inspect.</div>
              ) : (
                <>
                  <div className="focus-debug-meta">
                    <div>
                      <strong>Query:</strong> {selectedRecording.query}
                    </div>
                    <div>
                      <strong>Captured:</strong> {formatRecordingTimestamp(selectedRecording.createdAt)}
                    </div>
                    <div>
                      <strong>Model:</strong> {selectedRecording.responseModel ?? 'unknown'}
                    </div>
                    <button type="button" onClick={onClearRecordings}>
                      Clear recordings
                    </button>
                  </div>
                  <div className="focus-debug-json">
                    <div>
                      <h4>Request Payload</h4>
                      <pre>
                        {formatJsonOutput({
                          prompt: selectedRecording.prompt,
                          payload: selectedRecording.requestPayload ?? '[not captured]'
                        })}
                      </pre>
                    </div>
                    <div>
                      <h4>Response Payload</h4>
                      <pre>{formatJsonOutput(selectedRecording.responsePayload)}</pre>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : viewMode === 'gemini' ? (
            <GeminiPlayground />
          ) : viewMode === 'lmstudio' ? (
            <LMStudioPlayground />
          ) : viewMode === 'structured-extract' ? (
            <StructuredExtractPlayground />
          ) : viewMode === 'ai-studio' ? (
            <AIStudioViewer />
          ) : viewMode === 'structured-data' ? (
            <div className="structured-render-wrapper">
              {structuredState.status === 'ready' ? (
                <div className="structured-render-shell">
                  <div ref={structuredContainerRef} className="structured-surface" />
                  {structuredSelection && (
                    <div className="structured-overlay-layer" aria-hidden="true">
                      {(() => {
                        const padding = 32;
                        const isTable = structuredSelection.kind === 'table';
                        const width =
                          structuredSelection.rect.width + padding * 2 < 520 && isTable
                            ? 520
                            : structuredSelection.rect.width + padding * 2;
                        const height =
                          structuredSelection.rect.height + padding * 2 < 420 && isTable
                            ? 420
                            : structuredSelection.rect.height + padding * 2;
                        const left = structuredSelection.rect.left - padding;
                        const top = structuredSelection.rect.top - padding;
                        return (
                          <div
                            className={`canvas-overlay-highlight-block${
                              structuredSelection.kind === 'table' ? ' structured-overlay-highlight--chart' : ''
                            }`}
                            style={{
                              left: `${left}px`,
                              top: `${top}px`,
                              width: `${width}px`,
                              height: `${height}px`
                            }}
                          >
                            <div className="canvas-overlay-highlight-toolbar" role="toolbar" aria-label="Structured actions">
                              <button type="button" className="canvas-overlay-toolbar-button" onClick={onClearStructuredSelection}>
                                <span className="canvas-overlay-toolbar-icon" aria-hidden="true">
                                  ×
                                </span>
                              </button>
                              <button type="button" className="canvas-overlay-toolbar-button">
                                <span className="canvas-overlay-toolbar-icon" aria-hidden="true">
                                  ?
                                </span>
                              </button>
                            </div>
                            <div className="canvas-overlay-highlight-inner">
                              {structuredSelection.kind === 'table' && structuredSelection.table ? (
                                <div className="structured-overlay-chart-shell">
                                  <StructuredChartOverlay selection={structuredSelection} />
                                </div>
                              ) : (
                                <div className="canvas-overlay-highlight-flow structured-overlay-text" style={{ height: '100%' }}>
                                  {structuredSelection.chapterBlocks && structuredSelection.chapterBlocks.length > 0 ? (
                                    structuredSelection.chapterBlocks.map((block, index) => (
                                      <div
                                        key={index}
                                        className={
                                          block.type === 'heading'
                                            ? 'structured-overlay-heading'
                                            : 'structured-overlay-paragraph'
                                        }
                                      >
                                        {block.text}
                                      </div>
                                    ))
                                  ) : (
                                    structuredSelection.text ?? structuredSelection.path ?? 'Selected block'
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              ) : structuredState.status === 'loading' || structuredState.status === 'idle' ? (
                <div className="structured-placeholder">Loading structured data…</div>
              ) : structuredState.status === 'error' ? (
                <div className="structured-placeholder error">{structuredState.message}</div>
              ) : (
                <div className="structured-placeholder">Structured data viewer unavailable.</div>
              )}
            </div>
          ) : (
            <div className="html-render-wrapper">
              <div ref={htmlContainerRef} className="html-render-surface" />
            </div>
          )}
        </section>

        {state.status === 'error' && <div className="error-banner">{state.message}</div>}
      </div>
    </div>
  );
}
