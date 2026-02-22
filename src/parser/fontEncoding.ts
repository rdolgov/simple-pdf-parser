/**
 * Font encoding and ToUnicode CMap parsing
 */

import type { PDFRawObject } from './parserTypes.js';
import { BASIC_GLYPH_MAP } from './parserConstants.js';
import { objectKey } from './xrefParser.js';
import { readName } from './textTokenizer.js';
import {
  skipWhitespace,
  readDictionary,
  hexToBytes,
  hexToUnicodeString,
  bytesToKey,
  intToBytes
} from './parserUtils.js';

/**
 * Parse a ToUnicode CMap stream into a mapping from byte keys to Unicode strings
 */
export function parseToUnicodeCMap(cmapSource: string): Map<string, string> {
  const map = new Map<string, string>();
  const normalized = cmapSource.replace(/\r\n/g, '\n');

  // Parse beginbfchar sections
  const bfcharRegex = /beginbfchar([\s\S]*?)endbfchar/g;
  let sectionMatch: RegExpExecArray | null;

  while ((sectionMatch = bfcharRegex.exec(normalized)) !== null) {
    const body = sectionMatch[1];
    const pairRegex = /<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/g;
    let pairMatch: RegExpExecArray | null;

    while ((pairMatch = pairRegex.exec(body)) !== null) {
      const sourceBytes = hexToBytes(pairMatch[1]);
      const targetString = hexToUnicodeString(pairMatch[2]);
      map.set(bytesToKey(sourceBytes), targetString);
    }
  }

  // Parse beginbfrange sections
  const bfrangeRegex = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((sectionMatch = bfrangeRegex.exec(normalized)) !== null) {
    const body = sectionMatch[1];
    const lines = body.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line === '') {
        continue;
      }

      // Array format: <start> <end> [<target1> <target2> ...]
      const arrayMatch = line.match(/^<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[(.+)\]$/);
      if (arrayMatch) {
        const startHex = arrayMatch[1];
        const endHex = arrayMatch[2];
        const entries = arrayMatch[3];
        const startCode = Number.parseInt(startHex, 16);
        const endCode = Number.parseInt(endHex, 16);
        const width = hexToBytes(startHex).length;
        const targetMatches = [...entries.matchAll(/<([0-9A-Fa-f]+)>/g)];

        for (let offset = 0; offset < targetMatches.length && startCode + offset <= endCode; offset += 1) {
          const targetHex = targetMatches[offset]?.[1];
          if (!targetHex) {
            continue;
          }
          const keyBytes = intToBytes(startCode + offset, width);
          map.set(bytesToKey(keyBytes), hexToUnicodeString(targetHex));
        }
        continue;
      }

      // Range format: <start> <end> <baseTarget>
      const rangeMatch = line.match(/^<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>$/);
      if (rangeMatch) {
        const startHex = rangeMatch[1];
        const endHex = rangeMatch[2];
        const baseHex = rangeMatch[3];
        const startCode = Number.parseInt(startHex, 16);
        const endCode = Number.parseInt(endHex, 16);
        const width = hexToBytes(startHex).length;
        const baseString = hexToUnicodeString(baseHex);
        const baseCodePoint = baseString.codePointAt(0);

        if (baseCodePoint === undefined) {
          continue;
        }

        for (let code = startCode; code <= endCode; code += 1) {
          const keyBytes = intToBytes(code, width);
          map.set(bytesToKey(keyBytes), String.fromCodePoint(baseCodePoint + (code - startCode)));
        }
      }
    }
  }

  return map;
}

/**
 * Build an encoding map from a font object's /Encoding entry
 */
export function buildEncodingMap(
  fontObject: PDFRawObject,
  objects: Map<string, PDFRawObject>
): Map<number, string> {
  const map = createBaseEncodingMap();
  const encodingInfo = extractEncodingInfo(fontObject.dictionarySource, objects);

  if (!encodingInfo) {
    return map;
  }

  if (encodingInfo.baseEncoding) {
    applyBaseEncoding(map, encodingInfo.baseEncoding);
  }

  if (encodingInfo.differences) {
    for (const [code, name] of encodingInfo.differences.entries()) {
      const value = glyphNameToUnicode(name);
      if (value !== undefined) {
        map.set(code & 0xff, value);
      }
    }
  }

  return map;
}

/**
 * Create a base encoding map with identity mapping for 0-255
 */
export function createBaseEncodingMap(): Map<number, string> {
  const map = new Map<number, string>();
  for (let code = 0; code < 256; code += 1) {
    map.set(code, String.fromCharCode(code));
  }
  return map;
}

/**
 * Apply a named base encoding to the map
 */
export function applyBaseEncoding(target: Map<number, string>, baseEncoding: string): void {
  switch (baseEncoding) {
    case 'WinAnsiEncoding':
    case 'MacRomanEncoding':
    case 'StandardEncoding':
      // ASCII range already covered by default map; extended characters
      // require lookup tables which can be layered in later as needed.
      break;
    default:
      break;
  }
}

/**
 * Extract encoding information from a font dictionary
 */
export function extractEncodingInfo(
  dictionarySource: string,
  objects: Map<string, PDFRawObject>
): { baseEncoding?: string; differences?: Map<number, string> } | undefined {
  const match = dictionarySource.match(/\/Encoding\s+/);
  if (!match) {
    return undefined;
  }

  const start = match.index ?? 0;
  let index = start + match[0].length;
  index = skipWhitespace(dictionarySource, index);
  const char = dictionarySource[index];

  if (char === '/') {
    const { value } = readName(dictionarySource, index + 1);
    return { baseEncoding: value };
  }

  if (char === '<' && dictionarySource[index + 1] === '<') {
    const { dictionary } = readDictionary(dictionarySource, index);
    return parseEncodingDictionary(dictionary);
  }

  const referenceMatch = dictionarySource.slice(index).match(/^(\d+)\s+(\d+)\s+R/);
  if (referenceMatch) {
    const id = Number(referenceMatch[1]);
    const generation = Number(referenceMatch[2]);
    const key = objectKey(id, generation);
    const encodingObject = objects.get(key);
    if (encodingObject) {
      return parseEncodingDictionary(encodingObject.dictionarySource);
    }
  }

  return undefined;
}

/**
 * Parse an encoding dictionary for BaseEncoding and Differences
 */
export function parseEncodingDictionary(
  source: string
): { baseEncoding?: string; differences?: Map<number, string> } {
  const baseEncodingMatch = source.match(/\/BaseEncoding\s+\/([^\s\/]+)/);
  const baseEncoding = baseEncodingMatch?.[1];
  const differencesMatch = source.match(/\/Differences\s*\[([\s\S]*?)\]/);
  const differences = differencesMatch ? parseDifferencesArray(differencesMatch[1]) : undefined;

  return { baseEncoding, differences };
}

/**
 * Parse a /Differences array into a map of code -> glyph name
 */
export function parseDifferencesArray(content: string): Map<number, string> {
  const map = new Map<number, string>();
  const tokenRegex = /(\d+)|\/([^\s\[\]\/]+)/g;
  let currentCode = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(content)) !== null) {
    if (match[1] !== undefined) {
      currentCode = Number(match[1]);
      continue;
    }
    const glyphName = match[2];
    map.set(currentCode & 0xff, glyphName);
    currentCode += 1;
  }

  return map;
}

/**
 * Convert a glyph name to its Unicode character
 */
export function glyphNameToUnicode(name: string): string | undefined {
  if (!name) {
    return undefined;
  }

  if (name === '.notdef') {
    return '';
  }

  const basic = BASIC_GLYPH_MAP[name];
  if (basic !== undefined) {
    return basic;
  }

  if (/^[A-Z]$/.test(name) || /^[a-z]$/.test(name)) {
    return name;
  }

  // uni<XXXX> format (possibly multiple 4-digit codes)
  if (/^uni([0-9A-Fa-f]{4})+$/.test(name)) {
    let result = '';
    for (let index = 3; index < name.length; index += 4) {
      const segment = name.slice(index, index + 4);
      const codePoint = Number.parseInt(segment, 16);
      if (!Number.isNaN(codePoint)) {
        result += String.fromCharCode(codePoint);
      }
    }
    return result || undefined;
  }

  // u<XXXXX> format (4-6 hex digits)
  if (/^u[0-9A-Fa-f]{4,6}$/.test(name)) {
    const hex = name.slice(1);
    const codePoint = Number.parseInt(hex, 16);
    if (!Number.isNaN(codePoint)) {
      return String.fromCodePoint(codePoint);
    }
  }

  return undefined;
}
