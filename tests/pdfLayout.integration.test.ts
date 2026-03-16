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

function loadWordEmbeddingsDocument(): PDFDocument {
  const fixtureUrl = new URL('../pdfs/1301.3781v3.pdf', import.meta.url);
  return PDFDocument.from(readFileSync(fixtureUrl));
}

function loadAdobeScannedDocument(): PDFDocument {
  const fixtureUrl = new URL(
    '../pdfs/Leadership, Trust, And AI_ Dan Durn\u2019s Journey As Adobe\u2019s CFO.pdf',
    import.meta.url
  );
  return PDFDocument.from(readFileSync(fixtureUrl));
}

function loadMacKayDocument(): PDFDocument {
  const fixtureUrl = new URL('../pdfs/InformationTheoryByMacKay.pdf', import.meta.url);
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

  it('decodes CMSY multiplication symbols instead of ligature fallbacks in the training complexity equation', () => {
    const document = loadWordEmbeddingsDocument();
    const page = document.getPage(3);

    expect(page).toBeDefined();

    const equationItems = page!.textItems
      .filter((item) => item.bounds.maxY >= 676 && item.bounds.minY <= 689)
      .sort((left, right) => left.bounds.minX - right.bounds.minX);

    expect(equationItems.some((item) => item.text === '×')).toBe(true);
    expect(equationItems.some((item) => item.text === 'fi')).toBe(false);
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

  it('keeps MacKay binomial delimiters separate and assigns them tall bounds', () => {
    const document = loadMacKayDocument();
    const page = document.getPage(13);

    expect(page).toBeDefined();

    const equationItems = page!.textItems.filter(
      (item) => item.bounds.minY >= 438 && item.bounds.maxY <= 476 && item.bounds.minX >= 150 && item.bounds.maxX <= 305
    );
    const leftDelimiter = equationItems.find((item) => item.text === '(' && item.font === 'CMEX10');
    const rightDelimiter = equationItems.find((item) => item.text === ')' && item.font === 'CMEX10');

    expect(equationItems.some((item) => item.text === '( )')).toBe(false);
    expect(leftDelimiter).toBeDefined();
    expect(rightDelimiter).toBeDefined();
    expect(leftDelimiter!.bounds.minY).toBeLessThan(leftDelimiter!.baselineStart!.y - leftDelimiter!.fontSize! * 2);
    expect(rightDelimiter!.bounds.minY).toBeLessThan(rightDelimiter!.baselineStart!.y - rightDelimiter!.fontSize! * 2);
  });

  it('applies a tall vertical fit when rendering MacKay binomial delimiters', () => {
    const document = loadMacKayDocument();
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer({ pagePadding: 16, scale: 1 });

    renderer.render(canvas, document, 13);

    const delimiterDraws = context.textDraws.filter(
      (draw) => (draw.text === '(' || draw.text === ')') && draw.font.includes("'CMEX10'")
    );

    expect(delimiterDraws.length).toBeGreaterThanOrEqual(4);
    expect(delimiterDraws.some((draw) => draw.scaleY > 2)).toBe(true);
    expect(context.textDraws.some((draw) => draw.text === '( )')).toBe(false);
  });

  it('renders MacKay page-14 Poisson symbols with lambda, set-membership, radicals, and pi', () => {
    const document = loadMacKayDocument();
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer({ pagePadding: 16, scale: 1 });

    renderer.render(canvas, document, 14);
    const drawTexts = context.textDraws.map((draw) => draw.text);

    expect(drawTexts.some((text) => text.includes('λ'))).toBe(true);
    expect(drawTexts.some((text) => text.includes('∈'))).toBe(true);
    expect(drawTexts.some((text) => text.includes('{'))).toBe(true);
    expect(drawTexts.some((text) => text.includes('}'))).toBe(true);
    expect(drawTexts.some((text) => text.includes('√'))).toBe(true);
    expect(drawTexts.some((text) => text.includes('π'))).toBe(true);
    expect(drawTexts.some((text) => text.includes('['))).toBe(true);
    expect(drawTexts.some((text) => text.includes(']'))).toBe(true);
    expect(drawTexts.some((text) => text.includes('≈ π'))).toBe(false);
    expect(drawTexts.some((text) => text.includes('Appr oximating'))).toBe(false);
  });

  it('renders repaired MacKay prose ligatures and split words on sampled body pages', () => {
    const document = loadMacKayDocument();
    const page85Context = new RecordingContext();
    const page85Canvas = new RecordingCanvas(page85Context);
    const page110Context = new RecordingContext();
    const page110Canvas = new RecordingCanvas(page110Context);
    const renderer = new CanvasRenderer({ pagePadding: 16, scale: 1 });

    renderer.render(page85Canvas, document, 85);
    renderer.render(page110Canvas, document, 110);

    const page85Texts = page85Context.textDraws.map((draw) => draw.text);
    const page110Texts = page110Context.textDraws.map((draw) => draw.text);
    const page85Joined = page85Texts.join(' ');
    const page110Joined = page110Texts.join(' ');

    expect(page85Joined).toContain('five-character');
    expect(page85Joined).toContain('average information content per character');
    expect(page85Joined).toContain('first letter');
    expect(page85Joined).toContain('thus highly variable');
    expect(page110Joined).toContain('prefix code');
    expect(page110Joined).toContain('confirming');
    expect(page110Joined).toContain('defining implicit probabilities');
    expect(page110Joined).toContain('Huffman coding');
  });

  it('renders Bezier path geometry for the MacKay contents page instead of flattening it to line segments', () => {
    const document = loadMacKayDocument();
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer({ pagePadding: 16, scale: 1 });

    renderer.render(canvas, document, 9);

    expect(context.operations.some((operation) => operation.startsWith('bezierCurveTo:'))).toBe(true);
  });

  it('renders repaired MacKay lexical boundaries on additional body pages', () => {
    const document = loadMacKayDocument();
    const page150Context = new RecordingContext();
    const page150Canvas = new RecordingCanvas(page150Context);
    const page253Context = new RecordingContext();
    const page253Canvas = new RecordingCanvas(page253Context);
    const page578Context = new RecordingContext();
    const page578Canvas = new RecordingCanvas(page578Context);
    const renderer = new CanvasRenderer({ pagePadding: 16, scale: 1 });

    renderer.render(page150Canvas, document, 150);
    renderer.render(page253Canvas, document, 253);
    renderer.render(page578Canvas, document, 578);

    const page150Joined = page150Context.textDraws.map((draw) => draw.text).join(' ');
    const page253Joined = page253Context.textDraws.map((draw) => draw.text).join(' ');
    const page578Joined = page578Context.textDraws.map((draw) => draw.text).join(' ');

    expect(page150Joined).toContain('communication over noisy channels');
    expect(page150Joined).toContain('do with entropy');
    expect(page150Joined).toContain('joint entropy');
    expect(page150Joined).toContain('conditional entropy');
    expect(page253Joined).toContain('behind you');
    expect(page578Joined).toContain('average entropy');
  });

  it('does not render stray CMEX fallback glyphs on the MacKay page-13 variance formula', () => {
    const document = loadMacKayDocument();
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer({ pagePadding: 16, scale: 1 });

    renderer.render(canvas, document, 13);
    const relevantDraws = context.textDraws.filter(
      (draw) => draw.translateX >= 120 && draw.translateX <= 340 && draw.translateY >= 640 && draw.translateY <= 690
    );
    const drawTexts = relevantDraws.map((draw) => draw.text);

    expect(drawTexts.some((text) => text.includes('fi'))).toBe(false);
    expect(drawTexts.some((text) => text.includes('¹'))).toBe(false);
  });

  it('renders the MacKay page-15 LINE10 diagram as arrows and diagonals instead of raw fallback glyphs', () => {
    const document = loadMacKayDocument();
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer({ pagePadding: 16, scale: 1 });

    renderer.render(canvas, document, 15);
    const joinedText = context.textDraws.map((draw) => draw.text).join(' ');
    const relevantDraws = context.textDraws.filter(
      (draw) => draw.font.includes("'LINE10'") && draw.translateX >= 430 && draw.translateX <= 510 && draw.translateY >= 400 && draw.translateY <= 570
    );
    const drawTexts = relevantDraws.map((draw) => draw.text);
    const titleDraw = context.textDraws.find(
      (draw) => draw.text.includes('Introduction to Information Theory') && draw.translateY >= 220 && draw.translateY <= 260
    );

    expect(joinedText).toContain('Introduction to Information Theory');
    expect(joinedText).toContain('fundamental problem');
    expect(joinedText).toContain('analogue telephone line');
    expect(joinedText).not.toContain('Intro duction');
    expect(joinedText).not.toContain('ffl');
    expect(joinedText).toContain('•');
    expect(drawTexts.some((text) => text.includes('→'))).toBe(true);
    expect(drawTexts.some((text) => text.includes('↗'))).toBe(true);
    expect(drawTexts.some((text) => text.includes('↘'))).toBe(true);
    expect(drawTexts.some((text) => text.includes('╱'))).toBe(true);
    expect(drawTexts.some((text) => text.includes('╲'))).toBe(true);
    expect(drawTexts.some((text) => text.includes('R @'))).toBe(false);
    expect(drawTexts.some((text) => text.includes('@'))).toBe(false);
    expect(titleDraw?.font.startsWith('italic')).toBe(true);
  });

  it('keeps MacKay CCITT illustration XObjects available to the renderer on pages 16 and 19', () => {
    const document = loadMacKayDocument();
    const page16 = document.getPage(16);
    const page19 = document.getPage(19);

    expect(page16).toBeDefined();
    expect(page19).toBeDefined();

    const page16Figures = page16!.imageItems.filter((item) => !item.name.startsWith('inline'));
    const page19Figures = page19!.imageItems.filter((item) => !item.name.startsWith('inline'));

    expect(page16Figures).toHaveLength(2);
    expect(page19Figures.length).toBeGreaterThanOrEqual(4);
    expect(page16Figures.every((item) => Boolean(item.pixels))).toBe(true);
    expect(page19Figures.every((item) => Boolean(item.pixels))).toBe(true);
  });

  it('keeps MacKay page-17 inline image masks available for diagram rendering', () => {
    const document = loadMacKayDocument();
    const page = document.getPage(17);

    expect(page).toBeDefined();

    const masks = page!.imageItems.filter((item) => Boolean(item.mask));

    expect(masks.length).toBeGreaterThanOrEqual(20);
    expect(masks.some((item) => item.bounds.maxX - item.bounds.minX > 100 && item.bounds.maxY - item.bounds.minY < 2)).toBe(true);
    expect(masks.some((item) => item.bounds.maxY - item.bounds.minY > 25 && item.bounds.maxX - item.bounds.minX < 2)).toBe(true);
  });

  it('renders the MacKay page-17 LINE10 figure with vertical arrows instead of fallback digits', () => {
    const document = loadMacKayDocument();
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer({ pagePadding: 16, scale: 1 });

    renderer.render(canvas, document, 17);
    const relevantDraws = context.textDraws.filter(
      (draw) => draw.font.includes("'LINE10'") && draw.translateX >= 140 && draw.translateX <= 310 && draw.translateY >= 90 && draw.translateY <= 245
    );
    const drawTexts = relevantDraws.map((draw) => draw.text);

    expect(drawTexts.some((text) => text.includes('↑'))).toBe(true);
    expect(drawTexts.some((text) => text.includes('↓'))).toBe(true);
    expect(drawTexts.some((text) => text.includes('6'))).toBe(false);
    expect(drawTexts.some((text) => text.includes('?'))).toBe(false);
  });

  it('renders Type3 OCR overlays on scanned pages', () => {
    const document = loadAdobeScannedDocument();
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer({ pagePadding: 16, scale: 1 });

    renderer.render(canvas, document, 5);

    expect(context.pathPaints.length).toBeGreaterThan(0);
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
