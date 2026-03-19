import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { CanvasRenderer } from '../src/viewer/canvasRenderer.js';
import type { PDFLayout } from '../src/types.js';
import { PDFDocument } from '../src/pdfDocument.js';
import { RecordingCanvas, RecordingContext } from './support/recordingCanvas.js';

describe('CanvasRenderer raw Type1 glyph rendering', () => {
  it('renders raw Type1 Computer Modern glyphs as vector paths instead of browser text', async () => {
    const sourceDocument = PDFDocument.from(readFileSync('pdfs/NIPS-2017-attention-is-all-you-need-Paper.pdf'));
    const font = sourceDocument.getFontResource('F11');
    expect(font).toBeDefined();

    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          textItems: [
            {
              text: 'W',
              font: 'CMMI10',
              fontResourceKey: 'F11',
              fontSize: 9.9626,
              bounds: { minX: 40, minY: 30, maxX: 49.409, maxY: 40 },
              baselineStart: { x: 40, y: 32 },
              baselineEnd: { x: 49.409, y: 32 },
              glyphSpans: [{ text: 'W', advance: 9.409, glyphCode: 87 }]
            }
          ],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          size: { width: 120, height: 120 }
        }
      ],
      fontResources: font
        ? {
            F11: font
          }
        : undefined
    };

    const document = new PDFDocument(layout);
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer();

    await renderer.prepareDocumentFonts(document);
    renderer.render(canvas, document, 1);

    expect(context.textDraws.some((draw) => draw.text === 'W')).toBe(false);
    expect(context.pathPaints.some((paint) => paint.kind === 'fill')).toBe(true);
    expect(context.operations.some((entry) => entry.startsWith('bezierCurveTo:'))).toBe(true);
  });
});
