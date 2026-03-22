import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { PDFDocument } from '../src/pdfDocument.js';
import { parseType1CFont } from '../src/viewer/type1CFontProgram.js';

describe('parseType1CFont', () => {
  it('parses the embedded MacKay LINE10 font into outline glyphs and encodings', () => {
    const document = PDFDocument.from(readFileSync('pdfs/InformationTheoryByMacKay.pdf'));
    const font = Object.values(document.getFontResources()).find(
      (resource) => resource.baseFontName === 'LINE10' && resource.fontFileSubtype === 'Type1C'
    );

    expect(font).toBeDefined();

    const parsed = font ? parseType1CFont(font) : undefined;
    const arrowGlyphName = parsed?.encoding.get(45);
    const arrowGlyph = arrowGlyphName ? parsed?.glyphs.get(arrowGlyphName) : undefined;

    expect(parsed).toBeDefined();
    expect(arrowGlyphName).toBeDefined();
    expect(arrowGlyph?.pathCommands.length ?? 0).toBeGreaterThan(0);
    expect(arrowGlyph?.pathCommands.some((command) => command.op === 'C' || command.op === 'L')).toBe(true);
  });
});
