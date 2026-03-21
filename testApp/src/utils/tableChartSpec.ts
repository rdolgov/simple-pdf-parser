import type { ChartConfiguration } from 'chart.js';
import type { ExtractedTable } from '../types';
import { extractJsonObjectCandidate } from './jsonObjectCandidate';
import { parseRelaxedJson } from './relaxedJson';

export interface AiTableChartSpec {
  title?: string;
  note?: string;
  chart: {
    type?: string;
    labels?: unknown[];
    series?: Array<{
      label?: unknown;
      values?: unknown[];
    }>;
    datasets?: Array<{
      label?: string;
      data?: unknown[];
      backgroundColor?: string | string[];
      borderColor?: string | string[];
      fill?: boolean;
    }>;
  };
}

const ALLOWED_CHART_TYPES = new Set(['bar', 'line', 'pie', 'doughnut']);
const CHART_PALETTE = ['#2563eb', '#f97316', '#16a34a', '#9333ea', '#dc2626', '#0891b2'] as const;

export function tableToRows(table: ExtractedTable): string[][] {
  if (table.cells && table.cells.length > 0) {
    const maxRow = Math.max(...table.cells.map((cell) => cell.row), 0);
    const maxCol = Math.max(...table.cells.map((cell) => cell.col), 0);
    const rows: string[][] = [];
    for (let rowIndex = 1; rowIndex <= maxRow; rowIndex += 1) {
      const row: string[] = [];
      for (let colIndex = 1; colIndex <= maxCol; colIndex += 1) {
        const cell = table.cells.find((candidate) => candidate.row === rowIndex && candidate.col === colIndex);
        row.push(cell?.text ?? '');
      }
      rows.push(row);
    }
    return rows;
  }

  if (table.headers && table.headers.length > 0) {
    return [table.headers];
  }

  return [];
}

export function rowsToCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n');
}

export function buildAiInteractiveChartPrompt(rows: string[][]): string {
  const csv = rowsToCsv(rows.slice(0, 40));
  return [
    'You are designing a compact interactive chart for a document table.',
    'Return strict JSON only.',
    'Schema:',
    '{"title":"short chart title","note":"short explanation","chart":{"type":"bar|line|pie|doughnut","labels":["..."],"series":[{"label":"Series","values":[1,2,3]}]}}',
    'Rules:',
    '- Use only the provided table data.',
    '- Prefer a simple chart that best explains the table. Use bar by default.',
    '- Labels should come from the header row or first column when sensible.',
    '- Keep the title short and the note to one or two concise sentences.',
    '- Series values must be numeric JSON numbers, not strings.',
    '- Do not return Chart.js options, colors, functions, or any extra nested configuration.',
    '- Do not include JavaScript, comments, markdown fences, or prose outside the JSON object.',
    '- Do not invent rows, columns, or derived metrics beyond straightforward chart grouping.',
    'Table data (CSV):',
    csv.length > 0 ? csv : '[no data provided]'
  ].join('\n');
}

export function buildAiChartImagePrompt(rows: string[][]): string {
  const csv = rowsToCsv(rows.slice(0, 40));
  return [
    'Create a clean infographic-style chart image from the table data below.',
    'Requirements:',
    '- White background.',
    '- Professional analytical infographic style.',
    '- Large readable labels and legend.',
    '- Transform the table into a visual summary, not a screenshot or redraw of the table grid.',
    '- Prefer one strong primary chart with a few concise callouts or highlights when useful.',
    '- Choose the simplest visual that fits the data, usually bar, line, or a compact dashboard-like comparison.',
    '- Use only the provided values.',
    '- Do not add decorative elements.',
    '- Do not render spreadsheet cells, row/column borders, or the original table layout.',
    'Table data (CSV):',
    csv.length > 0 ? csv : '[no data provided]'
  ].join('\n');
}

export function parseAiTableChartSpec(text: string): AiTableChartSpec {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const jsonText = extractJsonObjectCandidate(cleaned);
  const parsed = parseJsonWithRepair(jsonText);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI chart response did not contain a JSON object.');
  }
  const chart = (parsed as { chart?: unknown }).chart;
  if (!chart || typeof chart !== 'object') {
    throw new Error('AI chart response did not include a chart object.');
  }
  return parsed as AiTableChartSpec;
}

function parseJsonWithRepair(jsonText: string): unknown {
  try {
    return JSON.parse(jsonText) as unknown;
  } catch (error) {
    try {
      return parseRelaxedJson(jsonText);
    } catch (repairError) {
      const message = repairError instanceof Error ? repairError.message : String(repairError);
      const originalMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse AI chart JSON: ${message}. Original parse error: ${originalMessage}`);
    }
  }
}

export function buildChartConfiguration(spec: AiTableChartSpec): ChartConfiguration {
  const normalizedType = normalizeChartType(spec.chart.type);
  const labels = Array.isArray(spec.chart.labels) ? spec.chart.labels.map(normalizeLabel) : [];
  const datasets = normalizeSpecDatasets(spec.chart, labels.length);
  if (labels.length === 0 || datasets.length === 0) {
    throw new Error('AI chart response did not include usable labels and datasets.');
  }

  const normalizedDatasets = datasets
    .map((dataset, index) => normalizeDataset(dataset, labels.length, index))
    .filter((dataset) => dataset !== null);
  if (normalizedDatasets.length === 0) {
    throw new Error('AI chart response did not include numeric dataset values.');
  }

  const config: ChartConfiguration = {
    type: normalizedType as ChartConfiguration['type'],
    data: {
      labels,
      datasets: normalizedDatasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'nearest',
        intersect: false
      },
      plugins: {
        legend: {
          display: normalizedDatasets.length > 1
        },
        title: {
          display: Boolean(spec.title?.trim()),
          text: spec.title?.trim() ?? ''
        }
      }
    }
  };

  if (normalizedType === 'bar' || normalizedType === 'line') {
    (config.options as Record<string, unknown>).scales = {
      y: {
        beginAtZero: true
      }
    };
  }

  return config;
}

function normalizeSpecDatasets(
  chart: AiTableChartSpec['chart'],
  labelCount: number
): Array<AiTableChartSpec['chart']['datasets'][number] | { label?: unknown; data?: unknown[] }> {
  if (Array.isArray(chart.series) && chart.series.length > 0) {
    return chart.series.map((series) => ({
      label: series.label,
      data: series.values
    }));
  }
  return Array.isArray(chart.datasets) ? chart.datasets : [];
}

function normalizeDataset(
  dataset: AiTableChartSpec['chart']['datasets'][number],
  labelCount: number,
  datasetIndex: number
): ChartConfiguration['data']['datasets'][number] | null {
  const rawValues = Array.isArray(dataset.data) ? dataset.data : [];
  const values = rawValues
    .slice(0, labelCount)
    .map((value) => normalizeNumericValue(value))
    .filter((value): value is number => value !== null);
  if (values.length === 0) {
    return null;
  }

  const baseColor = CHART_PALETTE[datasetIndex % CHART_PALETTE.length];
  const backgroundColor = dataset.backgroundColor ?? (
    values.length > 1 ? values.map((_, index) => CHART_PALETTE[index % CHART_PALETTE.length]) : baseColor
  );

  return {
    label: normalizeDatasetLabel(dataset.label, datasetIndex),
    data: values,
    backgroundColor,
    borderColor: dataset.borderColor ?? baseColor,
    borderWidth: 1.5,
    fill: dataset.fill ?? false
  };
}

function normalizeChartType(value: unknown): 'bar' | 'line' | 'pie' | 'doughnut' {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (ALLOWED_CHART_TYPES.has(normalized)) {
    return normalized as 'bar' | 'line' | 'pie' | 'doughnut';
  }
  return 'bar';
}

function normalizeLabel(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return '';
}

function normalizeNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/,/g, '');
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeDatasetLabel(value: unknown, datasetIndex: number): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return `Series ${datasetIndex + 1}`;
}

function escapeCsvValue(value: string): string {
  const needsQuotes = value.includes(',') || value.includes('"') || value.includes('\n');
  if (!needsQuotes) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}
