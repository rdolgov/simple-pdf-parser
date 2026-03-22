import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { CanvasRenderer } from '../src/viewer/canvasRenderer.js';
import type { PDFLayout } from '../src/types.js';
import { PDFDocument } from '../src/pdfDocument.js';
import { RecordingCanvas, RecordingContext } from './support/recordingCanvas.js';

describe('CanvasRenderer Type1C outline glyph rendering', () => {
  it('renders LINE10 arrows as vector paths instead of browser fallback text', async () => {
    const sourceDocument = PDFDocument.from(readFileSync('pdfs/InformationTheoryByMacKay.pdf'));
    const page = sourceDocument.getPage(15);
    const arrow = page?.textItems.find(
      (item) =>
        item.font === 'LINE10' &&
        item.text === '→' &&
        item.fontResourceKey === 'R176' &&
        item.bounds.minX > 440 &&
        item.bounds.maxX < 460 &&
        item.bounds.minY > 380 &&
        item.bounds.maxY < 405
    );

    expect(arrow).toBeDefined();
    expect(arrow?.fontResourceKey).toBeDefined();

    const font = sourceDocument.getFontResource(arrow!.fontResourceKey!);
    expect(font).toBeDefined();

    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          textItems: [{ ...arrow! }],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          size: { width: 600, height: 800 }
        }
      ],
      fontResources: font && arrow?.fontResourceKey
        ? {
            [arrow.fontResourceKey]: font
          }
        : undefined
    };

    const document = new PDFDocument(layout);
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer();

    await renderer.prepareDocumentFonts(document);
    renderer.render(canvas, document, 1);

    expect(context.textDraws.some((draw) => draw.text.includes('→'))).toBe(false);
    expect(context.pathPaints.filter((paint) => paint.kind === 'fill')).toHaveLength(1);
    expect(context.operations.some((entry) => entry.startsWith('bezierCurveTo:'))).toBe(true);
  });
});
