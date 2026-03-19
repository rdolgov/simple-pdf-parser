import { describe, expect, it } from 'vitest';

import { findFormulaFragmentMatches } from '../testApp/src/utils/formulaFragmentDetector';

describe('formulaFragmentDetector', () => {
  it('detects equation-like inline math fragments in prose', () => {
    const text = 'The feed-forward block uses FFN(x) = max(0, xW1 + b1)W2 + b2 before normalization.';

    expect(findFormulaFragmentMatches(text)).toEqual([
      expect.objectContaining({
        kind: 'formula',
        content: 'FFN(x) = max(0, xW1 + b1)W2 + b2',
        source: 'heuristic'
      })
    ]);
  });

  it('avoids highlighting citations and occupied link ranges as formulas', () => {
    const text = 'See [12] and https://example.com for details about the method.';
    const occupiedRanges = [
      { start: text.indexOf('[12]'), end: text.indexOf('[12]') + '[12]'.length },
      { start: text.indexOf('https://example.com'), end: text.indexOf('https://example.com') + 'https://example.com'.length }
    ];

    expect(findFormulaFragmentMatches(text, occupiedRanges)).toEqual([]);
  });
});
