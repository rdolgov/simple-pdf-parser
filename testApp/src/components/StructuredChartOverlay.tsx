import { useEffect, useMemo, useRef } from 'react';
import type { StructuredSelection } from '../types';
import type { TableModel } from '@viewer/htmlStructuredDataRenderer';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

type StructuredChartOverlayProps = {
  selection: Extract<StructuredSelection, { kind: 'table' }>;
};

type ChartData = { labels: string[]; values: number[] };

export function StructuredChartOverlay({ selection }: StructuredChartOverlayProps): JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const chartData = useMemo<ChartData | null>(() => {
    if (!selection.table) {
      return null;
    }
    return buildChartData(selection.table);
  }, [selection.table]);

  useEffect(() => {
    if (!chartData || !canvasRef.current) {
      return;
    }
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) {
      return;
    }
    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: chartData.labels,
        datasets: [
          {
            label: selection.path ?? 'Table',
            data: chartData.values,
            backgroundColor: 'rgba(59, 130, 246, 0.65)'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label(context) {
                return `${context.formattedValue}`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { maxRotation: 45, minRotation: 0 },
            grid: { display: false }
          },
          y: {
            grid: { color: 'rgba(148, 163, 184, 0.35)' },
            ticks: { precision: 2 }
          }
        }
      }
    });
    return () => {
      chart.destroy();
    };
  }, [chartData, selection.path]);

  if (!chartData) {
    return <div className="structured-chart-placeholder">No chartable values</div>;
  }

  return (
    <div className="structured-chart">
      <canvas ref={canvasRef} />
    </div>
  );
}

function buildChartData(table: TableModel): ChartData | null {
  const rows = new Map<number, { [col: number]: string }>();
  for (const cell of table.cells) {
    if (!rows.has(cell.row)) {
      rows.set(cell.row, {});
    }
    rows.get(cell.row)![cell.col] = cell.text;
  }
  const sortedRows = Array.from(rows.entries()).sort((a, b) => a[0] - b[0]);
  if (sortedRows.length <= 1) {
    return null;
  }

  const labels: string[] = [];
  const values: number[] = [];
  for (let i = 1; i < sortedRows.length; i += 1) {
    const [, cols] = sortedRows[i];
    const label = cols[1]?.trim() ?? `Row ${i}`;
    const numeric = findFirstNumeric(cols);
    if (numeric === null) {
      continue;
    }
    labels.push(label);
    values.push(numeric);
  }

  if (labels.length === 0) {
    return null;
  }
  return { labels, values };
}

function findFirstNumeric(cols: { [col: number]: string }): number | null {
  const orderedCols = Object.keys(cols)
    .map((key) => Number(key))
    .sort((a, b) => a - b);
  for (const colIndex of orderedCols.slice(1)) {
    const value = parseNumeric(cols[colIndex]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function parseNumeric(raw: string | undefined): number | null {
  if (!raw) return null;
  let cleaned = raw.replace(/,/g, '').replace(/\s+/g, '');
  cleaned = cleaned.replace(/×10\^?/i, 'e').replace(/·/g, '').replace(/−/g, '-');
  cleaned = cleaned.replace(/[^\deE\.\-+]/g, '');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}
