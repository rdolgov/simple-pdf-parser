import type { ChartConfiguration } from 'chart.js';
import type { GeminiGenerateContentResponse } from 'pdf-layout-parser';
import type { ExtractedTable } from '../types';
import { createTransportedGeminiApi } from './llmClients';

export type AiChartResult = {
  config: ChartConfiguration;
  text?: string;
  raw: GeminiGenerateContentResponse;
};

export async function generateAiChartFromTable(params: {
  table: ExtractedTable;
  apiKey: string;
  model?: string;
}): Promise<AiChartResult> {
  const { table, apiKey, model } = params;
  const rows = tableToRows(table);
  const prompt = buildChartPrompt(rows);

  const client = createTransportedGeminiApi({ apiKey, model });
  const response = await client.generateText(prompt);
  const chartConfig = parseChartConfig(response.text);

  return {
    config: chartConfig,
    text: response.text,
    raw: response.raw
  };
}

function tableToRows(table: ExtractedTable): string[][] {
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

function buildChartPrompt(rows: string[][]): string {
  const previewRows = rows.slice(0, 30);
  const csvLines = previewRows.map((row) => row.map(escapeCsvValue).join(',')).join('\n');
  const sampleConfig = {
    type: 'bar',
    data: {
      labels: ['Label A', 'Label B', 'Label C'],
      datasets: [
        {
          label: 'Series 1',
          data: [10, 20, 15]
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: true }
      }
    }
  };

  return [
    'You are an assistant that designs Chart.js v4 chart configurations.',
    'Given a table of data (CSV formatted), produce a concise JSON object that can be passed directly to new Chart(ctx, config).',
    'Rules:',
    '- Always return ONLY the JSON object, no code fences or prose.',
    '- Use a bar chart unless the data clearly suggests another simple chart; avoid complex types.',
    '- Derive labels from the first row when available. Use remaining rows as series data.',
    '- Keep dataset labels brief.',
    '- Do not invent data; use only what is provided.',
    '- Include responsive: true and sensible axis settings.',
    `Example format: ${JSON.stringify(sampleConfig)}`,
    'Table data (CSV):',
    csvLines.length > 0 ? csvLines : '[no data provided]'
  ].join('\n');
}

function escapeCsvValue(value: string): string {
  const needsQuotes = value.includes(',') || value.includes('"') || value.includes('\n');
  if (!needsQuotes) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function parseChartConfig(text?: string): ChartConfiguration {
  if (!text) {
    throw new Error('Gemini response did not include text for chart config');
  }
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  const jsonText = jsonMatch ? jsonMatch[0] : cleaned;

  try {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Parsed chart config is not an object');
    }
    const config = parsed as ChartConfiguration;
    if (!(config as any).type) {
      (config as any).type = 'bar';
    }
    if (!config.options) {
      (config as any).options = { responsive: true };
    }
    return config;
  } catch (error) {
    throw new Error(
      `Failed to parse chart config JSON${error instanceof Error ? `: ${error.message}` : ''}`
    );
  }
}
