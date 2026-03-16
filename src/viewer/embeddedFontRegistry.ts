import type { PDFEmbeddedFontResource, PDFTextItem } from '../types.js';
import { PDFDocument } from '../pdfDocument.js';
import { buildSyntheticOpenTypeFromType1C } from './type1COpenTypeBuilder.js';

export interface RegisteredEmbeddedFont {
  family: string;
  renderMode: 'text' | 'glyph-span';
  glyphCodeToText?: Map<number, string>;
}

const readyCache = new WeakMap<PDFDocument, Map<string, RegisteredEmbeddedFont>>();
const loadingCache = new WeakMap<PDFDocument, Promise<Map<string, RegisteredEmbeddedFont>>>();

export async function prepareEmbeddedFontsForDocument(documentModel: PDFDocument): Promise<void> {
  await ensureEmbeddedFonts(documentModel);
}

export function resolveRegisteredEmbeddedFont(
  documentModel: PDFDocument,
  item: Pick<PDFTextItem, 'fontResourceKey'>
): RegisteredEmbeddedFont | undefined {
  const fontKey = item.fontResourceKey;
  if (!fontKey) {
    return undefined;
  }

  return readyCache.get(documentModel)?.get(fontKey);
}

async function ensureEmbeddedFonts(documentModel: PDFDocument): Promise<Map<string, RegisteredEmbeddedFont>> {
  const cached = readyCache.get(documentModel);
  if (cached) {
    return cached;
  }

  const pending = loadingCache.get(documentModel);
  if (pending) {
    return pending;
  }

  const loadPromise = loadEmbeddedFonts(documentModel);
  loadingCache.set(documentModel, loadPromise);

  try {
    const loaded = await loadPromise;
    readyCache.set(documentModel, loaded);
    return loaded;
  } finally {
    loadingCache.delete(documentModel);
  }
}

async function loadEmbeddedFonts(documentModel: PDFDocument): Promise<Map<string, RegisteredEmbeddedFont>> {
  const registrations = new Map<string, RegisteredEmbeddedFont>();
  if (!canRegisterEmbeddedFonts()) {
    return registrations;
  }

  const resources = documentModel.getFontResources();
  for (const [fontKey, resource] of Object.entries(resources)) {
    try {
      const registration = await registerEmbeddedFont(fontKey, resource);
      if (registration) {
        registrations.set(fontKey, registration);
      }
    } catch {
      // Ignore unsupported embedded fonts and fall back to the renderer's normal font path.
    }
  }

  return registrations;
}

async function registerEmbeddedFont(
  fontKey: string,
  resource: PDFEmbeddedFontResource
): Promise<RegisteredEmbeddedFont | undefined> {
  if (!resource.data || resource.data.length === 0) {
    return undefined;
  }

  if (resource.fontFileKind === 'FontFile2' || resource.fontFileSubtype === 'OpenType') {
    const family = createEmbeddedFamilyName(resource.baseFontName ?? 'Embedded', fontKey);
    const fontFace = new FontFace(family, toArrayBuffer(resource.data));
    await fontFace.load();
    getBrowserFontSet()?.add?.(fontFace);
    return { family, renderMode: 'text' };
  }

  if (resource.fontFileSubtype === 'Type1C' || resource.fontFileSubtype === 'CIDFontType0C') {
    const synthetic = buildSyntheticOpenTypeFromType1C(resource);
    if (!synthetic) {
      return undefined;
    }

    const family = createEmbeddedFamilyName(resource.baseFontName ?? 'Type1C', fontKey);
    const fontFace = new FontFace(family, toArrayBuffer(synthetic.buffer));
    await fontFace.load();
    getBrowserFontSet()?.add?.(fontFace);
    return {
      family,
      renderMode: 'glyph-span',
      glyphCodeToText: synthetic.glyphCodeToText
    };
  }

  return undefined;
}

function canRegisterEmbeddedFonts(): boolean {
  return (
    typeof FontFace !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof getBrowserFontSet()?.add === 'function'
  );
}

function createEmbeddedFamilyName(baseFontName: string, fontKey: string): string {
  return `PDFEmbedded-${sanitize(baseFontName)}-${sanitize(fontKey)}`;
}

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, '-');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function getBrowserFontSet(): { add?: (fontFace: FontFace) => unknown } | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }
  return document.fonts as unknown as { add?: (fontFace: FontFace) => unknown } | undefined;
}
