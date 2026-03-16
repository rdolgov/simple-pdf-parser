import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { PDFDocument } from '../src/pdfDocument.js';
import { buildSyntheticOpenTypeFromType1C } from '../src/viewer/type1COpenTypeBuilder.js';

describe('buildSyntheticOpenTypeFromType1C', () => {
  it('wraps an embedded MacKay Type1C font in a browser-loadable OpenType buffer', () => {
    const fixtureUrl = new URL('../pdfs/InformationTheoryByMacKay.pdf', import.meta.url);
    const document = PDFDocument.from(readFileSync(fixtureUrl));
    const type1CResource = Object.values(document.getFontResources()).find(
      (resource) => resource.baseFontName === 'CMTI12' && resource.fontFileSubtype === 'Type1C'
    );

    expect(type1CResource).toBeDefined();

    const synthetic = type1CResource ? buildSyntheticOpenTypeFromType1C(type1CResource) : undefined;

    expect(synthetic).toBeDefined();
    expect(synthetic?.buffer.length ?? 0).toBeGreaterThan(type1CResource?.data.length ?? 0);
    expect(String.fromCharCode(...synthetic!.buffer.slice(0, 4))).toBe('OTTO');
    expect(synthetic?.glyphCodeToText.size ?? 0).toBeGreaterThan(20);
    expect(synthetic?.glyphCodeToText.get(65)?.charCodeAt(0)).toBeGreaterThanOrEqual(0xe000);
  });
});
