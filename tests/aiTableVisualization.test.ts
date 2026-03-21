import { describe, expect, it } from 'vitest';
import { buildAiChartImagePrompt, rowsToCsv, tableToRows } from '../testApp/src/utils/tableChartSpec';
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

  it('builds an infographic prompt with csv table data', () => {
    const rows = [
      ['Model', 'BLEU'],
      ['Base', '34.2']
    ];

    expect(rowsToCsv(rows)).toBe('Model,BLEU\nBase,34.2');
    expect(buildAiChartImagePrompt(rows)).toContain('Create a clean infographic-style chart image');
    expect(buildAiChartImagePrompt(rows)).toContain('Model,BLEU');
    expect(buildAiChartImagePrompt(rows)).toContain('not a screenshot or redraw of the table grid');
  });

  it('quotes csv values when needed', () => {
    const rows = [
      ['Label', 'Value'],
      ['Large, model', '34.2'],
      ['Quoted "entry"', '35.1']
    ];

    expect(rowsToCsv(rows)).toBe('Label,Value\n"Large, model",34.2\n"Quoted ""entry""",35.1');
  });
});
