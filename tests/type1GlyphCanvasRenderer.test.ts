import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { CanvasRenderer } from '../src/viewer/canvasRenderer.js';
import type { PDFLayout } from '../src/types.js';
import { PDFDocument } from '../src/pdfDocument.js';
import { parseType1Font } from '../src/viewer/type1FontProgram.js';
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

  it('paints raw Type1 formula glyphs in original PDF paint order even when text items are geometrically reordered', async () => {
    const sourceDocument = PDFDocument.from(readFileSync('pdfs/NIPS-2017-attention-is-all-you-need-Paper.pdf'), {
      smoothText: false
    });
    const page = sourceDocument.getPage(5);
    expect(page).toBeDefined();

    const base = page!.textItems.find(
      (item) => item.text === 'W' && item.font === 'CMMI10' && Math.abs((item.baselineStart?.x ?? 0) - 285.89) < 0.5
    );
    const superscript = page!.textItems.find(
      (item) => item.text === 'Q' && item.font === 'CMMI7' && Math.abs((item.baselineStart?.x ?? 0) - 296.69) < 0.5
    );
    const subscript = page!.textItems.find(
      (item) => item.text === 'i' && item.font === 'CMMI7' && Math.abs((item.baselineStart?.x ?? 0) - 295.30) < 0.5
    );

    expect(base).toBeDefined();
    expect(superscript).toBeDefined();
    expect(subscript).toBeDefined();
    expect(base?.fontResourceKey).toBeDefined();
    expect(superscript?.fontResourceKey).toBeDefined();

    const fontResources = Object.fromEntries(
      [base, superscript, subscript]
        .filter((item): item is NonNullable<typeof item> => Boolean(item?.fontResourceKey))
        .map((item) => [item.fontResourceKey!, sourceDocument.getFontResource(item.fontResourceKey)!])
    );

    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          textItems: [
            { ...superscript!, paintOrder: 1 },
            { ...base!, paintOrder: 0 },
            { ...subscript!, paintOrder: 2 }
          ],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          size: { width: 500, height: 800 }
        }
      ],
      fontResources
    };

    const document = new PDFDocument(layout);
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer();

    await renderer.prepareDocumentFonts(document);
    renderer.render(canvas, document, 1);

    const fills = context.pathPaints.filter((paint) => paint.kind === 'fill');
    expect(fills).toHaveLength(3);
    expect(fills[0]!.translateX).toBeCloseTo((base!.baselineStart?.x ?? 0) + 16, 3);
    expect(fills[1]!.translateX).toBeCloseTo((superscript!.baselineStart?.x ?? 0) + 16, 3);
    expect(fills[2]!.translateX).toBeCloseTo((subscript!.baselineStart?.x ?? 0) + 16, 3);
  });

  it('keeps raw Type1 glyph outlines on their native font scale instead of stretching them to the PDF advance width', async () => {
    const sourceDocument = PDFDocument.from(readFileSync('pdfs/NIPS-2017-attention-is-all-you-need-Paper.pdf'), {
      smoothText: false
    });
    const page = sourceDocument.getPage(5);
    expect(page).toBeDefined();

    const superscript = page!.textItems.find(
      (item) => item.text === 'Q' && item.font === 'CMMI7' && Math.abs((item.baselineStart?.x ?? 0) - 296.69) < 0.5
    );
    expect(superscript).toBeDefined();
    expect(superscript?.fontResourceKey).toBeDefined();
    const font = sourceDocument.getFontResource(superscript!.fontResourceKey);
    const parsedFont = font ? parseType1Font(font) : undefined;
    expect(parsedFont).toBeDefined();

    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          textItems: [{ ...superscript! }],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          size: { width: 500, height: 800 }
        }
      ],
      fontResources: font
        ? {
            [superscript!.fontResourceKey!]: font
          }
        : undefined
    };

    const document = new PDFDocument(layout);
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer();

    await renderer.prepareDocumentFonts(document);
    renderer.render(canvas, document, 1);

    const fills = context.pathPaints.filter((paint) => paint.kind === 'fill');
    expect(fills).toHaveLength(1);
    const expectedScaleX =
      (superscript!.fontSize ?? 0) * Math.abs(parsedFont!.fontMatrix[0] || 0.001) * Math.abs(superscript!.textHorizontalScale ?? 1);
    expect(fills[0]!.scaleX).toBeCloseTo(expectedScaleX, 6);
  });

  it('renders StandardEncoding raw Type1 prose as vector glyph paths instead of falling back to browser text', async () => {
    const sourceDocument = PDFDocument.from(readFileSync('pdfs/NIPS-2017-attention-is-all-you-need-Paper.pdf'));
    const page = sourceDocument.getPage(7);
    const bodyLine = page?.textItems.find((item) => item.text.includes('P100 GPUs. For our base models using'));
    expect(bodyLine).toBeDefined();
    expect(bodyLine?.fontResourceKey).toBeDefined();

    const font = bodyLine?.fontResourceKey ? sourceDocument.getFontResource(bodyLine.fontResourceKey) : undefined;
    expect(font).toBeDefined();

    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          textItems: [{ ...bodyLine! }],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          size: { width: 700, height: 500 }
        }
      ],
      fontResources: font && bodyLine?.fontResourceKey
        ? {
            [bodyLine.fontResourceKey]: font
          }
        : undefined
    };

    const document = new PDFDocument(layout);
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer();

    await renderer.prepareDocumentFonts(document);
    renderer.render(canvas, document, 1);

    expect(context.textDraws.some((draw) => draw.text.includes('P100 GPUs'))).toBe(false);
    expect(context.pathPaints.filter((paint) => paint.kind === 'fill').length).toBeGreaterThan(20);
  });
});
