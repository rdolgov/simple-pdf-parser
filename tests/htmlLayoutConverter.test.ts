import { describe, expect, it } from 'vitest';

import { convertLayoutToHtml } from '../src/html/htmlLayoutConverter.js';
import type { PDFLayout, PDFTextItem } from '../src/types.js';

function textItem(
  text: string,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  fontSize = 10
): PDFTextItem {
  return {
    text,
    font: 'Times New Roman',
    fontSize,
    bounds: { minX, minY, maxX, maxY },
    baselineStart: { x: minX, y: minY + 2 },
    baselineEnd: { x: maxX, y: minY + 2 }
  };
}

describe('htmlLayoutConverter', () => {
  it('joins hyphenated paragraph continuations without inserting a line-break space', () => {
    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          size: { width: 612, height: 792 },
          textItems: [
            textItem('Our model achieves 28.4 BLEU on the WMT 2014 English-', 108, 500, 430, 510),
            textItem('to-German translation task.', 108, 488, 280, 498)
          ],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          pathItems: []
        }
      ]
    };

    const html = convertLayoutToHtml(layout);
    const paragraph = html.pages[0]?.content[0];

    expect(paragraph).toMatchObject({
      type: 'paragraph',
      text: 'Our model achieves 28.4 BLEU on the WMT 2014 English-to-German translation task.'
    });
  });
});
