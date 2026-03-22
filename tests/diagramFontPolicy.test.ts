import { describe, expect, it } from 'vitest';

import {
  isSemanticDiagramFontName,
  shouldPreferType1COutlineRendering
} from '../src/viewer/diagramFontPolicy.js';

describe('diagramFontPolicy', () => {
  it('treats LINE diagram fonts as semantic outline glyph fonts instead of browser text fonts', () => {
    expect(isSemanticDiagramFontName('LINE10')).toBe(true);
    expect(isSemanticDiagramFontName('LINEW10')).toBe(true);
    expect(isSemanticDiagramFontName('CMTI12')).toBe(false);
    expect(
      shouldPreferType1COutlineRendering({
        fontKey: 'R176',
        objectKey: '176 0',
        baseFontName: 'LINE10'
      })
    ).toBe(true);
  });
});
