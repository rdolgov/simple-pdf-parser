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
