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

  it('parses StandardEncoding body fonts so raw Type1 prose glyphs do not collapse to .notdef', () => {
    const document = PDFDocument.from(readFileSync('pdfs/NIPS-2017-attention-is-all-you-need-Paper.pdf'));
    const bodyFont = document.getFontResource('F63');
    expect(bodyFont).toBeDefined();

    const parsed = bodyFont ? parseType1Font(bodyFont) : undefined;
    expect(parsed?.fontName).toContain('NimbusRomNo9L-Regu');
    expect(parsed?.encoding.get(71)).toBe('G');
    expect(parsed?.encoding.get(80)).toBe('P');
    expect(parsed?.encoding.get(85)).toBe('U');
    expect(parsed?.encoding.get(115)).toBe('s');
    expect(parsed?.encoding.get(46)).toBe('period');
    expect(parsed?.glyphs.get('G')?.pathCommands.length ?? 0).toBeGreaterThan(0);
    expect(parsed?.glyphs.get('U')?.pathCommands.length ?? 0).toBeGreaterThan(0);
    expect(parsed?.glyphs.get('period')?.pathCommands.length ?? 0).toBeGreaterThan(0);
  });

  it('parses raw Type1 beta charstrings with full integer coordinates before div scaling', () => {
    const document = PDFDocument.from(readFileSync('pdfs/NIPS-2017-attention-is-all-you-need-Paper.pdf'));
    const cmmi10 = document.getFontResource('F11');
    expect(cmmi10).toBeDefined();

    const parsed = cmmi10 ? parseType1Font(cmmi10) : undefined;
    const betaPath = parsed?.glyphs.get('beta')?.pathCommands ?? [];
    const xValues = betaPath.flatMap((command) => {
      switch (command.op) {
        case 'M':
        case 'L':
          return [command.x];
        case 'C':
          return [command.x1, command.x2, command.x3];
        default:
          return [];
      }
    });

    expect(xValues.length).toBeGreaterThan(0);
    expect(Math.min(...xValues)).toBeGreaterThan(20);
    expect(Math.max(...xValues)).toBeGreaterThan(500);
  });
});
