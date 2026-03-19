import type { PDFEmbeddedFontResource, PDFTextItem } from '../types.js';
import { PDFDocument } from '../pdfDocument.js';
import { canRegisterEmbeddedFontsInCurrentScope, getGlobalFontSet } from './canvasEnvironment.js';
import { buildSyntheticOpenTypeFromType1C } from './type1COpenTypeBuilder.js';
import { buildSyntheticOpenTypeFromType1 } from './type1OpenTypeBuilder.js';
import { parseType1Font, type ParsedType1Font } from './type1FontProgram.js';

export interface RegisteredEmbeddedFont {
  family: string;
  renderMode: 'text' | 'glyph-span' | 'type1-glyph';
  sourceKind?: 'truetype' | 'type1c' | 'type1-synthetic' | 'type1-raw';
  glyphCodeToText?: Map<number, string>;
  type1Font?: ParsedType1Font;
}

const readyCache = new WeakMap<PDFDocument, Map<string, RegisteredEmbeddedFont>>();
const loadingCache = new WeakMap<PDFDocument, Map<string, Promise<RegisteredEmbeddedFont | undefined>>>();

export async function prepareEmbeddedFontsForDocument(documentModel: PDFDocument): Promise<boolean> {
  return prepareEmbeddedFontsForKeys(documentModel, Object.keys(documentModel.getFontResources()));
}

export async function prepareEmbeddedFontsForPages(
  documentModel: PDFDocument,
  pageNumbers: Iterable<number>
): Promise<boolean> {
  return prepareEmbeddedFontsForKeys(documentModel, collectEmbeddedFontKeysForPages(documentModel, pageNumbers));
}

export function resolveRegisteredEmbeddedFont(
  documentModel: PDFDocument,
  item: Pick<PDFTextItem, 'fontResourceKey'>
): RegisteredEmbeddedFont | undefined {
  const fontKey = item.fontResourceKey;
  if (!fontKey) {
    return undefined;
  }

  return getReadyFonts(documentModel).get(fontKey);
}

async function prepareEmbeddedFontsForKeys(
  documentModel: PDFDocument,
  fontKeys: Iterable<string>
): Promise<boolean> {
  const requestedFontKeys = [...new Set(fontKeys)].filter((fontKey) => Boolean(documentModel.getFontResource(fontKey)));
  if (requestedFontKeys.length === 0) {
    return false;
  }

  const readyFonts = getReadyFonts(documentModel);
  const readyCountBefore = readyFonts.size;

  await Promise.all(requestedFontKeys.map((fontKey) => ensureEmbeddedFont(documentModel, fontKey)));

  return readyFonts.size > readyCountBefore;
}

function collectEmbeddedFontKeysForPages(
  documentModel: PDFDocument,
  pageNumbers: Iterable<number>
): string[] {
  const fontKeys = new Set<string>();

  for (const pageNumber of pageNumbers) {
    const page = documentModel.getPage(pageNumber);
    if (!page) {
      continue;
    }

    for (const item of page.textItems) {
      if (!item.fontResourceKey || fontKeys.has(item.fontResourceKey)) {
        continue;
      }
      if (!documentModel.getFontResource(item.fontResourceKey)) {
        continue;
      }
      fontKeys.add(item.fontResourceKey);
    }
  }

  return [...fontKeys];
}

function getReadyFonts(documentModel: PDFDocument): Map<string, RegisteredEmbeddedFont> {
  const cached = readyCache.get(documentModel);
  if (cached) {
    return cached;
  }

  const created = new Map<string, RegisteredEmbeddedFont>();
  readyCache.set(documentModel, created);
  return created;
}

function getLoadingFonts(documentModel: PDFDocument): Map<string, Promise<RegisteredEmbeddedFont | undefined>> {
  const cached = loadingCache.get(documentModel);
  if (cached) {
    return cached;
  }

  const created = new Map<string, Promise<RegisteredEmbeddedFont | undefined>>();
  loadingCache.set(documentModel, created);
  return created;
}

async function ensureEmbeddedFont(
  documentModel: PDFDocument,
  fontKey: string
): Promise<RegisteredEmbeddedFont | undefined> {
  const readyFonts = getReadyFonts(documentModel);
  const cached = readyFonts.get(fontKey);
  if (cached) {
    return cached;
  }

  const loadingFonts = getLoadingFonts(documentModel);
  const pending = loadingFonts.get(fontKey);
  if (pending) {
    return pending;
  }

  const resource = documentModel.getFontResource(fontKey);
  if (!resource) {
    return undefined;
  }

  const loadPromise = registerEmbeddedFont(fontKey, resource)
    .then((registration) => {
      if (registration) {
        readyFonts.set(fontKey, registration);
      }
      return registration;
    })
    .catch(() => undefined)
    .finally(() => {
      loadingFonts.delete(fontKey);
    });

  loadingFonts.set(fontKey, loadPromise);
  return loadPromise;
}

async function registerEmbeddedFont(
  fontKey: string,
  resource: PDFEmbeddedFontResource
): Promise<RegisteredEmbeddedFont | undefined> {
  if (!resource.data || resource.data.length === 0) {
    return undefined;
  }

  if (resource.fontFileKind === 'FontFile2' || resource.fontFileSubtype === 'OpenType') {
    if (!canRegisterEmbeddedFonts()) {
      return undefined;
    }
    const family = createEmbeddedFamilyName(resource.baseFontName ?? 'Embedded', fontKey);
    const fontFace = new FontFace(family, toArrayBuffer(resource.data));
    await fontFace.load();
    getBrowserFontSet()?.add?.(fontFace);
    return { family, renderMode: 'text', sourceKind: 'truetype' };
  }

  if (
    resource.fontFileKind === 'FontFile' &&
    (resource.subtype === 'Type1' || resource.subtype === 'MMType1' || resource.fontFileSubtype === 'Type1')
  ) {
    const parsed = parseType1Font(resource);
    if (!parsed) {
      return undefined;
    }

    if (canRegisterEmbeddedFonts()) {
      const synthetic = buildSyntheticOpenTypeFromType1(resource, parsed);
      if (synthetic) {
        const family = createEmbeddedFamilyName(resource.baseFontName ?? 'Type1', fontKey);
        const fontFace = new FontFace(family, toArrayBuffer(synthetic.buffer));
        await fontFace.load();
        getBrowserFontSet()?.add?.(fontFace);
        return {
          family,
          renderMode: 'glyph-span',
          sourceKind: 'type1-synthetic',
          glyphCodeToText: synthetic.glyphCodeToText
        };
      }
    }

    return {
      family: createEmbeddedFamilyName(resource.baseFontName ?? 'Type1', fontKey),
      renderMode: 'type1-glyph',
      sourceKind: 'type1-raw',
      type1Font: parsed
    };
  }

  if (resource.fontFileSubtype === 'Type1C' || resource.fontFileSubtype === 'CIDFontType0C') {
    if (!canRegisterEmbeddedFonts()) {
      return undefined;
    }
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
      sourceKind: 'type1c',
      glyphCodeToText: synthetic.glyphCodeToText
    };
  }

  return undefined;
}

function canRegisterEmbeddedFonts(): boolean {
  return canRegisterEmbeddedFontsInCurrentScope();
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
  return getGlobalFontSet() as { add?: (fontFace: FontFace) => unknown } | undefined;
}
