import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { PDFDocument } from '../src/pdfDocument.js';
import { extractTextItemWords } from '../src/textWordGeometry.js';
import type { PDFTextItem } from '../src/types.js';

describe('textWordGeometry', () => {
  it('extracts per-word bounds from a simple horizontal text item', () => {
    const item: PDFTextItem = {
      text: 'hello world again',
      bounds: { minX: 10, minY: 20, maxX: 170, maxY: 40 },
      baselineStart: { x: 10, y: 25 },
      baselineEnd: { x: 170, y: 25 }
    };

    const words = extractTextItemWords(item);

    expect(words.map((word) => word.text)).toEqual(['hello', 'world', 'again']);
    expect(words[1]!.bounds.minX).toBeGreaterThan(words[0]!.bounds.maxX);
    expect(words[2]!.bounds.maxX).toBeCloseTo(170, 6);
  });

  it('extracts the GPUs word box from the merged NIPS body-text line', () => {
    const document = PDFDocument.from(readFileSync('pdfs/NIPS-2017-attention-is-all-you-need-Paper.pdf'));
    const page = document.getPage(7);
    const line = page?.textItems.find((item) => item.text.includes('P100 GPUs. For our base models using'));

    expect(line).toBeDefined();

    const words = extractTextItemWords(line!);
    const gpus = words.find((word) => word.normalizedText === 'gpus');

    expect(gpus).toBeDefined();
    expect(gpus!.text).toBe('GPUs.');
    expect(gpus!.bounds.minX).toBeGreaterThan(360);
    expect(gpus!.bounds.maxX).toBeLessThan(395);
  });
});
