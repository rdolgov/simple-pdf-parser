import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { PDFDocument } from '../src/pdfDocument.js';
import {
  computeTextItemSubstringBounds,
  findTextItemSubstringMatches
} from '../src/textItemSubstringBounds.js';
import type { PDFTextItem } from '../src/types.js';

describe('textItemSubstringBounds', () => {
  it('computes proportional substring bounds for simple horizontal text', () => {
    const item: PDFTextItem = {
      text: 'hello',
      bounds: { minX: 10, minY: 20, maxX: 110, maxY: 40 },
      baselineStart: { x: 10, y: 25 },
      baselineEnd: { x: 110, y: 25 }
    };

    const bounds = computeTextItemSubstringBounds(item, 1, 4);

    expect(bounds).toEqual({
      minX: 30,
      minY: 20,
      maxX: 90,
      maxY: 40
    });
  });

  it('finds the GPUs substring inside the merged body-text line on NIPS page 7', () => {
    const document = PDFDocument.from(readFileSync('pdfs/NIPS-2017-attention-is-all-you-need-Paper.pdf'));
    const page = document.getPage(7);
    const line = page?.textItems.find((item) => item.text.includes('P100 GPUs. For our base models using'));

    expect(line).toBeDefined();

    const matches = findTextItemSubstringMatches(line!, 'GPUs.');

    expect(matches).toHaveLength(1);
    expect(matches[0]!.text).toBe('GPUs.');
    expect(matches[0]!.bounds.minX).toBeGreaterThan(360);
    expect(matches[0]!.bounds.maxX).toBeLessThan(395);
    expect(matches[0]!.bounds.minY).toBeGreaterThanOrEqual(line!.bounds.minY);
    expect(matches[0]!.bounds.maxY).toBeLessThanOrEqual(line!.bounds.maxY);
    expect(matches[0]!.bounds.maxX - matches[0]!.bounds.minX).toBeLessThan(
      line!.bounds.maxX - line!.bounds.minX
    );
  });
});
