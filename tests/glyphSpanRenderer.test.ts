import { describe, expect, it } from 'vitest';

import { resolveRenderableGlyphSpanRun } from '../src/viewer/glyphSpanRenderer.js';
import type { PDFTextItem } from '../src/types.js';

function createTextItem(overrides: Partial<PDFTextItem> = {}): PDFTextItem {
  return {
    text: '',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    font: 'Arial',
    fontSize: 8,
    glyphSpans: [],
    ...overrides
  };
}

describe('resolveRenderableGlyphSpanRun', () => {
  it('preserves per-glyph advances when glyph spans keep meaningful PDF spacing that normalized text dropped', () => {
    const item = createTextItem({
      text: 'INPUT PROJECT',
      glyphSpans: Array.from('INPUT').map((text) => ({ text, advance: 500 })).concat(
        Array.from('      ').map((text) => ({ text, advance: 240 })),
        Array.from('PROJECT').map((text) => ({ text, advance: 500 }))
      )
    });

    const run = resolveRenderableGlyphSpanRun(item);

    expect(run?.spans.length).toBe(item.glyphSpans?.length);
    expect(run?.totalAdvance).toBeGreaterThan(0);
  });

  it('does not switch normal sans-serif prose to per-glyph rendering when text and glyph spans already match', () => {
    const item = createTextItem({
      text: 'natural science',
      glyphSpans: Array.from('natural science').map((text) => ({ text, advance: 500 }))
    });

    expect(resolveRenderableGlyphSpanRun(item)).toBeUndefined();
  });

  it('preserves invisible PDF glyph slots so display rendering can keep their advances', () => {
    const item = createTextItem({
      text: 'ab',
      font: 'Cambria',
      fontResourceKey: 'TT4',
      fontSize: 12,
      glyphSpans: [
        { text: 'a', advance: 5 },
        { text: '', advance: 4 },
        { text: 'b', advance: 5 }
      ]
    });

    const run = resolveRenderableGlyphSpanRun(item, { force: true });

    expect(run?.spans).toEqual(item.glyphSpans);
    expect(run?.totalAdvance).toBe(14);
  });
});
