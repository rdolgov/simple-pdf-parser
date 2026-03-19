import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { PDFDocument } from '../src/pdfDocument.js';
import { buildSyntheticOpenTypeFromType1 } from '../src/viewer/type1OpenTypeBuilder.js';
import { parseType1Font } from '../src/viewer/type1FontProgram.js';

describe('buildSyntheticOpenTypeFromType1', () => {
  it('builds a browser-loadable OpenType wrapper for raw Type1 Computer Modern fonts', () => {
    const document = PDFDocument.from(readFileSync('pdfs/NIPS-2017-attention-is-all-you-need-Paper.pdf'));
    const font = document.getFontResource('F11');
    expect(font).toBeDefined();

    const parsed = font ? parseType1Font(font) : undefined;
    const synthetic = font && parsed ? buildSyntheticOpenTypeFromType1(font, parsed) : undefined;

    expect(synthetic).toBeDefined();
    expect(Array.from(synthetic!.buffer.slice(0, 4))).toEqual([0x4f, 0x54, 0x54, 0x4f]);
    expect(synthetic!.glyphCodeToText.get(81)?.charCodeAt(0)).toBeGreaterThanOrEqual(0xe000);
    expect(synthetic!.glyphCodeToText.get(87)?.charCodeAt(0)).toBeGreaterThanOrEqual(0xe000);
    expect(synthetic!.buffer.length).toBeGreaterThan(2000);
  });
});
