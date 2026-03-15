import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { PDFDocument } from '../src/pdfDocument.js';
import { analyzeAiDetectionSupport } from '../testApp/src/utils/aiDetectionSupport';
import type { PDFLayout } from '../src/types.js';

describe('aiDetectionSupport', () => {
  it('supports normal text PDFs even when they contain figures', () => {
    const document = new PDFDocument({
      pages: [
        {
          number: 1,
          size: { width: 100, height: 100 },
          textItems: [
            {
              text: 'This page contains enough extracted text to support AI detection.',
              bounds: { minX: 0, minY: 0, maxX: 80, maxY: 10 }
            }
          ],
          imageItems: [
            {
              name: 'figure-1',
              bounds: { minX: 5, minY: 5, maxX: 95, maxY: 95 }
            }
          ],
          lineItems: [],
          rectItems: []
        },
        {
          number: 2,
          size: { width: 100, height: 100 },
          textItems: [
            {
              text: 'A second text page keeps this document from looking like an image-only scan.',
              bounds: { minX: 0, minY: 0, maxX: 80, maxY: 10 }
            }
          ],
          imageItems: [],
          lineItems: [],
          rectItems: []
        }
      ]
    } satisfies PDFLayout);

    expect(analyzeAiDetectionSupport(document)).toEqual({ supported: true });
  });

  it('blocks image-dominant PDFs with only tiny amounts of extracted text', () => {
    const document = new PDFDocument({
      pages: [
        {
          number: 1,
          size: { width: 100, height: 100 },
          textItems: [
            {
              text: '2/10/25 7:55 PM',
              bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 }
            }
          ],
          imageItems: [
            {
              name: 'scan-1',
              bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }
            }
          ],
          lineItems: [],
          rectItems: []
        },
        {
          number: 2,
          size: { width: 100, height: 100 },
          textItems: [
            {
              text: 'Page 2',
              bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 }
            }
          ],
          imageItems: [
            {
              name: 'scan-2',
              bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }
            }
          ],
          lineItems: [],
          rectItems: []
        }
      ]
    } satisfies PDFLayout);

    expect(analyzeAiDetectionSupport(document)).toEqual({
      supported: false,
      message: expect.stringContaining('image-based')
    });
  });

  it('allows image-dominant PDFs when substantial OCR text is available', () => {
    const document = new PDFDocument({
      pages: [
        {
          number: 1,
          size: { width: 100, height: 100 },
          textItems: [
            {
              text: 'This is a scanned page with enough OCR text extracted to make AI detection useful. '.repeat(4),
              bounds: { minX: 0, minY: 0, maxX: 90, maxY: 20 }
            }
          ],
          imageItems: [
            {
              name: 'scan-1',
              bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }
            }
          ],
          lineItems: [],
          rectItems: []
        }
      ]
    } satisfies PDFLayout);

    expect(analyzeAiDetectionSupport(document)).toEqual({ supported: true });
  });

  it('marks the Adobe scanned PDF unsupported for AI detection', () => {
    const fixtureUrl = new URL(
      '../pdfs/Leadership, Trust, And AI_ Dan Durn\u2019s Journey As Adobe\u2019s CFO.pdf',
      import.meta.url
    );
    const document = PDFDocument.from(readFileSync(fixtureUrl));

    expect(analyzeAiDetectionSupport(document)).toEqual({
      supported: false,
      message: expect.stringContaining('API calls are skipped')
    });
  });
});
