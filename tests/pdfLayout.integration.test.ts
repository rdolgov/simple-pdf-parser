import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { convertLayoutToHtml } from '../src/html/htmlLayoutConverter.js';
import { PDFDocument } from '../src/pdfDocument.js';
import { CanvasRenderer } from '../src/viewer/canvasRenderer.js';
import type { PDFTextItem } from '../src/types.js';
import { RecordingCanvas, RecordingContext } from './support/recordingCanvas.js';

function loadPlatonicSpacesDocument(): PDFDocument {
  const fixtureUrl = new URL('../pdfs/platonicspaces.pdf', import.meta.url);
  return PDFDocument.from(readFileSync(fixtureUrl));
}

function loadAttentionPaperDocument(): PDFDocument {
  const fixtureUrl = new URL('../pdfs/NIPS-2017-attention-is-all-you-need-Paper.pdf', import.meta.url);
  return PDFDocument.from(readFileSync(fixtureUrl));
}

function baselineDelta(item: PDFTextItem): { dx: number; dy: number } {
  return {
    dx: (item.baselineEnd?.x ?? 0) - (item.baselineStart?.x ?? 0),
    dy: (item.baselineEnd?.y ?? 0) - (item.baselineStart?.y ?? 0)
  };
}

describe('PDF layout integration', () => {
  it('preserves horizontal title geometry and vertical margin-stamp geometry on platonicspaces page 1', () => {
    const document = loadPlatonicSpacesDocument();
    const page = document.getPage(1);

    expect(page).toBeDefined();

    const title = page!.textItems.find((item) => item.text === "What's wrong with the Platonic ideal of space");
    const stamp = page!.textItems.find((item) => item.text.includes('arXiv:1610.04457v1'));

    expect(title).toBeDefined();
    expect(stamp).toBeDefined();

    const titleBaseline = baselineDelta(title!);
    const stampBaseline = baselineDelta(stamp!);
    const titleWidth = title!.bounds.maxX - title!.bounds.minX;
    const stampHeight = stamp!.bounds.maxY - stamp!.bounds.minY;

    expect(Math.abs(titleBaseline.dy)).toBeLessThan(0.001);
    expect(titleBaseline.dx).toBeCloseTo(titleWidth, 3);
    expect(Math.abs(stampBaseline.dx)).toBeLessThan(0.001);
    expect(stampBaseline.dy).toBeGreaterThan(400);
    expect(stampBaseline.dy).toBeCloseTo(stampHeight, 3);
  });

  it('keeps the page 1 top-level block ordering stable after HTML layout conversion', () => {
    const document = loadPlatonicSpacesDocument();
    const layout = convertLayoutToHtml({ pages: document.pages });
    const page = layout.pages[0];

    expect(page.content[0]).toMatchObject({
      type: 'heading',
      text: "What's wrong with the Platonic ideal of space"
    });
    expect(page.content[1]).toMatchObject({
      type: 'heading',
      text: 'and time?'
    });
    expect(page.content[2]).toMatchObject({
      type: 'paragraph',
      text: expect.stringContaining('Lorenzo Sadun')
    });
    expect(page.content[3]).toMatchObject({
      type: 'heading',
      text: 'October 17, 2016'
    });
    expect(page.content[4]).toMatchObject({
      type: 'paragraph',
      text: expect.stringContaining('To our senses, space is smooth, 3-dimensional')
    });
  });

  it('recovers ligature-heavy body text on platonicspaces page 2', () => {
    const document = loadPlatonicSpacesDocument();
    const page = document.getPage(2);

    expect(page).toBeDefined();

    const pageText = page!.textItems.map((item) => item.text).join('\n');

    expect(pageText).toContain(
      'and Morley [7] tried to find out. They figured that light moving in the same'
    );
    expect(pageText).not.toContain('tried to nd out');
    expect(pageText).not.toContain('They gured');
  });

  it('decodes radical symbols in the scaled dot-product attention equation', () => {
    const document = loadAttentionPaperDocument();
    const page = document.getPage(4);

    expect(page).toBeDefined();

    const equationItems = page!.textItems
      .filter((item) => item.bounds.maxY >= 360 && item.bounds.minY <= 392)
      .sort((left, right) => left.bounds.minX - right.bounds.minX);

    expect(equationItems.some((item) => item.text === '√')).toBe(true);
    expect(equationItems.some((item) => item.text === 'p')).toBe(false);
  });

  it('assigns deeper bounds to TeX radical glyphs before rendering', () => {
    const document = loadAttentionPaperDocument();
    const page = document.getPage(4);

    expect(page).toBeDefined();

    const radical = page!.textItems.find((item) => item.text === '√' && item.bounds.minX > 300);

    expect(radical).toBeDefined();
    expect(radical!.baselineStart).toBeDefined();
    expect(radical!.fontSize).toBeDefined();
    expect(radical!.bounds.minY).toBeLessThan(
      radical!.baselineStart!.y - radical!.fontSize! * 0.9
    );
  });

  it('does not merge the TeX radical with neighboring math glyphs that use a different font', () => {
    const document = loadAttentionPaperDocument();
    const page = document.getPage(4);

    expect(page).toBeDefined();

    const equationItems = page!.textItems
      .filter((item) => item.bounds.maxY >= 360 && item.bounds.minY <= 392)
      .sort((left, right) => left.bounds.minX - right.bounds.minX);

    expect(equationItems.some((item) => item.text === '√')).toBe(true);
    expect(equationItems.some((item) => item.text === 'd')).toBe(true);
    expect(equationItems.some((item) => item.text === '√d')).toBe(false);
  });

  it('assigns deeper bounds to TeX large-operator glyphs before rendering', () => {
    const document = loadAttentionPaperDocument();
    const page = document.getPage(4);

    expect(page).toBeDefined();

    const sigma = page!.textItems.find((item) => item.text === '∑');

    expect(sigma).toBeDefined();
    expect(sigma!.baselineStart).toBeDefined();
    expect(sigma!.fontSize).toBeDefined();
    expect(sigma!.bounds.minY).toBeLessThan(
      sigma!.baselineStart!.y - sigma!.fontSize! * 0.45
    );
  });

  it('applies a vertical fit adjustment when rendering the attention equation radical glyph', () => {
    const document = loadAttentionPaperDocument();
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer({ pagePadding: 16, scale: 1 });

    renderer.render(canvas, document, 4);

    const radicalDraw = context.textDraws.find((draw) => draw.text === '√' && draw.translateX > 300);

    expect(radicalDraw).toBeDefined();
    expect(radicalDraw!.y).toBeGreaterThan(2);
  });

  it('uses a math-aware browser fallback stack for Computer Modern symbols', () => {
    const document = loadAttentionPaperDocument();
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer({ pagePadding: 16, scale: 1 });

    renderer.render(canvas, document, 4);

    const radicalDraw = context.textDraws.find((draw) => draw.text === '√' && draw.translateX > 300);
    const sigmaDraw = context.textDraws.find((draw) => draw.text === '∑');

    expect(radicalDraw).toBeDefined();
    expect(sigmaDraw).toBeDefined();
    expect(radicalDraw!.font).toContain("'CMSY10'");
    expect(radicalDraw!.font).toContain('math');
    expect(sigmaDraw!.font).toContain("'CMEX9'");
    expect(sigmaDraw!.font).toContain('math');
  });

  it('renders the margin stamp rotated while keeping the main title horizontal', () => {
    const document = loadPlatonicSpacesDocument();
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer({ pagePadding: 16, scale: 1 });

    renderer.render(canvas, document, 1);

    const titleDraw = context.textDraws.find((draw) => draw.text === "What's wrong with the Platonic ideal of space");
    const stampDraw = context.textDraws.find((draw) => draw.text.includes('arXiv:1610.04457v1'));

    expect(titleDraw).toBeDefined();
    expect(stampDraw).toBeDefined();
    expect(titleDraw!.rotation).toBeCloseTo(0, 3);
    expect(stampDraw!.rotation).toBeCloseTo(-Math.PI / 2, 3);
  });
});
