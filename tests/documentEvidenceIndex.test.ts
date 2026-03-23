import { describe, expect, it } from 'vitest';
import { PDFDocument, convertLayoutToHtml } from '../src/index.js';
import { buildEvidenceRecordsFromLayout } from '../server/src/documentEvidenceIndex.js';

describe('documentEvidenceIndex', () => {
  it('builds paragraph evidence records with mapped text runs', () => {
    const document = new PDFDocument({
      pages: [
        {
          number: 1,
          textItems: [
            {
              text: 'Hello',
              bounds: { minX: 10, minY: 100, maxX: 40, maxY: 120 },
              baselineStart: { x: 10, y: 100 },
              baselineEnd: { x: 40, y: 100 }
            },
            {
              text: 'world',
              bounds: { minX: 50, minY: 100, maxX: 80, maxY: 120 },
              baselineStart: { x: 50, y: 100 },
              baselineEnd: { x: 80, y: 100 }
            }
          ],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          size: { width: 100, height: 200 }
        }
      ]
    });

    const htmlLayout = convertLayoutToHtml({ pages: document.pages });
    const records = buildEvidenceRecordsFromLayout(document, htmlLayout);

    expect(records).toHaveLength(1);
    expect(records[0]?.kind).toBe('paragraph');
    expect(records[0]?.text).toBe('Hello world');
    expect(records[0]?.pageNumber).toBe(1);
    expect(records[0]?.textRuns).toHaveLength(1);
    expect(records[0]?.textRuns[0]?.text).toBe('Hello world');
  });
});
