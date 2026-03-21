import { describe, expect, it } from 'vitest';
import {
  buildAiChartImagePrompt,
  buildAiInteractiveChartPrompt,
  buildChartConfiguration,
  parseAiTableChartSpec,
  rowsToCsv,
  tableToRows
} from '../testApp/src/utils/tableChartSpec';
import type { ExtractedTable } from '../testApp/src/types';

describe('ai table visualization', () => {
  it('converts extracted cells into ordered rows', () => {
    const table: ExtractedTable = {
      id: 'table-1',
      page: 1,
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 80 },
      cells: [
        { row: 2, col: 2, text: '34', kind: 'td' },
        { row: 1, col: 1, text: 'Model', kind: 'th' },
        { row: 2, col: 1, text: 'Base', kind: 'td' },
        { row: 1, col: 2, text: 'BLEU', kind: 'th' }
      ]
    };

    expect(tableToRows(table)).toEqual([
      ['Model', 'BLEU'],
      ['Base', '34']
    ]);
  });

  it('builds prompts with csv table data', () => {
    const rows = [
      ['Model', 'BLEU'],
      ['Base', '34.2']
    ];

    expect(rowsToCsv(rows)).toBe('Model,BLEU\nBase,34.2');
    expect(buildAiInteractiveChartPrompt(rows)).toContain('Model,BLEU');
    expect(buildAiInteractiveChartPrompt(rows)).toContain('Return strict JSON only.');
    expect(buildAiChartImagePrompt(rows)).toContain('Create a clean infographic-style chart image');
    expect(buildAiChartImagePrompt(rows)).toContain('not a screenshot or redraw of the table grid');
  });

  it('parses chart specs and normalizes them into chart.js config', () => {
    const spec = parseAiTableChartSpec(`
      \`\`\`json
      {
        "title": "BLEU by model",
        "note": "Base is lower than Big.",
        "chart": {
          "type": "bar",
          "labels": ["Base", "Big"],
          "series": [
            {
              "label": "BLEU",
              "values": ["34.2", 35.7]
            }
          ]
        }
      }
      \`\`\`
    `);

    const config = buildChartConfiguration(spec);

    expect(config.type).toBe('bar');
    expect(config.data?.labels).toEqual(['Base', 'Big']);
    expect(config.data?.datasets[0]?.label).toBe('BLEU');
    expect(config.data?.datasets[0]?.data).toEqual([34.2, 35.7]);
    expect((config.options as { plugins?: { title?: { display?: boolean } } }).plugins?.title?.display).toBe(true);
  });

  it('repairs common JSON-ish chart responses before parsing', () => {
    const spec = parseAiTableChartSpec(`
      {
        title: 'BLEU by model',
        note: 'Base is lower than Big.',
        chart: {
          type: 'bar',
          labels: ['Base', 'Big'],
          datasets: [
            {
              label: 'BLEU',
              data: [34.2, 35.7],
            },
          ],
        },
      }
    `);

    const config = buildChartConfiguration(spec);
    expect(spec.title).toBe('BLEU by model');
    expect(config.type).toBe('bar');
    expect(config.data?.labels).toEqual(['Base', 'Big']);
    expect(config.data?.datasets[0]?.data).toEqual([34.2, 35.7]);
  });

  it('parses commented chart specs with bare values and nested trailing commas', () => {
    const spec = parseAiTableChartSpec(`
      {
        // compact chart
        title: "Attention weights",
        chart: {
          type: bar,
          labels: ["Head 1", "Head 2",],
          datasets: [
            {
              label: Score,
              data: [0.42, 0.58,],
              backgroundColor: [rgba(37, 99, 235, 0.65), rgba(249, 115, 22, 0.65)],
            },
          ],
        },
      }
    `);

    const config = buildChartConfiguration(spec);
    expect(spec.chart.type).toBe('bar');
    expect(config.type).toBe('bar');
    expect(config.data?.datasets[0]?.label).toBe('Score');
    expect(config.data?.datasets[0]?.backgroundColor).toEqual([
      'rgba(37, 99, 235, 0.65)',
      'rgba(249, 115, 22, 0.65)'
    ]);
  });

  it('repairs truncated chart specs by extracting and closing the JSON object envelope', () => {
    const spec = parseAiTableChartSpec(`
      Here is the chart:
      {
        title: "BLEU by model",
        chart: {
          type: "bar",
          labels: ["Base", "Big"],
          series: [
            { label: "BLEU", values: [34.2, 35.7] }
          ]
    `);

    const config = buildChartConfiguration(spec);
    expect(spec.title).toBe('BLEU by model');
    expect(config.type).toBe('bar');
    expect(config.data?.labels).toEqual(['Base', 'Big']);
    expect(config.data?.datasets[0]?.data).toEqual([34.2, 35.7]);
  });
});
