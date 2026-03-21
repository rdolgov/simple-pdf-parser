import type { ExtractedTable } from '../types';

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

function escapeCsvValue(value: string): string {
  const needsQuotes = value.includes(',') || value.includes('"') || value.includes('\n');
  if (!needsQuotes) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}
