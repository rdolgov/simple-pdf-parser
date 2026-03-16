import { describe, expect, it } from 'vitest';

import type { PDFTextItem } from '../src/types.js';
import {
  isDisplayCmexOperator,
  resolveGlyphScaleX,
  resolveVerticalScaleBounds
} from '../src/viewer/embeddedFontRenderPolicy.js';

function createItem(overrides: Partial<PDFTextItem> = {}): PDFTextItem {
  return {
    text: '∑',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 20 },
    font: 'CMEX10',
    fontSize: 10,
    glyphSpans: [{ text: '∑', advance: 10, glyphCode: 88 }],
    ...overrides
  };
}

describe('embeddedFontRenderPolicy', () => {
  it('detects single-glyph CMEX display operators by glyph code', () => {
    expect(isDisplayCmexOperator(createItem())).toBe(true);
    expect(isDisplayCmexOperator(createItem({ glyphSpans: [{ text: '∑', advance: 10, glyphCode: 20 }] }))).toBe(false);
  });

  it('allows exact embedded CMEX display operators to shrink below the fallback floor', () => {
    const bounds = resolveVerticalScaleBounds(createItem(), {
      family: 'PDFEmbedded-CMEX10-R123',
      renderMode: 'glyph-span',
      glyphCodeToText: new Map([[88, '\ue032']])
    });

    expect(bounds.minScaleY).toBeLessThan(0.85);
    expect(bounds.maxScaleY).toBeGreaterThanOrEqual(3.5);
  });

  it('keeps single-glyph exact math operators on their PDF width instead of forcing the old clamp', () => {
    const scaleX = resolveGlyphScaleX(0.62, createItem(), 1, {
      family: 'PDFEmbedded-CMEX10-R123',
      renderMode: 'glyph-span',
      glyphCodeToText: new Map([[88, '\ue032']])
    });

    expect(scaleX).toBeCloseTo(0.62, 5);
  });
});
