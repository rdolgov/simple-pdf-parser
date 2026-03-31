import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { PDFDocument } from '../src/pdfDocument.js';
import { PDFParser } from '../src/parser/pdfParser.js';
import type { PDFPage } from '../src/types.js';
import { deserializePdfPage, serializePdfPage } from '../testApp/src/workers/pdfPageTransfer.js';

function loadAttentionPaperDocument(): PDFDocument {
  const fixtureUrl = new URL('../pdfs/NIPS-2017-attention-is-all-you-need-Paper.pdf', import.meta.url);
  return PDFDocument.from(readFileSync(fixtureUrl));
}

function loadReducedPaperFirstPage(): PDFPage {
  const fixtureUrl = new URL('../pdfs/Paper reduced size (2).pdf', import.meta.url);
  const buffer = readFileSync(fixtureUrl);
  const stop = Symbol('stop');
  let capturedPage: PDFPage | undefined;

  try {
    new PDFParser({
      onPageParsed: ({ page, pageNumber }) => {
        if (pageNumber !== 1) {
          return;
        }
        capturedPage = page;
        throw stop;
      }
    }).parse(buffer);
  } catch (error) {
    if (error !== stop) {
      throw error;
    }
  }

  if (!capturedPage) {
    throw new Error('Failed to parse reduced-paper page 1.');
  }

  return capturedPage;
}

describe('PDF page transfer', () => {
  it('preserves pixel-backed Figure 1 images across worker-style page transfers', () => {
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
    expect(restoredImage!.bounds).toEqual(figureImage!.bounds);
    expect(restoredImage!.pixels).toBeDefined();
    expect(restoredImage!.pixels!.width).toBe(figureImage!.pixels!.width);
    expect(restoredImage!.pixels!.height).toBe(figureImage!.pixels!.height);
    expect(Array.from(restoredImage!.pixels!.data.slice(0, 16))).toEqual(
      Array.from(figureImage!.pixels!.data.slice(0, 16))
    );
    expect(Object.keys(restoredImage!)).not.toContain('pixels');
  });

  it('preserves display text items separately from semantic text items across worker-style page transfers', () => {
    const document = loadAttentionPaperDocument();
    const page = document.getPage(1);

    expect(page).toBeDefined();
    expect(page!.displayTextItems).toBeDefined();
    expect(page!.displayTextItems!.length).toBeGreaterThan(0);
    expect(page!.textItems.length).toBeGreaterThan(0);

    const transferred = structuredClone(serializePdfPage(page!));
    const restoredPage = deserializePdfPage(transferred);

    expect(restoredPage.displayTextItems).toBeDefined();
    expect(restoredPage.displayTextItems!.length).toBe(page!.displayTextItems!.length);
    expect(restoredPage.displayTextItems![0]?.text).toBe(page!.displayTextItems![0]?.text);
    expect(restoredPage.textItems[0]?.text).toBe(page!.textItems[0]?.text);
  });

  it('preserves invisible display glyph slots across worker-style page transfers', () => {
    const page = loadReducedPaperFirstPage();

    const displayKeywordFragment = page.displayTextItems?.find(
      (item) =>
        item.text === 'alc' &&
        item.bounds.minY >= 368 &&
        item.bounds.maxY <= 381 &&
        item.fontResourceKey === 'TT4'
    );

    expect(displayKeywordFragment).toBeDefined();
    expect(displayKeywordFragment!.glyphSpans?.some((span) => span.text === '' && span.advance > 0)).toBe(true);

    const transferred = structuredClone(serializePdfPage(page));
    const restoredPage = deserializePdfPage(transferred);
    const restoredFragment = restoredPage.displayTextItems?.find(
      (item) =>
        item.text === 'alc' &&
        item.bounds.minY >= 368 &&
        item.bounds.maxY <= 381 &&
        item.fontResourceKey === 'TT4'
    );

    expect(restoredFragment).toBeDefined();
    expect(restoredFragment!.glyphSpans?.some((span) => span.text === '' && span.advance > 0)).toBe(true);
  });
});
