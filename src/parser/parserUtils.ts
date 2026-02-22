/**
 * Shared parsing utility functions
 */

import { isWhitespace } from './textTokenizer.js';

/**
 * Skip whitespace characters starting from index
 */
export function skipWhitespace(source: string, index: number): number {
  let pointer = index;
  while (pointer < source.length && isWhitespace(source[pointer])) {
    pointer += 1;
  }
  return pointer;
}

/**
 * Read a dictionary (<<...>>) from source starting at startIndex
 */
export function readDictionary(
  source: string,
  startIndex: number
): { dictionary: string; nextIndex: number } {
  let index = startIndex;
  let depth = 0;
  let buffer = '';

  while (index < source.length) {
    const nextTwo = source.slice(index, index + 2);
    if (nextTwo === '<<') {
      depth += 1;
      buffer += nextTwo;
      index += 2;
      continue;
    }
    if (nextTwo === '>>') {
      depth -= 1;
      buffer += nextTwo;
      index += 2;
      if (depth === 0) {
        break;
      }
      continue;
    }
    buffer += source[index];
    index += 1;
  }

  return {
    dictionary: buffer,
    nextIndex: index
  };
}

/**
 * Convert hex string to byte array
 */
export function hexToBytes(hex: string): Uint8Array {
  const sanitized = hex.replace(/\s+/g, '');
  const length = Math.ceil(sanitized.length / 2);
  const output = new Uint8Array(length);

  for (let index = 0; index < length; index += 1) {
    const start = index * 2;
    const byteHex = sanitized.slice(start, start + 2);
    output[index] = Number.parseInt(byteHex.padEnd(2, '0'), 16) & 0xff;
  }

  return output;
}

/**
 * Convert byte array slice to string key (Latin-1)
 */
export function bytesToKey(bytes: Uint8Array, start = 0, length?: number): string {
  const end = length === undefined ? bytes.length : Math.min(bytes.length, start + length);
  let result = '';
  for (let index = start; index < end; index += 1) {
    result += String.fromCharCode(bytes[index]);
  }
  return result;
}

/**
 * Convert integer to byte array with specified length
 */
export function intToBytes(value: number, byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  let v = value;
  for (let index = byteLength - 1; index >= 0; index -= 1) {
    bytes[index] = v & 0xff;
    v >>= 8;
  }
  return bytes;
}

/**
 * Convert hex string to Unicode string (big-endian)
 */
export function hexToUnicodeString(hex: string): string {
  const bytes = hexToBytes(hex);
  if (bytes.length === 0) {
    return '';
  }

  if (bytes.length % 2 !== 0) {
    // Fallback: treat as Latin-1 when byte count is odd.
    return bytesToKey(bytes);
  }

  let result = '';
  for (let index = 0; index < bytes.length; index += 2) {
    const codePoint = (bytes[index] << 8) | bytes[index + 1];
    result += String.fromCharCode(codePoint);
  }
  return result;
}
