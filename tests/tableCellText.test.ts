import { describe, expect, it } from 'vitest';

import { normalizeParsedTableRows, normalizeTableCellText } from '../testApp/src/utils/tableCellText';

describe('tableCellText', () => {
  it('extracts readable text from object-shaped cells', () => {
    expect(normalizeTableCellText({ text: 'Accuracy' })).toBe('Accuracy');
    expect(normalizeTableCellText({ value: 42 })).toBe('42');
    expect(normalizeTableCellText({ content: { text: 'GPU' } })).toBe('GPU');
    expect(normalizeTableCellText({ parts: [{ text: 'hello' }, { text: 'world' }] })).toBe('hello world');
  });

  it('normalizes parsed table rows without producing object-object text', () => {
    expect(normalizeParsedTableRows([
      [{ text: 'Model' }, { text: 'Score' }],
      [{ value: 'Transformer' }, { value: 27.5 }]
    ])).toEqual([
      ['Model', 'Score'],
      ['Transformer', '27.5']
    ]);
  });
});
