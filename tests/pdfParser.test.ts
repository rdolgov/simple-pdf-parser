import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { PDFDocument } from '../src/pdfDocument.js';

describe('PDFParser', () => {
  it('extracts text items with bounds from a simple PDF page', () => {
    const fixtureUrl = new URL('./__fixtures__/simple.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);

    expect(document.pages).toHaveLength(1);
    const [page] = document.pages;

    expect(page.textItems).toHaveLength(2);
    expect(page.imageItems).toHaveLength(0);
    expect(page.size).toEqual({ width: 612, height: 792 });
    expect(page.textItems[0].text).toBe('Hello, PDF!');
    expect(page.textItems[0].bounds.minX).toBeCloseTo(100, 5);
    expect(page.textItems[0].bounds.minY).toBeCloseTo(700, 5);
    expect(page.textItems[1].text).toBe('World');
    expect(page.textItems[1].bounds.minX).toBeCloseTo(100, 5);
    expect(page.textItems[1].bounds.minY).toBeCloseTo(682, 5);
  });

  it('falls back to scanning raw content when page objects are missing', () => {
    const minimal = `%PDF-1.3
BT
(Hi) Tj
ET
%%EOF`;

    const document = PDFDocument.from(minimal);
    expect(document.pages).toHaveLength(1);
    expect(document.pages[0].textItems[0].text).toBe('Hi');
  });

  it('decodes flate-compressed streams referenced via xref table', () => {
    const fixtureUrl = new URL('./__fixtures__/compressed.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);

    expect(document.pages).toHaveLength(1);
    const [page] = document.pages;

    expect(page.textItems).toHaveLength(2);
    expect(page.textItems[0].text).toBe('Compressed Hello');
    expect(page.textItems[0].bounds.minX).toBeCloseTo(120, 5);
    expect(page.textItems[0].bounds.minY).toBeCloseTo(720, 5);
    expect(page.textItems[1].text).toBe('again');
    expect(page.textItems[1].bounds.minX).toBeCloseTo(120, 5);
    expect(page.textItems[1].bounds.minY).toBeCloseTo(702, 5);
  });

  it('uses ToUnicode maps to decode glyph codes into readable text', () => {
    const fixtureUrl = new URL('./__fixtures__/unicode.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);

    expect(document.pages).toHaveLength(1);
    const [page] = document.pages;

    expect(page.textItems.map((item) => item.text)).toEqual(['Hello', ' World']);
    expect(page.textItems[0].bounds.minX).toBeCloseTo(100, 5);
    expect(page.textItems[0].bounds.minY).toBeCloseTo(700, 5);
    expect(page.textItems[1].bounds.minX).toBeCloseTo(100, 5);
    expect(page.textItems[1].bounds.minY).toBeCloseTo(676, 5);
  });

  it('resolves inherited resources when fonts are defined on ancestor pages', () => {
    const fixtureUrl = new URL('./__fixtures__/unicode_inherited.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);

    expect(document.pages).toHaveLength(1);
    const [page] = document.pages;

    expect(page.textItems.map((item) => item.text)).toEqual(['Test', ' Docu']);
  });

  it('applies encoding differences when ToUnicode maps are missing', () => {
    const fixtureUrl = new URL('./__fixtures__/latin_encoding.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);

    expect(document.pages).toHaveLength(1);
    const [page] = document.pages;
    expect(page.textItems.map((item) => item.text)).toEqual(['Hello', ' Wold']);
  });

  it('extracts readable text from Biology reference PDF', () => {
    const fixtureUrl = new URL('../pdfs/Biology.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const firstPage = document.getPage(1);

    expect(firstPage).toBeDefined();
    const pageText = firstPage!.textItems.map((item) => item.text.replace(/\s+/g, ' ')).join(' ').replace(/\s+/g, ' ').trim();
    expect(pageText.startsWith('Biology is the scientiﬁc study of life. [ 1 ] [ 2 ] [ 3 ] It is a natural science')).toBe(true);
  });

  it('parses content streams when /Contents arrays lack whitespace before the bracket', () => {
    const fixtureUrl = new URL('../pdfs/FY18_Q1_Transcript_2018-03-15.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const firstPage = document.getPage(1);

    expect(firstPage).toBeDefined();
    expect(firstPage!.imageItems.length).toBeGreaterThanOrEqual(0);
    expect(firstPage!.textItems.length).toBeGreaterThan(0);
    expect(document.getText()).toContain('Client Id: 77');
  });

  it('decodes streams whose lengths are provided via indirect references', () => {
    const fixtureUrl = new URL('../pdfs/InformationTheoryByMacKay.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);

    expect(document.pages.length).toBeGreaterThan(0);
    expect(document.getText()).toContain('Cambridge University Press');
  });

  it('reads text embedded inside form XObjects', () => {
    const fixtureUrl = new URL('../pdfs/Lakeview Terrace Litigation Notice - April 2025.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const text = document.getText();

    expect(text).toContain('April 14, 2025');
  });

  it('preserves the word2vec Figure 1 form XObject geometry and labels on page 5', () => {
    const fixtureUrl = new URL('../pdfs/1301.3781v3.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page = document.getPage(5);
    const topLabels = page!.textItems
      .filter((item) => item.bounds.minY >= 670)
      .sort((left, right) => left.bounds.minX - right.bounds.minX)
      .map((item) => item.text)
      .join('')
      .replace(/\s+/g, '');

    expect(page).toBeDefined();
    expect(page!.pathItems?.length ?? 0).toBeGreaterThan(20);
    expect(topLabels).toContain('INPUTPROJECTIONOUTPUTINPUTPROJECTIONOUTPUT');
    expect(page!.textItems.some((item) => item.text.includes('CBOW'))).toBe(true);
    expect(page!.textItems.some((item) => item.text.includes('Skip-gram'))).toBe(true);
    expect(page!.textItems.some((item) => item.text === 'SUM')).toBe(true);
    expect(page!.textItems.some((item) => item.text === 'w(t-2)')).toBe(true);
  });

  it('detects image positions and sizes for pages with image XObjects', () => {
    const fixtureUrl = new URL('../pdfs/Lakeview Terrace Litigation Notice - April 2025.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const [page] = document.pages;

    expect(page.imageItems.length).toBeGreaterThan(0);
    for (const image of page.imageItems) {
      expect(image.bounds.maxX).toBeGreaterThan(image.bounds.minX);
      expect(image.bounds.maxY).toBeGreaterThan(image.bounds.minY);
      if (image.dataUri) {
        expect(image.dataUri.startsWith('data:image/')).toBe(true);
      }
    }
  });

  it('extracts images from PDFs using cross-reference streams and object streams', () => {
    const fixtureUrl = new URL(
      '../pdfs/Leadership, Trust, And AI_ Dan Durn\u2019s Journey As Adobe\u2019s CFO.pdf',
      import.meta.url
    );
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);

    expect(document.pages).toHaveLength(7);

    // Every page should have an image (these are scanned page images)
    for (const page of document.pages) {
      expect(page.imageItems.length).toBeGreaterThanOrEqual(1);
      const img = page.imageItems[0];
      expect(img.bounds.maxX).toBeGreaterThan(img.bounds.minX);
      expect(img.bounds.maxY).toBeGreaterThan(img.bounds.minY);
      // Most pages have JPEG data URIs
      if (img.dataUri) {
        expect(img.dataUri.startsWith('data:image/jpeg;base64,')).toBe(true);
      }
    }
  });

  it('applies Type3 CharProc cm transforms to OCR header glyph paths', () => {
    const fixtureUrl = new URL(
      '../pdfs/Leadership, Trust, And AI_ Dan Durn\u2019s Journey As Adobe\u2019s CFO.pdf',
      import.meta.url
    );
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page = document.getPage(5);

    expect(page).toBeDefined();
    const headerItem = page!.textItems.find((item) => item.bounds.maxY > 760 && item.type3Glyphs?.length === 1);
    expect(headerItem).toBeDefined();

    const moveTo = headerItem!.type3Glyphs![0].pathCommands.find((command) => command.op === 'M');
    expect(moveTo).toBeDefined();
    expect(moveTo!.x).toBeCloseTo(0.50342, 4);
    expect(moveTo!.y).toBeCloseTo(0.084473, 4);
  });

  it('resolves indirect indexed color spaces for scanned page images', () => {
    const fixtureUrl = new URL(
      '../pdfs/Leadership, Trust, And AI_ Dan Durn\u2019s Journey As Adobe\u2019s CFO.pdf',
      import.meta.url
    );
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page = document.getPage(5);

    expect(page).toBeDefined();
    expect(page!.imageItems.length).toBeGreaterThan(0);

    const image = page!.imageItems[0];
    expect(image.sourceWidth).toBe(2317);
    expect(image.sourceHeight).toBe(3067);
    expect(image.pixels).toBeDefined();
    expect(readPixel(image.pixels!, 100, 100)).toEqual([255, 255, 255, 255]);
    expect(readPixel(image.pixels!, 500, 300)).toEqual([51, 51, 51, 255]);
  });

  it('decodes indexed-color images without duplicating narrow RGB bands', () => {
    const fixtureUrl = new URL('../pdfs/platonicspaces.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page = document.getPage(8);

    expect(page).toBeDefined();
    expect(page!.imageItems.length).toBeGreaterThan(0);

    const image = page!.imageItems[0];
    expect(image.sourceWidth).toBe(1024);
    expect(image.sourceHeight).toBe(732);
    expect(image.pixels).toBeDefined();
    expect(image.pixels!.width).toBe(1024);
    expect(image.pixels!.height).toBe(732);

    const topLeft = readPixel(image.pixels!, 0, 0);
    const darkPatch = readPixel(image.pixels!, 100, 100);
    const centerPatch = readPixel(image.pixels!, 512, 366);

    expect(topLeft).toEqual([192, 192, 192, 255]);
    expect(darkPatch).toEqual([8, 8, 8, 255]);
    expect(centerPatch).toEqual([160, 160, 160, 255]);
  });

  it('merges adjacent glyph runs on the same baseline', () => {
    const fixtureUrl = new URL('../pdfs/NIPS-2017-attention-is-all-you-need-Paper.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page = document.getPage(1);

    expect(page).toBeDefined();
    const mergedLine = page!.textItems.find((item) =>
      item.text.startsWith('The dominant sequence transduction models are based on complex recurrent or')
    );
    expect(mergedLine).toBeDefined();
  });

  it('merges split legend words on the MacKay exercise-summary page', () => {
    const fixtureUrl = new URL('../pdfs/InformationTheoryByMacKay.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page = document.getPage(11);

    expect(page).toBeDefined();
    expect(page!.textItems.some((item) => item.text === 'Summary of codes for exercises')).toBe(true);
    expect(page!.textItems.some((item) => item.text === 'Especially recommended')).toBe(true);
    expect(page!.textItems.some((item) => item.text.includes('Medium (quarter hour)'))).toBe(true);
    expect(page!.textItems.some((item) => item.text === 'Parts require a computer')).toBe(true);
    expect(page!.textItems.some((item) => item.text === 'About the exercises')).toBe(true);
    expect(page!.textItems.some((item) => item.text === 'About this edition')).toBe(true);
    expect(
      page!.textItems.some(
        (item) => item.text === 'In addition, exercises that are especially recommended are marked by a'
      )
    ).toBe(true);
  });

  it('exposes embedded Type1C font programs and glyph codes for MacKay Computer Modern text', () => {
    const fixtureUrl = new URL('../pdfs/InformationTheoryByMacKay.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const fontResources = document.getFontResources();
    const page = document.getPage(14);

    expect(Object.keys(fontResources).length).toBeGreaterThan(0);
    expect(Object.values(fontResources).some((resource) => resource.fontFileSubtype === 'Type1C')).toBe(true);

    const heading = page?.textItems.find((item) => item.text.includes('Approximating'));

    expect(heading).toBeDefined();
    expect(heading?.fontResourceKey).toBeDefined();
    expect(heading?.glyphSpans?.length).toBeGreaterThan(0);
    expect(heading?.glyphSpans?.every((span) => typeof span.glyphCode === 'number')).toBe(true);

    const headingFont = heading?.fontResourceKey ? fontResources[heading.fontResourceKey] : undefined;
    expect(headingFont?.data.length ?? 0).toBeGreaterThan(1000);
    expect(headingFont?.baseFontName).toMatch(/CM/);
  });

  it('repairs split prose words and ligatures on sampled MacKay body pages', () => {
    const fixtureUrl = new URL('../pdfs/InformationTheoryByMacKay.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page9 = document.getPage(9);
    const page65 = document.getPage(65);
    const page85 = document.getPage(85);
    const page110 = document.getPage(110);
    const page150 = document.getPage(150);
    const page253 = document.getPage(253);
    const page578 = document.getPage(578);

    expect(page9).toBeDefined();
    expect(page65).toBeDefined();
    expect(page85).toBeDefined();
    expect(page110).toBeDefined();
    expect(page150).toBeDefined();
    expect(page253).toBeDefined();
    expect(page578).toBeDefined();

    const page9Text = page9!.textItems.map((item) => item.text).join(' ');
    const page65Text = page65!.textItems.map((item) => item.text).join(' ');
    const page85Text = page85!.textItems.map((item) => item.text).join(' ');
    const page110Text = page110!.textItems.map((item) => item.text).join(' ');
    const page150Text = page150!.textItems.map((item) => item.text).join(' ');
    const page253Text = page253!.textItems.map((item) => item.text).join(' ');
    const page578Text = page578!.textItems.map((item) => item.text).join(' ');

    expect(page9Text).toContain('Exact Inference by Complete Enumeration');
    expect(page9Text).toContain('Efficient Monte Carlo Methods');
    expect(page65Text).toContain("write down Bayes' theorem again");
    expect(page65Text).toContain('know how probable H is given the data');
    expect(page85Text).toContain('five-character word');
    expect(page85Text).toContain('The average information content per character');
    expect(page85Text).toContain('the first letter of a word is');
    expect(page85Text).toContain('The information content is thus highly variable');
    expect(page110Text).toContain('there exists a prefix code');
    expect(page110Text).toContain('confirming that the Kraft inequality is satisfied');
    expect(page110Text).toContain('defining implicit probabilities');
    expect(page110Text).toContain('Huffman coding');
    expect(page110Text).toContain('shown in figure 5.3?');
    expect(page150Text).toContain('communication over noisy channels');
    expect(page150Text).toContain('do with entropy');
    expect(page150Text).toContain('The joint entropy of');
    expect(page150Text).toContain('The conditional entropy of');
    expect(page253Text).toContain('soldier behind you');
    expect(page253Text).toContain('behind you says');
    expect(page578Text).toContain('average entropy');
  });

  it('preserves Bezier path geometry for the MacKay contents-page badges and circles', () => {
    const fixtureUrl = new URL('../pdfs/InformationTheoryByMacKay.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page = document.getPage(9);

    expect(page).toBeDefined();
    expect(page!.pathItems?.length ?? 0).toBeGreaterThan(0);
    expect(page!.pathItems!.some((item) => item.commands.some((command) => command.op === 'C'))).toBe(true);
    expect(
      page!.pathItems!.some(
        (item) =>
          item.lineWidth >= 3 &&
          item.strokeColor?.[0] === 1 &&
          item.strokeColor?.[1] === 1 &&
          item.strokeColor?.[2] === 1
      )
    ).toBe(true);
  });

  it('decodes Computer Modern math glyphs on the MacKay chapter-1 review page', () => {
    const fixtureUrl = new URL('../pdfs/InformationTheoryByMacKay.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page = document.getPage(13);

    expect(page).toBeDefined();

    const formulaItems = page!.textItems.filter((item) => item.bounds.maxY >= 389 && item.bounds.minY <= 600);
    const formulaText = formulaItems.map((item) => item.text).join(' ');

    expect(formulaText).toContain('≈');
    expect(formulaText).toContain('−');
    expect(formulaItems.some((item) => item.text === '∑')).toBe(true);
    expect(formulaItems.some((item) => item.text === '|')).toBe(true);
    expect(formulaText).not.toMatch(/[\u0000-\u001f]/);
  });

  it('assigns tall display-style bounds to MacKay CMEX summation operators with limits', () => {
    const fixtureUrl = new URL('../pdfs/InformationTheoryByMacKay.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page = document.getPage(13);

    expect(page).toBeDefined();

    const displaySum = page!.textItems.find(
      (item) =>
        item.text === '∑' &&
        item.font === 'CMEX10' &&
        item.glyphSpans?.[0]?.glyphCode === 88 &&
        item.bounds.minX >= 210 &&
        item.bounds.maxX <= 227
    );

    expect(displaySum).toBeDefined();
    expect(displaySum!.fontSize).toBeDefined();

    const displayHeight = displaySum!.bounds.maxY - displaySum!.bounds.minY;
    expect(displayHeight).toBeGreaterThan(displaySum!.fontSize! * 1.8);
    expect(displaySum!.bounds.minY).toBeLessThan(displaySum!.baselineStart!.y - displaySum!.fontSize! * 0.9);
  });

  it('keeps MacKay binomial-coefficient delimiters separate and decodes its punctuation', () => {
    const fixtureUrl = new URL('../pdfs/InformationTheoryByMacKay.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page = document.getPage(13);

    expect(page).toBeDefined();

    const equationItems = page!.textItems
      .filter((item) => item.bounds.minY >= 438 && item.bounds.maxY <= 476 && item.bounds.minX >= 150 && item.bounds.maxX <= 305)
      .sort((left, right) => left.bounds.minX - right.bounds.minX);
    const equationText = equationItems.map((item) => item.text).join(' ');
    const leftDelimiter = equationItems.find((item) => item.text === '(' && item.font === 'CMEX10');
    const rightDelimiter = equationItems.find((item) => item.text === ')' && item.font === 'CMEX10');

    expect(leftDelimiter).toBeDefined();
    expect(rightDelimiter).toBeDefined();
    expect(equationItems.some((item) => item.text === '( )')).toBe(false);
    expect(leftDelimiter!.bounds.minY).toBeLessThan(leftDelimiter!.baselineStart!.y - leftDelimiter!.fontSize! * 2);
    expect(equationText).toContain('|');
    expect(equationText).toContain('f, N');
    expect(equationText).not.toContain('f; N');
    expect(equationText).toContain('.');
    expect(equationText).not.toContain(':');
  });

  it('decodes MacKay page-14 Poisson symbols, radicals, and split words in the surrounding text', () => {
    const fixtureUrl = new URL('../pdfs/InformationTheoryByMacKay.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page = document.getPage(14);

    expect(page).toBeDefined();

    const pageText = page!.textItems.map((item) => item.text).join(' ');
    const formulaItems = page!.textItems
      .filter((item) => item.bounds.minY >= 650 && item.bounds.maxY <= 675 && item.bounds.minX >= 150 && item.bounds.maxX <= 310)
      .sort((left, right) => left.bounds.minX - right.bounds.minX);
    const formulaText = formulaItems.map((item) => item.text).join(' ');
    const gaussianItems = page!.textItems
      .filter((item) => item.bounds.minY >= 590 && item.bounds.maxY <= 616 && item.bounds.minX >= 170 && item.bounds.maxX <= 290)
      .sort((left, right) => left.bounds.minX - right.bounds.minX);
    const gaussianText = gaussianItems.map((item) => item.text).join(' ');

    expect(pageText).toContain('Approximating');
    expect(pageText).toContain("Let's derive Stirling's approximation by an unconventional route.");
    expect(pageText).toContain('For large λ');
    expect(pageText).toContain('into this formula');
    expect(formulaText).toContain('λ');
    expect(formulaText).toContain('∈');
    expect(formulaText).toContain('{');
    expect(formulaText).toContain('}');
    expect(gaussianText).toContain('√');
    expect(gaussianText).toContain('π');
    expect(gaussianText).not.toContain('≈ π');
    expect(formulaText).not.toContain('2 f');
    expect(formulaText).not.toContain('... g');
  });

  it('preserves per-glyph advances for the MacKay page-18 repeated math variables', () => {
    const fixtureUrl = new URL('../pdfs/InformationTheoryByMacKay.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page = document.getPage(18);

    expect(page).toBeDefined();

    const repeatedRun = page!.textItems.find(
      (item) =>
        item.text === 'rrr' &&
        /CMMI/i.test(item.font ?? '') &&
        item.bounds.minX >= 185 &&
        item.bounds.maxX <= 215 &&
        item.bounds.minY >= 440 &&
        item.bounds.maxY <= 460
    );

    expect(repeatedRun).toBeDefined();
    expect(repeatedRun!.glyphSpans?.map((span) => span.text)).toEqual(['r', 'r', 'r']);
    expect(repeatedRun!.glyphSpans?.every((span) => span.advance > 0)).toBe(true);

    const indexRun = page!.textItems.find(
      (item) =>
        item.text === '1 2 3' &&
        item.bounds.minX >= 190 &&
        item.bounds.maxX <= 220 &&
        item.bounds.minY >= 445 &&
        item.bounds.maxY <= 454
    );

    expect(indexRun).toBeDefined();
    expect(indexRun!.glyphSpans?.map((span) => span.text)).toEqual(['1', ' ', '2', ' ', '3']);
  });

  it('decodes the MacKay page-18 product operator instead of a literal CMEX fallback Y', () => {
    const fixtureUrl = new URL('../pdfs/InformationTheoryByMacKay.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page = document.getPage(18);

    expect(page).toBeDefined();

    const equationItems = page!.textItems
      .filter((item) => item.bounds.minX >= 220 && item.bounds.maxX <= 325 && item.bounds.minY >= 135 && item.bounds.maxY <= 182)
      .sort((left, right) => left.bounds.minX - right.bounds.minX);
    const product = equationItems.find((item) => item.text === '∏' && item.glyphSpans?.[0]?.glyphCode === 89);

    expect(product).toBeDefined();
    expect(product!.font).toMatch(/CMEX/i);
    expect(product!.bounds.minY).toBeLessThan(product!.baselineStart!.y - product!.fontSize! * 0.45);
    expect(equationItems.some((item) => item.text === 'Y')).toBe(false);
    expect(equationItems.some((item) => item.text === 'N')).toBe(true);
    expect(equationItems.some((item) => item.text === '=1')).toBe(true);
  });

  it('drops stray CMEX fallback glyphs from MacKay page-13 variance formula and decodes page-14 square brackets', () => {
    const fixtureUrl = new URL('../pdfs/InformationTheoryByMacKay.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page13 = document.getPage(13);
    const page14 = document.getPage(14);

    expect(page13).toBeDefined();
    expect(page14).toBeDefined();

    const varianceItems = page13!.textItems
      .filter((item) => item.bounds.minY >= 128 && item.bounds.maxY <= 148 && item.bounds.minX >= 110 && item.bounds.maxX <= 340)
      .sort((left, right) => left.bounds.minX - right.bounds.minX);
    const varianceText = varianceItems.map((item) => item.text).join(' ');

    const bracketItems = page14!.textItems
      .filter((item) => item.bounds.minY >= 145 && item.bounds.maxY <= 170 && item.bounds.minX >= 250 && item.bounds.maxX <= 335)
      .sort((left, right) => left.bounds.minX - right.bounds.minX);
    const bracketText = bracketItems.map((item) => item.text).join(' ');

    expect(varianceText).not.toContain('fi');
    expect(varianceText).not.toContain('¹');
    expect(bracketText).toContain('[');
    expect(bracketText).toContain(']');
    expect(bracketText).toContain('π');
  });

  it('decodes the MacKay page-15 LINE10 diagram glyphs into arrows and diagonals', () => {
    const fixtureUrl = new URL('../pdfs/InformationTheoryByMacKay.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page = document.getPage(15);

    expect(page).toBeDefined();

    const pageText = page!.textItems.map((item) => item.text).join(' ');

    const diagramItems = page!.textItems
      .filter((item) => item.font === 'LINE10' && item.bounds.minX >= 430 && item.bounds.maxX <= 505 && item.bounds.minY >= 250 && item.bounds.maxY <= 400)
      .sort((left, right) => left.bounds.minY - right.bounds.minY || left.bounds.minX - right.bounds.minX);
    const diagramText = diagramItems.map((item) => item.text).join(' ');

    expect(pageText).toContain('Introduction to Information Theory');
    expect(pageText).toContain('fundamental problem');
    expect(pageText).toContain('reproducing');
    expect(pageText).toContain('another point');
    expect(pageText).toContain('analogue telephone line');
    expect(pageText).not.toContain('Intro duction');
    expect(pageText).not.toContain('fundamen tal');
    expect(pageText).not.toContain('repro ducing');
    expect(pageText).not.toContain('an other');
    expect(pageText).not.toContain('teleph one');
    expect(pageText).not.toContain('or biting');
    expect(pageText).not.toContain('ffl');
    expect(page!.textItems.some((item) => item.text === '•')).toBe(true);
    expect(diagramText).toContain('→');
    expect(diagramText).toContain('↗');
    expect(diagramText).toContain('↘');
    expect(diagramText).toContain('╱');
    expect(diagramText).toContain('╲');
    expect(diagramText).not.toContain('R @');
    expect(diagramText).not.toContain('@');
  });

  it('decodes CCITT-compressed grayscale illustration XObjects on MacKay pages 16 and 19', () => {
    const fixtureUrl = new URL('../pdfs/InformationTheoryByMacKay.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page16 = document.getPage(16);
    const page19 = document.getPage(19);

    expect(page16).toBeDefined();
    expect(page19).toBeDefined();

    const page16Figures = page16!.imageItems.filter((item) => !item.name.startsWith('inline'));
    const page19Figures = page19!.imageItems.filter((item) => !item.name.startsWith('inline'));

    expect(page16Figures).toHaveLength(2);
    expect(page16Figures.every((item) => Boolean(item.pixels))).toBe(true);
    expect(page16Figures.every((item) => item.sourceWidth === 200 && item.sourceHeight === 200)).toBe(true);

    expect(page19Figures.length).toBeGreaterThanOrEqual(4);
    expect(page19Figures.every((item) => Boolean(item.pixels))).toBe(true);
    expect(page19Figures.some((item) => item.sourceHeight === 600)).toBe(true);
  });

  it('decodes solid inline image masks for MacKay page-17 diagrams and chapter rules', () => {
    const fixtureUrl = new URL('../pdfs/InformationTheoryByMacKay.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page = document.getPage(17);

    expect(page).toBeDefined();

    const masks = page!.imageItems.filter((item) => Boolean(item.mask));

    expect(masks.length).toBeGreaterThanOrEqual(20);
    expect(masks.some((item) => item.bounds.maxX - item.bounds.minX > 190 && item.bounds.maxY - item.bounds.minY < 2)).toBe(true);
    expect(masks.some((item) => item.bounds.maxY - item.bounds.minY > 25 && item.bounds.maxX - item.bounds.minX < 2)).toBe(true);
    expect(masks.every((item) => item.fillColor?.[0] === 0 && item.fillColor?.[1] === 0 && item.fillColor?.[2] === 0)).toBe(true);
  });

  it('preserves inline bitmap Type3 glyphs for MacKay section markers', () => {
    const fixtureUrl = new URL('../pdfs/InformationTheoryByMacKay.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page = document.getPage(15);

    expect(page).toBeDefined();

    const marker = page!.textItems.find((item) => item.font === 'A');

    expect(marker).toBeDefined();
    expect(marker!.type3Glyphs?.[0].imageLayers?.length).toBeGreaterThan(0);
    expect(marker!.type3Glyphs?.[0].imageLayers?.[0].mask?.width).toBe(80);
    expect(marker!.type3Glyphs?.[0].imageLayers?.[0].mask?.height).toBe(77);
  });

  it('decodes the MacKay page-17 LINE10 control arrows as vertical arrows', () => {
    const fixtureUrl = new URL('../pdfs/InformationTheoryByMacKay.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page = document.getPage(17);

    expect(page).toBeDefined();

    const figureItems = page!.textItems
      .filter((item) => item.font === 'LINE10' && item.bounds.minY >= 615 && item.bounds.maxY <= 715)
      .sort((left, right) => right.bounds.minY - left.bounds.minY || left.bounds.minX - right.bounds.minX);
    const figureText = figureItems.map((item) => item.text).join(' ');

    expect(figureText).toContain('↑');
    expect(figureText).toContain('↓');
    expect(figureText).not.toContain('6');
    expect(figureText).not.toContain('?');
  });

  it('decodes the MacKay page-19 figure markers as stars instead of question marks', () => {
    const fixtureUrl = new URL('../pdfs/InformationTheoryByMacKay.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page = document.getPage(19);

    expect(page).toBeDefined();

    const figureMarkers = page!.textItems.filter(
      (item) =>
        /CMMI/i.test(item.font ?? '') &&
        item.bounds.minX >= 210 &&
        item.bounds.maxX <= 305 &&
        item.bounds.minY >= 485 &&
        item.bounds.maxY <= 515
    );
    const markerText = figureMarkers.map((item) => item.text).join(' ');

    expect(markerText).toContain('*');
    expect(markerText).not.toContain('?');
  });

  it('does not merge across table columns in Table 3 (NIPS Transformer paper)', () => {
    const fixtureUrl = new URL('../pdfs/NIPS-2017-attention-is-all-you-need-Paper.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page = document.getPage(9);

    expect(page).toBeDefined();

    const base = page!.textItems.find(
      (item) =>
        item.text === 'base' &&
        item.bounds.minX > 110 &&
        item.bounds.minX < 125 &&
        item.bounds.minY > 620 &&
        item.bounds.minY < 635
    );
    expect(base).toBeDefined();

    const rowY = base!.bounds.minY;
    const six = page!.textItems.find(
      (item) =>
        item.text === '6' &&
        Math.abs(item.bounds.minY - rowY) < 0.2 &&
        item.bounds.minX > 140 &&
        item.bounds.minX < 155
    );
    expect(six).toBeDefined();

    const merged = page!.textItems.find(
      (item) => item.text.includes('base 6') && Math.abs(item.bounds.minY - rowY) < 0.2
    );
    expect(merged).toBeUndefined();
  });

  it('removes zero-advance fake spaces inside NIPS prose and headings', () => {
    const fixtureUrl = new URL('../pdfs/NIPS-2017-attention-is-all-you-need-Paper.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const firstPage = document.getPage(1);
    const conclusionPage = document.getPage(9);

    expect(firstPage).toBeDefined();
    expect(conclusionPage).toBeDefined();

    expect(firstPage!.textItems.some((item) => item.text.includes('Equal contribution.'))).toBe(true);
    expect(firstPage!.textItems.some((item) => item.text.includes('contri but i on'))).toBe(false);

    expect(conclusionPage!.textItems.some((item) => item.text === '7 Conclusion')).toBe(true);
    expect(conclusionPage!.textItems.some((item) => item.text.includes('Conclus i on'))).toBe(false);
  });

  it('does not merge adjacent accounting cells on the private cash-flow page', () => {
    const fixtureUrl = new URL('../private-pdfs/Nov 14, 2025 to Dec 11, 2025.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const page = document.getPage(2);

    expect(page).toBeDefined();

    const monthlyIncomeCells = page!.textItems.filter(
      (item) => item.text === '2,395.00' && item.bounds.minY > 369 && item.bounds.maxY < 382
    );
    const monthHeaders = page!.textItems.filter((item) =>
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) 2025$/.test(item.text)
    );

    expect(monthlyIncomeCells).toHaveLength(12);
    expect(monthHeaders).toHaveLength(12);
    expect(page!.textItems.every((item) => item.fontResourceKey)).toBe(true);
    expect(monthHeaders.every((item) => item.fontResourceKey && item.font === 'Arial')).toBe(true);
    expect(monthlyIncomeCells.every((item) => item.fontResourceKey && item.font === 'Arial')).toBe(true);
    expect(page!.textItems.some((item) => item.text.includes('2,395.0028,740.00'))).toBe(false);
    expect(page!.textItems.some((item) => item.text.includes('Jul 2025Aug 2025'))).toBe(false);
  });

  it('repairs merged author-note prose on the NIPS title page', () => {
    const fixtureUrl = new URL('../pdfs/NIPS-2017-attention-is-all-you-need-Paper.pdf', import.meta.url);
    const buffer = readFileSync(fixtureUrl);
    const document = PDFDocument.from(buffer);
    const firstPage = document.getPage(1);

    expect(firstPage).toBeDefined();

    const pageText = firstPage!.textItems.map((item) => item.text).join(' ');
    expect(pageText).toContain('Equal contribution. Listing order is random.');
    expect(pageText).toContain('Jakob proposed replacing RNNs with self-attention and started');
    expect(pageText).toContain('replacing our earlier codebase');
    expect(pageText).toContain('Work performed while at Google Brain.');
    expect(pageText).toContain('Work performed while at Google Research.');

    expect(pageText).not.toContain('Equalcontr i but i on');
    expect(pageText).not.toContain('Listingorder');
    expect(pageText).not.toContain('JakobproposedreplacingRNNs');
    expect(pageText).not.toContain('earliercodebase');
    expect(pageText).not.toContain('Workperformed');
  });
});

function readPixel(
  pixels: NonNullable<PDFDocument['pages'][number]['imageItems'][number]['pixels']>,
  x: number,
  y: number
): [number, number, number, number] {
  const offset = (y * pixels.width + x) * 4;
  return [
    pixels.data[offset] ?? 0,
    pixels.data[offset + 1] ?? 0,
    pixels.data[offset + 2] ?? 0,
    pixels.data[offset + 3] ?? 0
  ];
}
