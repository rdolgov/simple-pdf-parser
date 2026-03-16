import { describe, expect, it } from 'vitest';

import { detectCmexComposites } from '../src/viewer/cmexComposite.js';
import type { PDFTextItem } from '../src/types.js';

describe('detectCmexComposites', () => {
  it('anchors underbraces from the shared CMEX baseline instead of the head fragment center', () => {
    const items: PDFTextItem[] = [
      {
        text: '{z',
        font: 'CMEX10',
        fontSize: 9.81818,
        bounds: { minX: 185.214, minY: 526.832364, maxX: 194.050362, maxY: 536.650544 },
        baselineStart: { x: 185.214, y: 528.796 },
        baselineEnd: { x: 194.050362, y: 528.796 }
      },
      {
        text: '|',
        font: 'CMEX10',
        fontSize: 9.81818,
        bounds: { minX: 180.25604, minY: 506.705055, maxX: 184.674221, maxY: 529.9741416 },
        baselineStart: { x: 180.25604, y: 528.79596 },
        baselineEnd: { x: 184.674221, y: 528.79596 }
      },
      {
        text: '}',
        font: 'CMEX10',
        fontSize: 9.81818,
        bounds: { minX: 194.59, minY: 506.705095, maxX: 199.008181, maxY: 529.9741816 },
        baselineStart: { x: 194.59, y: 528.796 },
        baselineEnd: { x: 199.008181, y: 528.796 }
      }
    ];

    const detection = detectCmexComposites(items);

    expect(detection.composites).toHaveLength(1);
    expect(detection.composites[0].kind).toBe('underbrace');
    expect(detection.composites[0].centerY).toBeCloseTo(523.88691, 4);
    expect(detection.composites[0].centerY).toBeGreaterThan(521);
    expect(detection.composites[0].centerY).toBeLessThan(530);
  });

  it('keeps overbraces anchored to the head fragment baseline band', () => {
    const items: PDFTextItem[] = [
      {
        text: 'z}|',
        font: 'CMEX10',
        fontSize: 9.81818,
        bounds: { minX: 180.25515, minY: 563.768364, maxX: 194.050362, maxY: 573.586584 },
        baselineStart: { x: 180.25515, y: 565.73204 },
        baselineEnd: { x: 194.050362, y: 565.732 }
      },
      {
        text: '{',
        font: 'CMEX10',
        fontSize: 9.81818,
        bounds: { minX: 194.59, minY: 543.641095, maxX: 199.008181, maxY: 566.9101816 },
        baselineStart: { x: 194.59, y: 565.732 },
        baselineEnd: { x: 199.008181, y: 565.732 }
      }
    ];

    const detection = detectCmexComposites(items);

    expect(detection.composites).toHaveLength(1);
    expect(detection.composites[0].kind).toBe('overbrace');
    expect(detection.composites[0].centerY).toBeCloseTo(568.677474, 4);
  });
});
