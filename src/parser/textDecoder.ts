/**
 * Text decoding utilities for PDF parsing
 */

import type { FontResource, FontMap } from './parserTypes.js';
import { CONTROL_CHAR_MATH_OVERRIDES, CONTROL_CHAR_FALLBACK } from './parserConstants.js';
import { bytesToKey } from './parserUtils.js';
import { latin1ToUint8 } from '../utils/buffer.js';

/**
 * Get control character overrides based on font type
 */
export function controlCharOverrides(font?: FontResource): Record<number, string> | undefined {
  if (!font?.baseFontName) {
    return undefined;
  }
  if (/CMSY/i.test(font.baseFontName)) {
    return CONTROL_CHAR_MATH_OVERRIDES;
  }
  return undefined;
}

/**
 * Apply control character fallback mappings
 */
export function applyControlCharFallback(value: string, font?: FontResource): string {
  if (!value) {
    return value;
  }

  const overrides = controlCharOverrides(font);

  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const code = char.charCodeAt(0);
    if (code < 32) {
      const replacement = overrides?.[code] ?? CONTROL_CHAR_FALLBACK[code];
      if (replacement !== undefined) {
        output += replacement;
      }
      continue;
    }
    output += char;
  }

  return output;
}

/**
 * Decode a single byte using encoding map
 */
export function decodeByteWithEncoding(byte: number, encodingMap?: Map<number, string>): string {
  if (!encodingMap) {
    return String.fromCharCode(byte);
  }
  const mapped = encodingMap.get(byte & 0xff);
  if (mapped !== undefined) {
    return mapped;
  }
  return String.fromCharCode(byte);
}

/**
 * Convert bytes to CID value
 */
export function bytesToCid(bytes: Uint8Array, start: number, length: number): number {
  let value = 0;
  for (let offset = 0; offset < length; offset += 1) {
    value = (value << 8) | (bytes[start + offset] ?? 0);
  }
  return value;
}

/**
 * Count spaces in a string
 */
export function countSpaces(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === ' ') {
      count += 1;
    }
  }
  return count;
}

/**
 * Look up glyph width from font resource
 */
export function lookupGlyphWidth(font: FontResource | undefined, code: number): number {
  if (!font) {
    return 500;
  }

  const widths = font.glyphWidths;
  if (widths) {
    const width = widths.get(code);
    if (typeof width === 'number' && Number.isFinite(width)) {
      return width;
    }
  }

  if (typeof font.defaultWidth === 'number' && Number.isFinite(font.defaultWidth)) {
    return font.defaultWidth;
  }

  return 500;
}

/**
 * Extract glyph codes from raw text using font's ToUnicode map
 */
export function extractGlyphCodes(rawText: string, font: FontResource | undefined): number[] {
  const bytes = latin1ToUint8(rawText);
  if (!font || font.maxCodeLength <= 1) {
    return Array.from(bytes);
  }

  const codes: number[] = [];
  const maxLength = Math.max(1, font.maxCodeLength);
  const toUnicode = font.toUnicodeMap;

  for (let index = 0; index < bytes.length; ) {
    let matchedLength = 0;

    if (toUnicode && toUnicode.size > 0) {
      const available = bytes.length - index;
      for (let length = Math.min(maxLength, available); length > 0; length -= 1) {
        const key = bytesToKey(bytes, index, length);
        if (toUnicode.has(key)) {
          matchedLength = length;
          codes.push(bytesToCid(bytes, index, length));
          break;
        }
      }
    }

    if (matchedLength === 0) {
      matchedLength = 1;
      codes.push(bytesToCid(bytes, index, matchedLength));
    }

    index += matchedLength;
  }

  return codes;
}

/**
 * Decode text using font's ToUnicode map and encoding
 */
export function decodeText(text: string, fontName: string | undefined, fonts: FontMap): string {
  if (!text) {
    return '';
  }

  if (!fontName) {
    return text;
  }

  const font = fonts.get(fontName);
  if (!font) {
    return text;
  }

  if (font.toUnicodeMap && font.toUnicodeMap.size > 0) {
    const bytes = latin1ToUint8(text);
    const maxLength = Math.max(1, font.maxCodeLength);
    let result = '';

    for (let index = 0; index < bytes.length; ) {
      let matched = false;
      const available = bytes.length - index;
      for (let length = Math.min(maxLength, available); length > 0; length -= 1) {
        const key = bytesToKey(bytes, index, length);
        const mapped = font.toUnicodeMap.get(key);
        if (mapped !== undefined) {
          result += mapped;
          index += length;
          matched = true;
          break;
        }
      }

      if (!matched) {
        result += decodeByteWithEncoding(bytes[index], font.encodingMap);
        index += 1;
      }
    }

    return applyControlCharFallback(result, font);
  }

  // Fallback to encoding map if no ToUnicode map
  if (font.encodingMap && font.encodingMap.size > 0) {
    const bytes = latin1ToUint8(text);
    let result = '';
    for (const byte of bytes) {
      result += decodeByteWithEncoding(byte, font.encodingMap);
    }
    return applyControlCharFallback(result, font);
  }

  return applyControlCharFallback(text, font);
}
