import { describe, expect, it } from 'vitest';
import {
  closeLassoLoop,
  canvasBoundsToPdfBounds,
  getLassoBounds,
  isValidLassoBounds,
  isLassoLoopClosed,
  lassoPathToSvg,
  simplifyLassoPoints
} from '../testApp/src/utils/lassoSelection';

describe('lasso selection utilities', () => {
  it('simplifies dense pointer paths while preserving endpoints', () => {
    const simplified = simplifyLassoPoints([
      { x: 10, y: 10 },
      { x: 12, y: 11 },
      { x: 15, y: 13 },
      { x: 42, y: 18 },
      { x: 44, y: 20 }
    ], 6);

    expect(simplified[0]).toEqual({ x: 10, y: 10 });
    expect(simplified[simplified.length - 1]).toEqual({ x: 44, y: 20 });
    expect(simplified.length).toBeLessThan(5);
  });

  it('computes bounds, validates them, and converts to PDF coordinates', () => {
    const bounds = getLassoBounds([
      { x: 32, y: 44 },
      { x: 92, y: 48 },
      { x: 86, y: 124 },
      { x: 30, y: 118 }
    ]);

    expect(bounds).toEqual({
      left: 30,
      top: 44,
      width: 62,
      height: 80
    });
    expect(isValidLassoBounds(bounds)).toBe(true);
    expect(lassoPathToSvg([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 }
    ])).toMatch(/Z$/);
    expect(lassoPathToSvg([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 }
    ], { closed: false })).not.toMatch(/Z$/);

    const pdfBounds = canvasBoundsToPdfBounds(bounds!, 792, 2, 16);
    expect(pdfBounds).toEqual({
      minX: 0,
      minY: 746,
      maxX: 30,
      maxY: 786
    });
  });

  it('snaps a nearly closed loop to the starting point', () => {
    const points = [
      { x: 20, y: 20 },
      { x: 80, y: 22 },
      { x: 78, y: 88 },
      { x: 24, y: 28 }
    ];

    expect(isLassoLoopClosed(points, 12)).toBe(true);
    expect(closeLassoLoop(points, 12)).toEqual([
      { x: 20, y: 20 },
      { x: 80, y: 22 },
      { x: 78, y: 88 },
      { x: 20, y: 20 }
    ]);
  });
});
