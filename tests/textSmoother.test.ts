import { describe, expect, it } from 'vitest';

import type { PDFTextItem } from '../src/types.js';
import { mergeTextRuns } from '../src/parser/textSmoother.js';

describe('mergeTextRuns', () => {
  it('does not merge adjacent runs that come from different PDF font resources', () => {
    const items: PDFTextItem[] = [
      {
        text: ')',
        font: 'Times New Roman',
        fontResourceKey: 'F8',
        fontSize: 9.9626,
        bounds: { minX: 192.768, minY: 697.13548, maxX: 196.64245514, maxY: 707.09808 },
        baselineStart: { x: 192.768, y: 699.128 },
        baselineEnd: { x: 196.64245514, y: 699.128 }
      },
      {
        text: '.',
        font: 'Times New Roman',
        fontResourceKey: 'F63',
        fontSize: 9.9626,
        bounds: { minX: 196.642, minY: 697.13548, maxX: 199.13265, maxY: 707.09808 },
        baselineStart: { x: 196.642, y: 699.128 },
        baselineEnd: { x: 199.13265, y: 699.128 }
      },
      {
        text: 'We',
        font: 'Times New Roman',
        fontResourceKey: 'F63',
        fontSize: 9.9626,
        bounds: { minX: 202.221056, minY: 697.13548, maxX: 215.2521368, maxY: 707.09808 },
        baselineStart: { x: 202.221056, y: 699.128 },
        baselineEnd: { x: 215.2521368, y: 699.128 }
      }
    ];

    const merged = mergeTextRuns(items);

    expect(merged).toHaveLength(2);
    expect(merged[0]?.text).toBe(')');
    expect(merged[0]?.fontResourceKey).toBe('F8');
    expect(merged[1]?.text).toBe('. We');
    expect(merged[1]?.fontResourceKey).toBe('F63');
  });

  it('does not invent a word space when overlapping fragments belong to the same word', () => {
    const items: PDFTextItem[] = [
      {
        text: 'investig',
        font: 'Times New Roman',
        fontResourceKey: 'F63',
        fontSize: 9.9626,
        bounds: { minX: 259.8148466, minY: 697.13548, maxX: 278.634198, maxY: 707.09808 },
        baselineStart: { x: 259.8148466, y: 699.128 },
        baselineEnd: { x: 278.634198, y: 699.128 }
      },
      {
        text: 'ate',
        font: 'Times New Roman',
        fontResourceKey: 'F63',
        fontSize: 9.9626,
        bounds: { minX: 278.584385, minY: 697.13548, maxX: 290.2007766, maxY: 707.09808 },
        baselineStart: { x: 278.584385, y: 699.128 },
        baselineEnd: { x: 290.2007766, y: 699.128 }
      }
    ];

    const merged = mergeTextRuns(items);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toBe('investigate');
  });

  it('keeps tiny positive continuation gaps inside a split word merged', () => {
    const items: PDFTextItem[] = [
      {
        text: 'Intro',
        font: 'Times New Roman',
        fontResourceKey: 'R29',
        fontSize: 10.0389,
        bounds: { minX: 108.1022, minY: 597.788464, maxX: 129.32908314, maxY: 607.827364 },
        baselineStart: { x: 108.1022, y: 600.245 },
        baselineEnd: { x: 129.32908314, y: 600.245 }
      },
      {
        text: 'duction',
        font: 'Times New Roman',
        fontResourceKey: 'R29',
        fontSize: 10.0389,
        bounds: { minX: 129.65304, minY: 597.788464, maxX: 161.76830678, maxY: 607.827364 },
        baselineStart: { x: 129.65304, y: 600.245 },
        baselineEnd: { x: 161.76830678, y: 600.245 }
      }
    ];

    const merged = mergeTextRuns(items);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toBe('Introduction');
  });

  it('keeps a real space after an alphanumeric token instead of merging the next word into its trailing capital letter', () => {
    const items: PDFTextItem[] = [
      {
        text: '2.5K',
        font: 'Times New Roman',
        fontResourceKey: 'F25',
        fontSize: 9.9626,
        bounds: { minX: 430.8978286, minY: 349.54548, maxX: 450.5440758, maxY: 359.50808 },
        baselineStart: { x: 430.8978286, y: 351.538 },
        baselineEnd: { x: 450.5440758, y: 351.538 }
      },
      {
        text: 'questions',
        font: 'Times New Roman',
        fontResourceKey: 'F25',
        fontSize: 9.9626,
        bounds: { minX: 453.4730802, minY: 349.54548, maxX: 491.111783, maxY: 359.50808 },
        baselineStart: { x: 453.4730802, y: 351.538 },
        baselineEnd: { x: 491.111783, y: 351.538 }
      }
    ];

    const merged = mergeTextRuns(items);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toBe('2.5K questions');
  });

  it('still merges a standalone title-case split when the leading capital is its own fragment', () => {
    const items: PDFTextItem[] = [
      {
        text: 'A',
        font: 'Times New Roman',
        fontResourceKey: 'F25',
        fontSize: 9.9626,
        bounds: { minX: 169.8976338, minY: 349.54548, maxX: 177.090631, maxY: 359.50808 },
        baselineStart: { x: 169.8976338, y: 351.538 },
        baselineEnd: { x: 177.090631, y: 351.538 }
      },
      {
        text: 'meri',
        font: 'Times New Roman',
        fontResourceKey: 'F25',
        fontSize: 9.9626,
        bounds: { minX: 176.9113042, minY: 349.54548, maxX: 193.3918472, maxY: 359.50808 },
        baselineStart: { x: 176.9113042, y: 351.538 },
        baselineEnd: { x: 193.3918472, y: 351.538 }
      }
    ];

    const merged = mergeTextRuns(items);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toBe('Ameri');
  });
});
