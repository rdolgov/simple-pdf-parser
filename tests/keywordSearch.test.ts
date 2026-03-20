import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { PDFDocument } from '../src/pdfDocument.js';
import type { PDFLayout } from '../src/types.js';

vi.mock('pdf-layout-parser', async () => import('../src/index.js'));

import { keywordSearchDocument } from '../testApp/src/search/keywordSearch';

describe('keywordSearchDocument', () => {
  it('finds substring matches in a simple synthetic document', () => {
    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          size: { width: 200, height: 100 },
          imageItems: [],
          lineItems: [],
          rectItems: [],
          textItems: [
            {
              text: 'hello world',
              bounds: { minX: 10, minY: 20, maxX: 110, maxY: 40 },
              baselineStart: { x: 10, y: 25 },
              baselineEnd: { x: 110, y: 25 }
            }
          ]
        }
      ]
    };
    const document = new PDFDocument(layout);

    const results = keywordSearchDocument(document, 'world');

    expect(results).toHaveLength(1);
    expect(results[0]!.pageNumber).toBe(1);
    expect(results[0]!.text).toBe('world');
    expect(results[0]!.fragments).toHaveLength(1);
    expect(results[0]!.bounds.minX).toBeGreaterThan(55);
    expect(results[0]!.bounds.maxX).toBeCloseTo(110, 6);
  });

  it('finds phrase matches as consecutive word fragments inside one text item', () => {
    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          size: { width: 220, height: 100 },
          imageItems: [],
          lineItems: [],
          rectItems: [],
          textItems: [
            {
              text: 'hello world again',
              bounds: { minX: 10, minY: 20, maxX: 170, maxY: 40 },
              baselineStart: { x: 10, y: 25 },
              baselineEnd: { x: 170, y: 25 }
            }
          ]
        }
      ]
    };
    const document = new PDFDocument(layout);

    const results = keywordSearchDocument(document, 'world again');

    expect(results).toHaveLength(1);
    expect(results[0]!.text).toBe('world again');
    expect(results[0]!.fragments).toHaveLength(2);
    expect(results[0]!.bounds.minX).toBeGreaterThan(55);
    expect(results[0]!.bounds.maxX).toBeCloseTo(170, 6);
  });

  it('returns precise page-backed matches for GPUs on NIPS page 7', () => {
    const document = PDFDocument.from(readFileSync('pdfs/NIPS-2017-attention-is-all-you-need-Paper.pdf'));

    const results = keywordSearchDocument(document, 'GPU');

    expect(results.some((result) => result.pageNumber === 7)).toBe(true);
    const page7Match = results.find((result) => result.pageNumber === 7);
    expect(page7Match).toBeDefined();
    expect(page7Match!.text).toBe('GPUs.');
    expect(page7Match!.fragments).toHaveLength(1);
    expect(page7Match!.bounds.minX).toBeGreaterThan(360);
    expect(page7Match!.bounds.maxX).toBeLessThan(395);
  });
});
