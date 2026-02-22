import { PDFParser } from './parser/pdfParser.js';
import type { ParseOptions, ParseSource, PDFImageItem, PDFLayout, PDFPage, PDFTextItem } from './types.js';

export class PDFDocument {
  static from(source: ParseSource, options: ParseOptions = {}): PDFDocument {
    const parser = new PDFParser(options);
    const layout = parser.parse(source);
    return new PDFDocument(layout);
  }

  constructor(private readonly layout: PDFLayout) {}

  get pages(): PDFPage[] {
    return this.layout.pages;
  }

  getText(): string {
    return this.layout.pages
      .flatMap((page) => page.textItems.map((item) => item.text))
      .join('\n');
  }

  getPage(number: number): PDFPage | undefined {
    return this.layout.pages.find((page) => page.number === number);
  }

  getTextItems(): PDFTextItem[] {
    return this.layout.pages.flatMap((page) => page.textItems);
  }

  getImageItems(): PDFImageItem[] {
    return this.layout.pages.flatMap((page) => page.imageItems);
  }
}
