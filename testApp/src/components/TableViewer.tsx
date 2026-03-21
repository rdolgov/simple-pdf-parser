import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { ExtractedTable } from '../types';
import {
  deleteCachedTableVisualization,
  generateTableVisualizationCacheKey,
  getCachedChartImage,
  setCachedChartImage
} from '../storage/tableVisualizationCache';
import { generateAiTableChartImage } from '../utils/aiTableVisualization';
import { getProviderDisplayName, type ImageCapableProvider } from '../utils/providerMetadata';
import { OverlayToolbar, OverlayToolbarButton } from './OverlayToolbar';

export type TableSortState = { column: number; direction: 'asc' | 'desc' } | null;

type ViewMode = 'table' | 'chart-image';

type ChartImageState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; dataUri: string; mimeType?: string; prompt?: string; model: string };

type TableViewerProps = {
  table: ExtractedTable;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  pageHeight: number;
  scaleX: number;
  scaleY: number;
  sortState: TableSortState;
  onSortChange: (tableId: string, next: TableSortState) => void;
  imageProvider: ImageCapableProvider;
  imageModel?: string;
  imageApiKey: string;
  onClose: () => void;
};

export function TableViewer({
  table,
  bounds,
  pageHeight,
  scaleX,
  scaleY,
  sortState,
  onSortChange,
  imageProvider,
  imageModel,
  imageApiKey,
  onClose
}: TableViewerProps): JSX.Element {
  const [localSort, setLocalSort] = useState<TableSortState>(sortState);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [chartImageState, setChartImageState] = useState<ChartImageState>({ status: 'idle' });
  const [dragPosition, setDragPosition] = useState<{ top: number; left: number } | null>(null);
  const [panelSize, setPanelSize] = useState<{ width: number; height: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const isResizingRef = useRef(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; elemX: number; elemY: number } | null>(null);
  const resizeStartRef = useRef<{ mouseX: number; mouseY: number; width: number; height: number } | null>(null);

  useEffect(() => {
    setLocalSort(sortState);
  }, [sortState]);

  useEffect(() => {
    setViewMode('table');
    setChartImageState({ status: 'idle' });
    setDragPosition(null);
    setPanelSize(null);
  }, [table.id, bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, scaleX, scaleY, pageHeight]);

  const canvasPadding = 16 * scaleX;
  const initialLeft = bounds.minX * scaleX + canvasPadding - 12;
  const initialTop = (pageHeight - bounds.maxY) * scaleY + canvasPadding - 12;
  const initialWidth = Math.max((bounds.maxX - bounds.minX) * scaleX + 24, 320);
  const initialHeight = Math.max((bounds.maxY - bounds.minY) * scaleY + 24, 220);
  const currentPosition = dragPosition ?? { top: initialTop, left: initialLeft };
  const currentSize = panelSize ?? { width: initialWidth, height: initialHeight };

  const rows = useMemo<Array<Array<{ text: string; kind: 'td' | 'th' }>>>(() => {
    if (!table.cells || table.cells.length === 0) {
      return [];
    }
    const maxRow = Math.max(...table.cells.map((cell) => cell.row), 0);
    const maxCol = Math.max(...table.cells.map((cell) => cell.col), 0);
    const nextRows: Array<Array<{ text: string; kind: 'td' | 'th' }>> = [];
    for (let rowIndex = 1; rowIndex <= maxRow; rowIndex += 1) {
      const row: Array<{ text: string; kind: 'td' | 'th' }> = [];
      for (let colIndex = 1; colIndex <= maxCol; colIndex += 1) {
        const cell = table.cells.find((candidate) => candidate.row === rowIndex && candidate.col === colIndex);
        row.push({
          text: cell?.text ?? '',
          kind: rowIndex === 1 ? 'th' : 'td'
        });
      }
      nextRows.push(row);
    }
    return nextRows;
  }, [table.cells]);

  const sortedRows = useMemo(() => sortTableRows(rows, localSort), [rows, localSort]);
  const hasChartableData = rows.length >= 2 && rows.some((row, rowIndex) => rowIndex > 0 && row.some((cell) => cell.text.trim().length > 0));

  const handleSort = (column: number) => {
    const next = toggleSortState(localSort, column);
    onSortChange(table.id, next);
    setLocalSort(next);
  };

  const chartImageCacheKey = useMemo(
    () =>
      generateTableVisualizationCacheKey({
        tableId: table.id,
        provider: imageProvider,
        model: imageModel,
        variant: 'chart-image',
        cells: table.cells ?? []
      }),
    [imageModel, imageProvider, table.cells, table.id]
  );

  const requestChartImage = useCallback(async (forceRefresh = false) => {
    if (chartImageState.status === 'loading') {
      return;
    }
    if (!hasChartableData) {
      setChartImageState({ status: 'error', message: 'Not enough table data to generate an infographic.' });
      return;
    }
    if (!imageApiKey.trim()) {
      setChartImageState({
        status: 'error',
        message: `${getProviderDisplayName(imageProvider)} access is required to generate an infographic.`
      });
      return;
    }

    setChartImageState({ status: 'loading' });

    try {
      if (forceRefresh) {
        await deleteCachedTableVisualization(chartImageCacheKey);
      } else {
        const cached = await getCachedChartImage(chartImageCacheKey);
        if (cached) {
          setChartImageState({
            status: 'ready',
            dataUri: cached.dataUri,
            mimeType: cached.mimeType,
            prompt: cached.prompt,
            model: imageModel?.trim() || 'default-model'
          });
          return;
        }
      }

      const result = await generateAiTableChartImage({
        table,
        provider: imageProvider,
        apiKey: imageApiKey,
        ...(imageModel?.trim() ? { model: imageModel.trim() } : {})
      });
      setChartImageState({
        status: 'ready',
        dataUri: result.dataUri,
        mimeType: result.mimeType,
        prompt: result.prompt,
        model: result.model
      });
      await setCachedChartImage(chartImageCacheKey, {
        dataUri: result.dataUri,
        mimeType: result.mimeType,
        prompt: result.prompt
      });
    } catch (error) {
      await deleteCachedTableVisualization(chartImageCacheKey);
      setChartImageState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to generate infographic.'
      });
    }
  }, [chartImageCacheKey, chartImageState.status, hasChartableData, imageApiKey, imageModel, imageProvider, table]);

  useEffect(() => {
    if (viewMode === 'chart-image' && chartImageState.status === 'idle') {
      void requestChartImage();
    }
  }, [chartImageState.status, requestChartImage, viewMode]);

  const handlePointerStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const parentRect = getOverlayParentRect(container);

    if (target.closest('.table-viewer-resize-handle')) {
      event.preventDefault();
      isResizingRef.current = true;
      resizeStartRef.current = {
        mouseX: event.clientX,
        mouseY: event.clientY,
        width: container.offsetWidth,
        height: container.offsetHeight
      };
      dragStartRef.current = {
        mouseX: 0,
        mouseY: 0,
        elemX: container.offsetLeft,
        elemY: container.offsetTop
      };
      return;
    }

    if (!target.closest('.table-viewer-drag-handle')) {
      return;
    }

    event.preventDefault();
    isDraggingRef.current = true;
    dragStartRef.current = {
      mouseX: event.clientX,
      mouseY: event.clientY,
      elemX: clamp(container.offsetLeft, 0, Math.max(0, parentRect.width - container.offsetWidth)),
      elemY: clamp(container.offsetTop, 0, Math.max(0, parentRect.height - container.offsetHeight))
    };
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const parentRect = getOverlayParentRect(container);

      if (isResizingRef.current && resizeStartRef.current && dragStartRef.current) {
        const nextWidth = resizeStartRef.current.width + (event.clientX - resizeStartRef.current.mouseX);
        const nextHeight = resizeStartRef.current.height + (event.clientY - resizeStartRef.current.mouseY);
        const maxWidth = Math.max(320, parentRect.width - dragStartRef.current.elemX);
        const maxHeight = Math.max(220, parentRect.height - dragStartRef.current.elemY);
        setPanelSize({
          width: clamp(nextWidth, 320, maxWidth),
          height: clamp(nextHeight, 220, maxHeight)
        });
        return;
      }

      if (!isDraggingRef.current || !dragStartRef.current) {
        return;
      }

      const deltaX = event.clientX - dragStartRef.current.mouseX;
      const deltaY = event.clientY - dragStartRef.current.mouseY;
      const maxLeft = Math.max(0, parentRect.width - container.offsetWidth);
      const maxTop = Math.max(0, parentRect.height - container.offsetHeight);
      setDragPosition({
        left: clamp(dragStartRef.current.elemX + deltaX, 0, maxLeft),
        top: clamp(dragStartRef.current.elemY + deltaY, 0, maxTop)
      });
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      isResizingRef.current = false;
      dragStartRef.current = null;
      resizeStartRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="canvas-overlay-highlight-block canvas-overlay-table-block"
      style={{
        left: `${currentPosition.left}px`,
        top: `${currentPosition.top}px`,
        width: `${currentSize.width}px`,
        height: `${currentSize.height}px`
      }}
      onMouseDown={handlePointerStart}
    >
      <div className="table-viewer-drag-handle" aria-hidden="true">
        <DragHandleIcon />
      </div>
      <OverlayToolbar onClose={onClose}>
        <OverlayToolbarButton
          onClick={() => setViewMode('table')}
          icon={<TableIcon />}
          label="Table view"
          variant={viewMode === 'table' ? 'primary' : 'default'}
        />
        <OverlayToolbarButton
          onClick={() => {
            setViewMode('chart-image');
            if (chartImageState.status === 'error') {
              void requestChartImage(true);
            }
          }}
          icon={<ImageChartIcon />}
          label="Infographic"
          title={`Generate an infographic-style chart image with ${getProviderDisplayName(imageProvider)}`}
          variant={viewMode === 'chart-image' ? 'primary' : 'default'}
        />
        <span className="overlay-toolbar-divider" />
      </OverlayToolbar>
      <div className="canvas-overlay-highlight-inner">
        <div className="canvas-overlay-table-content">
          {viewMode === 'table' && (
            <>
              {rows.length === 0 ? (
                <div className="canvas-overlay-table-placeholder">Table detected, but no cell data is available.</div>
              ) : (
                <table className="canvas-overlay-table">
                  <tbody>
                    {sortedRows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, colIndex) => {
                          const CellTag = cell.kind === 'th' ? 'th' : 'td';
                          const isHeader = cell.kind === 'th';
                          const isSorted = isHeader && localSort?.column === colIndex;
                          const indicator = isHeader
                            ? isSorted
                              ? localSort?.direction === 'asc'
                                ? '▲'
                                : '▼'
                              : '⇅'
                            : null;
                          return (
                            <CellTag
                              key={`${rowIndex}-${colIndex}`}
                              className={isHeader ? 'table-sortable-header' : undefined}
                            >
                              {isHeader ? (
                                <button
                                  type="button"
                                  className="table-sort-button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleSort(colIndex);
                                  }}
                                  aria-label={`Sort by column ${colIndex + 1}`}
                                >
                                  <span className="table-sort-label">{cell.text || '\u00A0'}</span>
                                  {indicator && (
                                    <span
                                      className={`table-sort-indicator${isSorted ? '' : ' table-sort-indicator--off'}`}
                                    >
                                      {indicator}
                                    </span>
                                  )}
                                </button>
                              ) : (
                                cell.text || '\u00A0'
                              )}
                            </CellTag>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
          {viewMode === 'chart-image' && (
            <div className="table-chart-view table-chart-view--image" role="img" aria-label="AI generated infographic chart image">
              {!hasChartableData && (
                <div className="canvas-overlay-table-placeholder">Not enough numeric table structure to chart.</div>
              )}
              {hasChartableData && chartImageState.status === 'loading' && (
                <div className="canvas-overlay-table-placeholder">
                  Generating infographic with {getProviderDisplayName(imageProvider)}…
                </div>
              )}
              {hasChartableData && chartImageState.status === 'error' && (
                <div className="canvas-overlay-table-placeholder">
                  <div style={{ marginBottom: 8 }}>{chartImageState.message}</div>
                  <div className="table-chart-actions table-chart-actions--centered">
                    <button
                      type="button"
                      className="table-chart-regenerate-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void requestChartImage(true);
                      }}
                    >
                      Regenerate image
                    </button>
                  </div>
                </div>
              )}
              {hasChartableData && chartImageState.status === 'ready' && (
                <>
                  <div className="table-chart-actions">
                    <button
                      type="button"
                      className="table-chart-regenerate-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void requestChartImage(true);
                      }}
                    >
                      Regenerate image
                    </button>
                  </div>
                  <div className="table-chart-image-frame">
                    <img className="table-chart-image" src={chartImageState.dataUri} alt="AI generated infographic chart" />
                  </div>
                  {chartImageState.prompt && <div className="table-chart-note">{chartImageState.prompt}</div>}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="table-viewer-resize-handle" aria-hidden="true">
        <ResizeHandleIcon />
      </div>
    </div>
  );
}

function getOverlayParentRect(element: HTMLElement): { width: number; height: number } {
  const parent = element.offsetParent;
  if (parent instanceof HTMLElement) {
    return {
      width: parent.clientWidth,
      height: parent.clientHeight
    };
  }
  return {
    width: window.innerWidth,
    height: window.innerHeight
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max <= min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function toggleSortState(current: TableSortState, column: number): TableSortState {
  if (!current || current.column !== column) {
    return { column, direction: 'asc' };
  }
  return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}

function sortTableRows(
  rows: Array<Array<{ text: string; kind: 'td' | 'th' }>>,
  sortState: TableSortState
): Array<Array<{ text: string; kind: 'td' | 'th' }>> {
  if (!sortState || rows.length === 0) {
    return rows;
  }
  const header = rows[0];
  const body = rows.slice(1);
  const direction = sortState.direction === 'asc' ? 1 : -1;
  const sortedBody = [...body].sort((leftRow, rightRow) => {
    const left = leftRow[sortState.column]?.text ?? '';
    const right = rightRow[sortState.column]?.text ?? '';
    return left.localeCompare(right) * direction;
  });
  return [header, ...sortedBody];
}

function TableIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
      <rect x="2" y="3" width="14" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <line x1="2" y1="7" x2="16" y2="7" stroke="currentColor" strokeWidth="1.3" />
      <line x1="2" y1="11" x2="16" y2="11" stroke="currentColor" strokeWidth="1.3" />
      <line x1="7" y1="3" x2="7" y2="15" stroke="currentColor" strokeWidth="1.3" />
      <line x1="11" y1="3" x2="11" y2="15" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function ImageChartIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
      <rect x="2" y="3" width="14" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4 12l2.8-2.7 2.3 2.1 2.2-3.2 2.7 3.8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6.2" cy="6.4" r="1.2" fill="currentColor" />
    </svg>
  );
}

function DragHandleIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 6" width="16" height="6" aria-hidden="true">
      <circle cx="4" cy="1.5" r="1.2" fill="currentColor" />
      <circle cx="8" cy="1.5" r="1.2" fill="currentColor" />
      <circle cx="12" cy="1.5" r="1.2" fill="currentColor" />
      <circle cx="4" cy="4.5" r="1.2" fill="currentColor" />
      <circle cx="8" cy="4.5" r="1.2" fill="currentColor" />
      <circle cx="12" cy="4.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

function ResizeHandleIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M5 11l6-6M8 12l4-4M11 13l2-2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
