import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { PDFDocument } from '../src/pdfDocument.js';
import { deserializePdfPage, serializePdfPage } from '../testApp/src/workers/pdfPageTransfer.js';

function loadAttentionPaperDocument(): PDFDocument {
  const fixtureUrl = new URL('../pdfs/NIPS-2017-attention-is-all-you-need-Paper.pdf', import.meta.url);
  return PDFDocument.from(readFileSync(fixtureUrl));
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
});
