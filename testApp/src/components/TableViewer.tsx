import type { ExtractedTable, FocusProvider } from '../types';
export type TableSortState = { column: number; direction: 'asc' | 'desc' } | null;
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import type { ChartConfiguration } from 'chart.js';
import { generateAiChartFromTable } from '../utils/aiChartGenerator';
import { OverlayToolbar, OverlayToolbarButton } from './OverlayToolbar';
import { generateTableCacheKey, getCachedAiChart, setCachedAiChart } from '../storage/aiChartCache';

type ViewMode = 'table' | 'chart' | 'ai-chart';

type AiChartState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; config: ChartConfiguration; note?: string; source: 'ai' | 'mock' };

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
  const sortedBody = [...body].sort((a, b) => {
    const left = a[sortState.column]?.text ?? '';
    const right = b[sortState.column]?.text ?? '';
    return left.localeCompare(right) * direction;
  });
  return [header, ...sortedBody];
}

type TableViewerProps = {
  table: ExtractedTable;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  pageHeight: number;
  scaleX: number;
  scaleY: number;
  sortState: TableSortState;
  onSortChange: (tableId: string, next: TableSortState) => void;
  ensureGeminiApiKey: () => string | null;
  focusProvider: FocusProvider;
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
  ensureGeminiApiKey,
  focusProvider,
  onClose
}: TableViewerProps): JSX.Element {
  const [localSort, setLocalSort] = useState<TableSortState>(sortState);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [aiChartState, setAiChartState] = useState<AiChartState>({ status: 'idle' });
  const chartCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstanceRef = useRef<Chart | null>(null);

  useEffect(() => {
    setLocalSort(sortState);
  }, [sortState]);

  useEffect(() => {
    setViewMode('table');
    setAiChartState({ status: 'idle' });
    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }
  }, [table.id]);

  // Account for canvas padding (16px matches DEFAULT_OPTIONS.pagePadding in canvasRenderer)
  const canvasPadding = 16 * scaleX; // scaleX = zoom
  const left = bounds.minX * scaleX + canvasPadding - 12;
  const top = (pageHeight - bounds.maxY) * scaleY + canvasPadding - 12;
  const width = (bounds.maxX - bounds.minX) * scaleX + 24;
  const height = (bounds.maxY - bounds.minY) * scaleY + 24;

  const rows: Array<Array<{ text: string; kind: 'td' | 'th' }>> = [];
  if (table.cells && table.cells.length > 0) {
    const maxRow = Math.max(...table.cells.map((cell) => cell.row), 0);
    const maxCol = Math.max(...table.cells.map((cell) => cell.col), 0);
    for (let rowIndex = 1; rowIndex <= maxRow; rowIndex += 1) {
      const row: Array<{ text: string; kind: 'td' | 'th' }> = [];
      for (let colIndex = 1; colIndex <= maxCol; colIndex += 1) {
        const cell = table.cells.find((candidate) => candidate.row === rowIndex && candidate.col === colIndex);
        row.push({
          text: cell?.text ?? '',
          kind: rowIndex === 1 ? 'th' : 'td'
        });
      }
      rows.push(row);
    }
  }

  const sortedRows = sortTableRows(rows, localSort);

  const headers = sortedRows[0] ?? [];
  const chartColumns =
    sortedRows.length > 1
      ? headers.map((headerCell, columnIndex) => {
          const columnLabel = headerCell?.text || `Column ${columnIndex + 1}`;
          const numericValues = sortedRows
            .slice(1)
            .map((row) => Number.parseFloat(row[columnIndex]?.text ?? ''))
            .filter((value) => !Number.isNaN(value));
          const nonEmptyCount = sortedRows
            .slice(1)
            .filter((row) => (row[columnIndex]?.text ?? '').trim().length > 0).length;
          const value =
            numericValues.length > 0
              ? numericValues.reduce((sum, current) => sum + current, 0)
              : nonEmptyCount;
          return { label: columnLabel, value };
        })
      : [];
  const localChartConfig = useMemo<ChartConfiguration | null>(
    () => {
      if (chartColumns.length === 0) {
        return null;
      }
      return {
        type: 'bar',
        data: {
          labels: chartColumns.map((point) => point.label),
          datasets: [
            {
              label: 'Column totals',
              data: chartColumns.map((point) => point.value),
              backgroundColor: 'rgba(37, 99, 235, 0.6)',
              borderColor: 'rgba(37, 99, 235, 0.9)',
              borderWidth: 1
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true
            }
          },
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.parsed.y ?? 0}`
              }
            }
          }
        }
      };
    },
    [chartColumns]
  );

  const handleSort = (column: number) => {
    const next = toggleSortState(localSort, column);
    console.debug('Table sort change', { tableId: table.id, column, next });
    onSortChange(table.id, next);
    setLocalSort(next);
  };

  const requestAiChart = useCallback(async () => {
    if (aiChartState.status === 'loading' || aiChartState.status === 'ready') {
      return;
    }

    if (focusProvider === 'mock') {
      setAiChartState({ status: 'loading' });
      window.setTimeout(() => {
        if (localChartConfig) {
          setAiChartState({ status: 'ready', config: localChartConfig, note: 'Mock chart preview', source: 'mock' });
        } else {
          setAiChartState({ status: 'error', message: 'No data available to visualize.' });
        }
      }, 800);
      return;
    }

    const apiKey = ensureGeminiApiKey();
    if (!apiKey) {
      setAiChartState({ status: 'error', message: 'Gemini API key is required to build an AI chart.' });
      return;
    }

    setAiChartState({ status: 'loading' });

    // Generate cache key from table data
    const cacheKey = generateTableCacheKey(table.id, table.cells ?? []);

    // Check cache first
    try {
      const cached = await getCachedAiChart(cacheKey);
      if (cached) {
        console.debug('[TableViewer] Using cached AI chart');
        setAiChartState({ status: 'ready', config: cached.config, note: cached.note, source: 'ai' });
        return;
      }
    } catch (err) {
      console.debug('[TableViewer] Cache check failed:', err);
    }

    // Not in cache, request from API
    try {
      const result = await generateAiChartFromTable({ table, apiKey });
      const note = result.text && result.text.length < 240 ? result.text : undefined;
      setAiChartState({ status: 'ready', config: result.config, note, source: 'ai' });

      // Save to cache
      try {
        await setCachedAiChart(cacheKey, result.config, note);
        console.debug('[TableViewer] Cached AI chart result');
      } catch (cacheErr) {
        console.debug('[TableViewer] Failed to cache result:', cacheErr);
      }
    } catch (error) {
      setAiChartState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to generate AI chart'
      });
    }
  }, [aiChartState.status, focusProvider, ensureGeminiApiKey, table, localChartConfig]);

  useEffect(() => {
    if (viewMode === 'ai-chart') {
      void requestAiChart();
    }
  }, [viewMode, requestAiChart]);

  const aiChartConfig = aiChartState.status === 'ready' ? aiChartState.config : null;

  useEffect(() => {
    if (viewMode !== 'chart' && viewMode !== 'ai-chart') {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
      return;
    }

    const selectedConfig = viewMode === 'chart' ? localChartConfig : aiChartConfig;
    if (!selectedConfig) {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
      return;
    }

    const canvas = chartCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) {
      return;
    }
    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
    }

    chartInstanceRef.current = new Chart(ctx, selectedConfig);

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [viewMode, localChartConfig, aiChartConfig]);

  return (
    <div
      className="canvas-overlay-highlight-block canvas-overlay-table-block"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        minWidth: `${width}px`,
        minHeight: `${height}px`
      }}
    >
      <OverlayToolbar onClose={onClose}>
        <OverlayToolbarButton
          onClick={() => setViewMode('table')}
          icon={<TableIcon />}
          label="Table view"
          variant={viewMode === 'table' ? 'primary' : 'default'}
        />
        <OverlayToolbarButton
          onClick={() => setViewMode('chart')}
          icon={<ChartIcon />}
          label="Chart view"
          variant={viewMode === 'chart' ? 'primary' : 'default'}
        />
        <OverlayToolbarButton
          onClick={() => setViewMode('ai-chart')}
          icon={<AIChartIcon />}
          label="AI Chart view"
          variant={viewMode === 'ai-chart' ? 'primary' : 'default'}
        />
        <span className="overlay-toolbar-divider" />
      </OverlayToolbar>
      <div className="canvas-overlay-highlight-inner">
        <div className="canvas-overlay-table-content">
            {viewMode === 'table' && (
              <>
                {rows.length === 0 ? (
                  <div className="canvas-overlay-table-placeholder">Table detected (no cell data available).</div>
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
            {viewMode === 'chart' && (
              <>
                {chartColumns.length === 0 ? (
                  <div className="canvas-overlay-table-placeholder">
                    No columns available to visualize. Sorting still available in table view.
                  </div>
                ) : (
                  <div className="table-chart-view table-chart-view--chartjs" role="img" aria-label="Table data as bar chart">
                    <canvas ref={chartCanvasRef} />
                  </div>
                )}
              </>
            )}
            {viewMode === 'ai-chart' && (
              <div className="table-chart-view table-chart-view--chartjs" role="img" aria-label="AI generated chart">
                {aiChartState.status === 'idle' && (
                  <div className="canvas-overlay-table-placeholder">
                    Click "AI Chart" to request a Gemini-generated chart.
                  </div>
                )}
                {aiChartState.status === 'loading' && (
                  <div className="canvas-overlay-table-placeholder">Generating chart with Gemini…</div>
                )}
                {aiChartState.status === 'error' && (
                  <div className="canvas-overlay-table-placeholder">
                    <div style={{ marginBottom: 8 }}>{aiChartState.message}</div>
                    <button
                      type="button"
                      className="table-sort-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        requestAiChart();
                      }}
                    >
                      Retry
                    </button>
                  </div>
                )}
                {aiChartState.status === 'ready' && (
                  <>
                    <canvas ref={chartCanvasRef} />
                    {aiChartState.note && <div className="table-chart-note">{aiChartState.note}</div>}
                  </>
                )}
              </div>
            )}
        </div>
      </div>
    </div>
  );
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

function ChartIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
      <rect x="2" y="9" width="3" height="6" rx="0.5" fill="currentColor" />
      <rect x="7" y="5" width="3" height="10" rx="0.5" fill="currentColor" />
      <rect x="12" y="2" width="3" height="13" rx="0.5" fill="currentColor" />
    </svg>
  );
}

function AIChartIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
      <rect x="2" y="10" width="2.5" height="5" rx="0.5" fill="currentColor" />
      <rect x="6" y="6" width="2.5" height="9" rx="0.5" fill="currentColor" />
      <rect x="10" y="3" width="2.5" height="12" rx="0.5" fill="currentColor" />
      <circle cx="14.5" cy="4.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M13.5 4.5l1 1 1.5-2" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
