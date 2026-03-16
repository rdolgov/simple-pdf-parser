import type { ContentRef, PDFRawObject } from './parserTypes.js';
import type { PDFEmbeddedFontDescriptor } from '../types.js';
import { objectKey } from './xrefParser.js';

export interface EmbeddedFontProgramReference {
  descriptor: PDFRawObject;
  fontFileObject: PDFRawObject;
  fontFileKey: string;
  fontFileKind: 'FontFile' | 'FontFile2' | 'FontFile3';
  fontFileSubtype?: string;
}

export function resolveEmbeddedFontProgramReference(
  fontObject: PDFRawObject,
  objects: Map<string, PDFRawObject>
): EmbeddedFontProgramReference | undefined {
  const descriptor = resolveFontDescriptorObject(fontObject, objects);
  if (!descriptor) {
    return undefined;
  }

  for (const fontFileKind of ['FontFile', 'FontFile2', 'FontFile3'] as const) {
    const ref = extractIndirectRef(descriptor.dictionarySource, fontFileKind);
    if (!ref) {
      continue;
    }

    const fontFileKey = objectKey(ref.id, ref.generation);
    const fontFileObject = objects.get(fontFileKey);
    if (!fontFileObject) {
      continue;
    }

    const subtypeMatch = fontFileObject.dictionarySource.match(/\/Subtype\s*\/([A-Za-z0-9]+)/);
    return {
      descriptor,
      fontFileObject,
      fontFileKey,
      fontFileKind,
      fontFileSubtype: subtypeMatch?.[1]
    };
  }

  return undefined;
}

export function extractFontDescriptorMetrics(source: string): PDFEmbeddedFontDescriptor | undefined {
  const descriptor: PDFEmbeddedFontDescriptor = {};

  const ascent = extractNumber(source, 'Ascent');
  if (ascent !== undefined) {
    descriptor.ascent = ascent;
  }

  const descent = extractNumber(source, 'Descent');
  if (descent !== undefined) {
    descriptor.descent = descent;
  }

  const capHeight = extractNumber(source, 'CapHeight');
  if (capHeight !== undefined) {
    descriptor.capHeight = capHeight;
  }

  const italicAngle = extractNumber(source, 'ItalicAngle');
  if (italicAngle !== undefined) {
    descriptor.italicAngle = italicAngle;
  }

  const flags = extractInteger(source, 'Flags');
  if (flags !== undefined) {
    descriptor.flags = flags;
  }

  const stemV = extractNumber(source, 'StemV');
  if (stemV !== undefined) {
    descriptor.stemV = stemV;
  }

  const bboxMatch = source.match(
    /\/FontBBox\s*\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]/
  );
  if (bboxMatch) {
    descriptor.bbox = [
      Number(bboxMatch[1]),
      Number(bboxMatch[2]),
      Number(bboxMatch[3]),
      Number(bboxMatch[4])
    ];
  }

  return Object.keys(descriptor).length > 0 ? descriptor : undefined;
}

function resolveFontDescriptorObject(
  fontObject: PDFRawObject,
  objects: Map<string, PDFRawObject>
): PDFRawObject | undefined {
  const directDescriptor = lookupFontDescriptorObject(fontObject.dictionarySource, objects);
  if (directDescriptor) {
    return directDescriptor;
  }

  if (/\/Subtype\s*\/Type0\b/.test(fontObject.dictionarySource)) {
    const descendants = extractDescendantFontRefs(fontObject.dictionarySource);
    for (const ref of descendants) {
      const descendant = objects.get(objectKey(ref.id, ref.generation));
      if (!descendant) {
        continue;
      }

      const descriptor = lookupFontDescriptorObject(descendant.dictionarySource, objects);
      if (descriptor) {
        return descriptor;
      }
    }
  }

  return undefined;
}

function lookupFontDescriptorObject(
  dictionarySource: string,
  objects: Map<string, PDFRawObject>
): PDFRawObject | undefined {
  const ref = extractIndirectRef(dictionarySource, 'FontDescriptor');
  if (!ref) {
    return undefined;
  }
  return objects.get(objectKey(ref.id, ref.generation));
}

function extractDescendantFontRefs(dictionarySource: string): ContentRef[] {
  const refs: ContentRef[] = [];
  const arrayMatch = dictionarySource.match(/\/DescendantFonts\s*\[([\s\S]*?)\]/);

  if (arrayMatch) {
    const regex = /(\d+)\s+(\d+)\s+R/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(arrayMatch[1])) !== null) {
      refs.push({ id: Number(match[1]), generation: Number(match[2]) });
    }
    return refs;
  }

  const singleMatch = dictionarySource.match(/\/DescendantFonts\s+(\d+)\s+(\d+)\s+R/);
  if (singleMatch) {
    refs.push({ id: Number(singleMatch[1]), generation: Number(singleMatch[2]) });
  }

  return refs;
}

function extractIndirectRef(source: string, key: string): ContentRef | undefined {
  const pattern = new RegExp(`/${key}\\s+(\\d+)\\s+(\\d+)\\s+R`);
  const match = source.match(pattern);
  if (!match) {
    return undefined;
  }

  return {
    id: Number(match[1]),
    generation: Number(match[2])
  };
}

function extractNumber(source: string, key: string): number | undefined {
  const pattern = new RegExp(`/${key}\\s+(-?\\d+(?:\\.\\d+)?)`);
  const match = source.match(pattern);
  if (!match) {
    return undefined;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function extractInteger(source: string, key: string): number | undefined {
  const value = extractNumber(source, key);
  if (value === undefined) {
    return undefined;
  }
  return Math.trunc(value);
}
