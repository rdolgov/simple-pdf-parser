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
});
