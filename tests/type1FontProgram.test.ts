import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { PDFDocument } from '../src/pdfDocument.js';
import { parseType1Font } from '../src/viewer/type1FontProgram.js';

describe('parseType1Font', () => {
  it('parses embedded raw Type1 Computer Modern fonts into encodings and glyph outlines', () => {
    const document = PDFDocument.from(readFileSync('pdfs/NIPS-2017-attention-is-all-you-need-Paper.pdf'));
    const cmmi10 = document.getFontResource('F11');
    expect(cmmi10).toBeDefined();

    const parsed = cmmi10 ? parseType1Font(cmmi10) : undefined;
    expect(parsed?.fontName).toContain('CMMI10');
    expect(parsed?.encoding.get(81)).toBe('Q');
    expect(parsed?.encoding.get(87)).toBe('W');
    expect(parsed?.glyphs.get('Q')?.pathCommands.length ?? 0).toBeGreaterThan(0);
    expect(parsed?.glyphs.get('W')?.pathCommands.length ?? 0).toBeGreaterThan(0);
    expect(parsed?.glyphs.get('W')?.width ?? 0).toBeGreaterThan(900);

    const wPath = parsed?.glyphs.get('W')?.pathCommands ?? [];
    const consecutiveMoves = wPath.some(
      (command, index) => command.op === 'M' && wPath[index + 1]?.op === 'M'
    );
    expect(consecutiveMoves).toBe(false);
  });
});
