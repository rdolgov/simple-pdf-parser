import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { convertLayoutToHtml } from '../src/html/htmlLayoutConverter.js';
import {
  buildLinkifiedTextFromLines,
  parseLinkifiedTextSegments
} from '../src/html/linkifiedTextSegments.js';
import { PDFDocument } from '../src/pdfDocument.js';
import { CanvasRenderer } from '../src/viewer/canvasRenderer.js';
import type { PDFTextItem } from '../src/types.js';
import { deserializePdfPage, serializePdfPage } from '../testApp/src/workers/pdfPageTransfer.js';
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

  it('keeps word2vec page-1 title-case names and title words intact', () => {
    const document = loadWordEmbeddingsDocument();
    const page = document.getPage(1);

    expect(page).toBeDefined();

    const pageText = page!.textItems.map((item) => item.text).join('\n');

    expect(pageText).toContain('Vector Space');
    expect(pageText).toContain('Tomas Mikolov');
    expect(pageText).toContain('Kai Chen');
    expect(pageText).toContain('Greg Corrado');
    expect(pageText).toContain('Jeffrey Dean');
    expect(pageText).not.toContain('VectorS pace');
    expect(pageText).not.toContain('To masMikolov');
    expect(pageText).not.toContain('KaiChen');
    expect(pageText).not.toContain('GregCorr a do');
    expect(pageText).not.toContain('JeffreyDe an');
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

  it('uses a math-aware browser fallback stack for non-vector Computer Modern symbols', () => {
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

  it('preserves the Figure 1 page image across worker-style page transfers', () => {
    const document = loadAttentionPaperDocument();
    const page = document.getPage(3);

    expect(page).toBeDefined();

    const figureImage = page!.imageItems.find((item) => item.name === 'Im1');

    expect(figureImage).toBeDefined();
    expect(figureImage!.dataUri).toBeUndefined();
    expect(figureImage!.pixels).toBeDefined();

    const transferred = structuredClone(serializePdfPage(page!));
    const restoredPage = deserializePdfPage(transferred);
    const restoredImage = restoredPage.imageItems.find((item) => item.name === figureImage!.name);

    expect(restoredImage).toBeDefined();
    expect(restoredImage!.pixels).toBeDefined();
    expect(restoredImage!.pixels!.width).toBe(figureImage!.pixels!.width);
    expect(restoredImage!.pixels!.height).toBe(figureImage!.pixels!.height);
    expect(restoredImage!.bounds).toEqual(figureImage!.bounds);
  });

  it('renders the NIPS conclusion heading without zero-advance fake spaces inside the word', () => {
    const document = loadAttentionPaperDocument();
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer({ pagePadding: 16, scale: 1 });

    renderer.render(canvas, document, 9);

    expect(context.textDraws.some((draw) => draw.text === '7 Conclusion')).toBe(true);
    expect(context.textDraws.some((draw) => draw.text.includes('Conclus i on'))).toBe(false);
  });

  it('keeps the wrapped tensor2tensor GitHub URL contiguous for linkification', () => {
    const document = loadAttentionPaperDocument();
    const layout = convertLayoutToHtml({ pages: document.pages, fontResources: document.getFontResources() });
    const page = layout.pages.find((entry) => entry.number === 9);

    expect(page).toBeDefined();

    const block = page!.content.find(
      (entry) =>
        (entry.type === 'paragraph' || entry.type === 'heading') &&
        entry.text.includes('The code we used to train and evaluate our models is available at')
    );

    expect(block).toBeDefined();
    expect(block?.type).toBe('paragraph');

    const linkifiedText = buildLinkifiedTextFromLines(block!.lines);
    const urlSegments = parseLinkifiedTextSegments(linkifiedText).filter((segment) => segment.type === 'url');

    expect(linkifiedText).toContain('https://github.com/tensorflow/tensor2tensor.');
    expect(urlSegments).toEqual(
      expect.arrayContaining([
        {
          type: 'url',
          content: 'https://github.com/tensorflow/tensor2tensor',
          href: 'https://github.com/tensorflow/tensor2tensor'
        }
      ])
    );
  });

  it('repairs suspicious intra-word spacing across the NIPS paper body and references', () => {
    const document = loadAttentionPaperDocument();
    const expectations = [
      { page: 2, contains: 'including reading comprehension' },
      { page: 2, contains: 'sequential nature precludes parallelization within training examples' },
      { page: 2, contains: 'a recurrent network' },
      { page: 2, contains: 'a representation of the sequence' },
      { page: 3, contains: 'a residual connection' },
      { page: 3, contains: 'a weighted sum' },
      { page: 4, contains: 'packed together' },
      { page: 4, contains: 'theoretical complexity' },
      { page: 4, contains: 'matrix multiplication code' },
      { page: 5, contains: 'linear transformation' },
      { page: 6, contains: 'Convolutional' },
      { page: 6, contains: 'Learning long-range' },
      { page: 6, contains: 'combination of positions in the input' },
      { page: 6, contains: 'whereas a recurrent layer requires' },
      { page: 6, contains: 'representation dimensionality' },
      { page: 6, contains: 'performance for tasks involving' },
      { page: 7, contains: 'respective output position' },
      { page: 7, contains: 'This would increase the maximum' },
      { page: 7, contains: 'forward layer' },
      { page: 7, contains: 'interpretable models' },
      { page: 7, contains: 'containing approximately' },
      { page: 7, contains: 'throughout the paper' },
      { page: 7, contains: 'thereafter proportionally' },
      { page: 7, contains: '5.4 Regularization' },
      { page: 8, contains: 'The Transformer' },
      { page: 8, contains: 'minute intervals' },
      { page: 8, contains: 'attention heads and the attention key' },
      { page: 8, contains: 'attention is 0.9 BLEU worse' },
      { page: 9, contains: 'to investigate local' },
      { page: 9, contains: 'corrections and inspiration' },
      { page: 10, contains: 'Recognition' },
      { page: 10, contains: 'International Conference' },
      { page: 10, contains: 'Alexander M. Rush' },
      { page: 10, contains: 'replace attention' },
      { page: 10, contains: 'Xception' },
      { page: 11, contains: 'Christopher D Manning' },
      { page: 11, contains: 'Dipanjan Das' },
      { page: 11, contains: 'Krzysztof Maziarz' },
      { page: 11, contains: 'Srivastava' },
      { page: 11, contains: 'inception architecture' }
    ];
    const regressions = [
      { page: 7, excludes: 'Regul arizati on' },
      { page: 8, excludes: 'at tenti on' },
      { page: 10, excludes: 'Reco gniti on' },
      { page: 10, excludes: 'In terna tional Conference' },
      { page: 10, excludes: 'Alex an derM. Rush' },
      { page: 10, excludes: 'Xcepti on' },
      { page: 11, excludes: 'Dipanj anD as' }
    ];

    for (const expectation of expectations) {
      const page = document.getPage(expectation.page);
      expect(page).toBeDefined();

      const pageText = page!.textItems.map((item) => item.text).join(' ');
      expect(pageText).toContain(expectation.contains);
    }

    for (const regression of regressions) {
      const page = document.getPage(regression.page);
      expect(page).toBeDefined();

      const pageText = page!.textItems.map((item) => item.text).join(' ');
      expect(pageText).not.toContain(regression.excludes);
    }
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

  it('renders MacKay binomial delimiters as vector outlines instead of scaled CMEX text glyphs', () => {
    const document = loadMacKayDocument();
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer({ pagePadding: 16, scale: 1 });

    renderer.render(canvas, document, 13);

    const delimiterDraws = context.textDraws.filter(
      (draw) => (draw.text === '(' || draw.text === ')') && draw.font.includes("'CMEX10'")
    );

    expect(delimiterDraws.length).toBe(0);
    expect(context.textDraws.some((draw) => draw.text === '( )')).toBe(false);
    expect(context.pathPaints.some((paint) => paint.kind === 'stroke')).toBe(true);
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
    expect(drawTexts.some((text) => text.includes('≈ π'))).toBe(false);
    expect(drawTexts.some((text) => text.includes('Appr oximating'))).toBe(false);
    expect(context.pathPaints.some((paint) => paint.kind === 'stroke')).toBe(true);
  });

  it('renders the MacKay page-13 display summation as a vector operator between its limits', () => {
    const document = loadMacKayDocument();
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer({ pagePadding: 16, scale: 1 });

    renderer.render(canvas, document, 13);

    const displaySumDraw = context.textDraws.find((draw) => {
      const x = draw.translateX || draw.x;
      const y = draw.translateY || draw.y;
      return x >= 220 && x <= 240 && y >= 450 && y <= 470 && draw.text === '∑';
    });

    expect(displaySumDraw).toBeUndefined();
    expect(context.pathPaints.some((paint) => paint.kind === 'stroke')).toBe(true);
  });

  it('renders the MacKay page-14 italic heading with per-glyph advances instead of a single browser-shaped word', () => {
    const document = loadMacKayDocument();
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer({ pagePadding: 16, scale: 1 });

    renderer.render(canvas, document, 14);

    const headingDraws = context.textDraws.filter((draw) => {
      const x = draw.translateX || draw.x;
      const y = draw.translateY || draw.y;
      return x >= 75 && x <= 215 && y >= 125 && y <= 145;
    });

    expect(headingDraws.some((draw) => draw.text === 'Approximating')).toBe(false);
    expect(headingDraws.some((draw) => draw.text === 'A' && draw.font.includes("'CMTI12'"))).toBe(true);
    expect(headingDraws.filter((draw) => draw.text === 'p' && draw.font.includes("'CMTI12'")).length).toBeGreaterThanOrEqual(2);
    expect(headingDraws.some((draw) => draw.text === '(')).toBe(false);
    expect(headingDraws.some((draw) => draw.text === ')')).toBe(false);
  });

  it('renders MacKay page-18 repeated math variables using preserved glyph advances', () => {
    const document = loadMacKayDocument();
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer({ pagePadding: 16, scale: 1 });

    renderer.render(canvas, document, 18);

    const equationDraws = context.textDraws.filter((draw) => {
      const x = draw.translateX || draw.x;
      const y = draw.translateY || draw.y;
      return x >= 180 && x <= 320 && y >= 350 && y <= 390;
    });
    const repeatedRDraws = equationDraws.filter(
      (draw) => draw.text === 'r' && draw.font.includes("'CMMI10~80'")
    );
    const indexDraws = equationDraws.filter((draw) => /^[123]$/.test(draw.text));

    expect(repeatedRDraws.length).toBeGreaterThanOrEqual(3);
    expect(indexDraws.length).toBeGreaterThanOrEqual(3);
    expect(equationDraws.some((draw) => draw.text === 'rrr')).toBe(false);
    expect(equationDraws.some((draw) => draw.text === '1 2 3')).toBe(false);
  });

  it('renders the MacKay page-18 product operator as a math product instead of a literal Y', () => {
    const document = loadMacKayDocument();
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer({ pagePadding: 16, scale: 1 });

    renderer.render(canvas, document, 18);

    const equationDraws = context.textDraws.filter((draw) => {
      const x = draw.translateX || draw.x;
      const y = draw.translateY || draw.y;
      return x >= 175 && x <= 340 && y >= 595 && y <= 622;
    });

    expect(equationDraws.some((draw) => draw.text === '∏')).toBe(false);
    expect(equationDraws.some((draw) => draw.text === 'Y')).toBe(false);
    expect(equationDraws.some((draw) => draw.text === 'N')).toBe(true);
    expect(equationDraws.some((draw) => draw.text === '=1')).toBe(true);
    expect(context.pathPaints.some((paint) => paint.kind === 'stroke')).toBe(true);
  });

  it('renders repaired MacKay prose ligatures and split words on sampled body pages', () => {
    const document = loadMacKayDocument();
    const page85 = document.getPage(85);
    const page110 = document.getPage(110);

    expect(page85).toBeDefined();
    expect(page110).toBeDefined();

    const page85Joined = page85!.textItems.map((item) => item.text).join(' ');
    const page110Joined = page110!.textItems.map((item) => item.text).join(' ');

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

  it('renders the MacKay contents page without split intra-word spacing in chapter titles', () => {
    const document = loadMacKayDocument();
    const page = document.getPage(9);
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer({ pagePadding: 16, scale: 1 });

    expect(page).toBeDefined();

    const pageText = page!.textItems.map((item) => item.text).join(' ');
    expect(pageText).toContain('Exact Marginalization');
    expect(pageText).toContain('Codes for Integers');
    expect(pageText).toContain("Model Comparison and Occam's Razor");
    expect(pageText).toContain('Bayesian Inference and Sampling Theory');
    expect(pageText).toContain('Random Inference Topics');
    expect(pageText).toContain('Neural networks');
    expect(pageText).toContain('The Single Neuron as a Classifier');
    expect(pageText).toContain('Digital Fountain Codes');
    expect(pageText).not.toContain('Marg in a lizati on');
    expect(pageText).not.toContain('Codes for In tegers');
    expect(pageText).not.toContain('Model Compar is on');
    expect(pageText).not.toContain('Bayes i an');
    expect(pageText).not.toContain('To pics');
    expect(pageText).not.toContain('SingleNeur on');
    expect(pageText).not.toContain('Founta in');

    renderer.render(canvas, document, 9);

    expect(context.textDraws.some((draw) => draw.text.includes('Marg in a lizati on'))).toBe(false);
    expect(context.textDraws.some((draw) => draw.text.includes('Codes for In tegers'))).toBe(false);
    expect(context.textDraws.some((draw) => draw.text.includes('Model Compar is on'))).toBe(false);
    expect(context.textDraws.some((draw) => draw.text.includes('Bayes i an'))).toBe(false);
    expect(context.textDraws.some((draw) => draw.text.includes('To pics'))).toBe(false);
    expect(context.textDraws.some((draw) => draw.text.includes('SingleNeur on'))).toBe(false);
    expect(context.textDraws.some((draw) => draw.text.includes('Founta in'))).toBe(false);
  });

  it('renders the MacKay roadmap pages without split contents-page carryover words', () => {
    const document = loadMacKayDocument();
    const page3 = document.getPage(3);
    const page4 = document.getPage(4);
    const page5 = document.getPage(5);
    const page6 = document.getPage(6);
    const page7 = document.getPage(7);

    expect(page3).toBeDefined();
    expect(page4).toBeDefined();
    expect(page5).toBeDefined();
    expect(page6).toBeDefined();
    expect(page7).toBeDefined();

    const page3Text = page3!.textItems.map((item) => item.text).join(' ');
    const page4Text = page4!.textItems.map((item) => item.text).join(' ');
    const page5Text = page5!.textItems.map((item) => item.text).join(' ');
    const page6Text = page6!.textItems.map((item) => item.text).join(' ');
    const page7Text = page7!.textItems.map((item) => item.text).join(' ');

    expect(page3Text).toContain('Introduction to Information Theory');
    expect(page3Text).toContain('Further Topics in Information Theory');
    expect(page4Text).toContain('Random Inference Topics');
    expect(page4Text).toContain('The Single Neuron as a Classifier');
    expect(page4Text).toContain('Digital Fountain Codes');
    expect(page5Text).toContain('Bayesian data modelling');
    expect(page5Text).toContain('I teach in Cambridge');
    expect(page5Text).toContain('pattern recognition');
    expect(page6Text).toContain('Random Inference Topics');
    expect(page7Text).toContain('Further Topics in Information Theory');

    expect(page3Text).not.toContain('I for mati on');
    expect(page4Text).not.toContain('To pics');
    expect(page4Text).not.toContain('SingleNeur on');
    expect(page5Text).not.toContain('Bayes i and at a');
    expect(page5Text).not.toContain('I each');
    expect(page6Text).not.toContain('NeuralNetworks');
    expect(page7Text).not.toContain('Founta in');
  });

  it('renders repaired MacKay lexical boundaries on additional body pages', () => {
    const document = loadMacKayDocument();
    const page150 = document.getPage(150);
    const page253 = document.getPage(253);
    const page578 = document.getPage(578);

    expect(page150).toBeDefined();
    expect(page253).toBeDefined();
    expect(page578).toBeDefined();

    const page150Joined = page150!.textItems.map((item) => item.text).join(' ');
    const page253Joined = page253!.textItems.map((item) => item.text).join(' ');
    const page578Joined = page578!.textItems.map((item) => item.text).join(' ');

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
    const page = document.getPage(15);
    const context = new RecordingContext();
    const canvas = new RecordingCanvas(context);
    const renderer = new CanvasRenderer({ pagePadding: 16, scale: 1 });

    expect(page).toBeDefined();

    renderer.render(canvas, document, 15);
    const joinedText = page!.textItems.map((item) => item.text).join(' ');
    const relevantDraws = context.textDraws.filter(
      (draw) => draw.font.includes("'LINE10'") && draw.translateX >= 430 && draw.translateX <= 510 && draw.translateY >= 400 && draw.translateY <= 570
    );
    const drawTexts = relevantDraws.map((draw) => draw.text);

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

  it('replaces MacKay brace-construction fragments instead of rendering raw CMEX fallback text', () => {
    const document = loadMacKayDocument();
    const page17Context = new RecordingContext();
    const page17Canvas = new RecordingCanvas(page17Context);
    const page19Context = new RecordingContext();
    const page19Canvas = new RecordingCanvas(page19Context);
    const renderer = new CanvasRenderer({ pagePadding: 16, scale: 1 });

    renderer.render(page17Canvas, document, 17);
    renderer.render(page19Canvas, document, 19);

    const page17FigureDraws = page17Context.textDraws.filter((draw) => {
      const x = draw.translateX || draw.x;
      const y = draw.translateY || draw.y;
      return x >= 150 && x <= 340 && y >= 675 && y <= 705;
    });
    const page19FigureDraws = page19Context.textDraws.filter((draw) => {
      const x = draw.translateX || draw.x;
      const y = draw.translateY || draw.y;
      return x >= 185 && x <= 375 && y >= 275 && y <= 370;
    });

    expect(page17FigureDraws.some((draw) => draw.text === 'z}|')).toBe(false);
    expect(page17FigureDraws.some((draw) => draw.text === '{')).toBe(false);

    expect(page19FigureDraws.some((draw) => draw.text === 'z}|')).toBe(false);
    expect(page19FigureDraws.some((draw) => draw.text === '{')).toBe(false);
    expect(page19FigureDraws.some((draw) => draw.text === '{z')).toBe(false);
    expect(page19FigureDraws.some((draw) => draw.text === '|')).toBe(false);
    expect(page19FigureDraws.some((draw) => draw.text === '}')).toBe(false);
    expect(page19FigureDraws.some((draw) => draw.text === '?')).toBe(false);
    expect(page19FigureDraws.some((draw) => draw.text === '*')).toBe(true);
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
