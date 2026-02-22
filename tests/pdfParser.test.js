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
});
//# sourceMappingURL=pdfParser.test.js.map
