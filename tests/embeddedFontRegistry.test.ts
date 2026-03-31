import { afterEach, describe, expect, it } from 'vitest';

import { PDFDocument } from '../src/pdfDocument.js';
import {
  prepareEmbeddedFontsForDocument,
  resolveRegisteredEmbeddedFont
} from '../src/viewer/embeddedFontRegistry.js';
import type { PDFLayout } from '../src/types.js';

const originalDocument = (globalThis as typeof globalThis & { document?: unknown }).document;
const originalFontFace = (globalThis as typeof globalThis & { FontFace?: unknown }).FontFace;

afterEach(() => {
  if (originalDocument === undefined) {
    delete (globalThis as typeof globalThis & { document?: unknown }).document;
  } else {
    (globalThis as typeof globalThis & { document?: unknown }).document = originalDocument;
  }

  if (originalFontFace === undefined) {
    delete (globalThis as typeof globalThis & { FontFace?: unknown }).FontFace;
  } else {
    (globalThis as typeof globalThis & { FontFace?: unknown }).FontFace = originalFontFace;
  }
});

describe('embeddedFontRegistry', () => {
  it('waits for browser font-set activation before marking embedded TrueType fonts ready', async () => {
    const calls: string[] = [];
    let resolveReady: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      resolveReady = () => {
        calls.push('fonts.ready');
        resolve();
      };
    });

    class MockFontFace {
      constructor(public readonly family: string, public readonly source: ArrayBuffer) {}

      async load(): Promise<MockFontFace> {
        calls.push(`fontFace.load:${this.family}:${this.source.byteLength}`);
        return this;
      }
    }

    (globalThis as typeof globalThis & { FontFace?: typeof MockFontFace }).FontFace = MockFontFace;
    (globalThis as typeof globalThis & { document?: { fonts: unknown } }).document = {
      fonts: {
        add(fontFace: MockFontFace) {
          calls.push(`fonts.add:${fontFace.family}`);
        },
        async load(fontSpec: string) {
          calls.push(`fonts.load:${fontSpec}`);
          resolveReady?.();
          return [];
        },
        ready
      }
    };

    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          textItems: [
            {
              text: 'Hello',
              bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
              fontResourceKey: 'TT4'
            }
          ],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          size: { width: 10, height: 10 }
        }
      ],
      fontResources: {
        TT4: {
          fontKey: '11 0',
          objectKey: '11 0',
          baseFontName: 'Cambria',
          subtype: 'TrueType',
          fontFileKind: 'FontFile2',
          data: new Uint8Array([0, 1, 0, 0, 0, 8, 0, 128])
        }
      }
    };

    const documentModel = new PDFDocument(layout);

    await prepareEmbeddedFontsForDocument(documentModel);

    const registration = resolveRegisteredEmbeddedFont(documentModel, { fontResourceKey: 'TT4' });
    expect(registration).toBeDefined();
    expect(registration!.family).toBe('PDFEmbedded-Cambria-TT4');
    expect(calls).toEqual([
      'fontFace.load:PDFEmbedded-Cambria-TT4:8',
      'fonts.add:PDFEmbedded-Cambria-TT4',
      'fonts.load:16px PDFEmbedded-Cambria-TT4',
      'fonts.ready'
    ]);
  });
});
