import { describe, expect, it } from 'vitest';

import {
  buildTextSelectionLayout,
  mergeTextSelectionFragments,
  resolveTextSelectionCaret,
  resolveTextSelectionRange
} from '../testApp/src/utils/textRangeSelection';

describe('textRangeSelection', () => {
  it('maps caret positions through explicit gaps between spans', () => {
    const layout = buildTextSelectionLayout({
      blockBounds: { minX: 0, minY: 0, maxX: 110, maxY: 20 },
      lines: [
        line('Hello world', { minX: 0, minY: 0, maxX: 110, maxY: 20 }, [
          span('Hello', { minX: 0, minY: 0, maxX: 50, maxY: 20 }),
          span('world', { minX: 60, minY: 0, maxX: 110, maxY: 20 })
        ])
      ],
      scaleX: 1,
      scaleY: 1,
      padding: 0
    });

    const caret = resolveTextSelectionCaret(layout, { x: 58, y: 10 });

    expect(caret).toEqual({ lineIndex: 0, offset: 6 });
  });

  it('selects text across span gaps on a single line', () => {
    const layout = buildTextSelectionLayout({
      blockBounds: { minX: 0, minY: 0, maxX: 110, maxY: 20 },
      lines: [
        line('Hello world', { minX: 0, minY: 0, maxX: 110, maxY: 20 }, [
          span('Hello', { minX: 0, minY: 0, maxX: 50, maxY: 20 }),
          span('world', { minX: 60, minY: 0, maxX: 110, maxY: 20 })
        ])
      ],
      scaleX: 1,
      scaleY: 1,
      padding: 0
    });

    const selection = resolveTextSelectionRange(
      layout,
      { lineIndex: 0, offset: 4 },
      { lineIndex: 0, offset: 11 }
    );

    expect(selection).not.toBeNull();
    expect(selection?.text).toBe('o world');
    expect(selection?.normalizedText).toBe('o world');
    expect(selection?.fragments).toEqual([
      {
        left: 40,
        top: 0,
        width: 70,
        height: 20
      }
    ]);
  });

  it('returns newline-preserving selections across multiple lines', () => {
    const layout = buildTextSelectionLayout({
      blockBounds: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
      lines: [
        line('Alpha beta', { minX: 0, minY: 20, maxX: 100, maxY: 40 }, [
          span('Alpha beta', { minX: 0, minY: 20, maxX: 100, maxY: 40 })
        ]),
        line('Gamma', { minX: 0, minY: 0, maxX: 80, maxY: 18 }, [
          span('Gamma', { minX: 0, minY: 0, maxX: 80, maxY: 18 })
        ])
      ],
      scaleX: 1,
      scaleY: 1,
      padding: 0
    });

    const selection = resolveTextSelectionRange(
      layout,
      { lineIndex: 0, offset: 6 },
      { lineIndex: 1, offset: 3 }
    );

    expect(selection).not.toBeNull();
    expect(selection?.text).toBe('beta\nGam');
    expect(selection?.normalizedText).toBe('beta Gam');
    expect(selection?.fragments).toEqual([
      {
        left: 60,
        top: 0,
        width: 40,
        height: 20
      },
      {
        left: 0,
        top: 22,
        width: 48,
        height: 18
      }
    ]);
  });

  it('merges neighboring same-line DOM selection rects into one smooth bar', () => {
    const fragments = mergeTextSelectionFragments([
      { left: 0, top: 0, width: 11, height: 22 },
      { left: 11.5, top: 0.5, width: 10.5, height: 21 },
      { left: 22.5, top: 0.25, width: 9.5, height: 21.5 }
    ]);

    expect(fragments).toEqual([
      {
        left: 0,
        top: 0,
        width: 32,
        height: 22
      }
    ]);
  });

  it('keeps separate lines as separate selection fragments', () => {
    const fragments = mergeTextSelectionFragments([
      { left: 0, top: 0, width: 28, height: 20 },
      { left: 29, top: 0.5, width: 24, height: 19 },
      { left: 0, top: 28, width: 22, height: 18 }
    ]);

    expect(fragments).toEqual([
      {
        left: 0,
        top: 0,
        width: 53,
        height: 20
      },
      {
        left: 0,
        top: 28,
        width: 22,
        height: 18
      }
    ]);
  });
});

function line(
  text: string,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  spans: Array<ReturnType<typeof span>>
) {
  return {
    text,
    bounds,
    lineHeight: bounds.maxY - bounds.minY,
    spans
  };
}

function span(text: string, bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
  return {
    text,
    bounds
  };
}
