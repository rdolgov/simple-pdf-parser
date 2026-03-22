import { describe, expect, it } from 'vitest';

import { pageRequiresMainThreadRendering } from '../testApp/src/utils/backgroundCanvasRendering';

describe('backgroundCanvasRendering', () => {
  it('keeps data-uri image pages on the main thread', () => {
    expect(pageRequiresMainThreadRendering({
      number: 6,
      textItems: [],
      imageItems: [
        {
          name: 'Im1',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
          dataUri: 'data:image/jpeg;base64,AAAA'
        }
      ],
      lineItems: [],
      rectItems: [],
      size: { width: 100, height: 100 }
    })).toBe(true);
  });

  it('allows worker rendering for pixel-backed image pages', () => {
    expect(pageRequiresMainThreadRendering({
      number: 6,
      textItems: [],
      imageItems: [
        {
          name: 'Im1',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
          dataUri: 'data:image/jpeg;base64,AAAA',
          pixels: {
            width: 1,
            height: 1,
            data: new Uint8ClampedArray([255, 255, 255, 255])
          }
        }
      ],
      lineItems: [],
      rectItems: [],
      size: { width: 100, height: 100 }
    })).toBe(false);
  });
});
