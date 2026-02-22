/**
 * Cross-reference table parsing for PDF documents
 */

import type { XRefEntry } from './parserTypes.js';
import { decodeFlate } from './streamDecoder.js';

/** Generate object key from id and generation */
export function objectKey(id: number, generation: number): string {
  return `${id} ${generation}`;
}

/**
 * Parse the cross-reference table, following /Prev chains.
 * Supports both traditional xref tables and cross-reference streams (PDF 1.5+).
 */
export function parseXRefTable(content: string): Map<string, XRefEntry> {
  const entries = new Map<string, XRefEntry>();
  const startxrefIndex = content.lastIndexOf('startxref');

  if (startxrefIndex === -1) {
    return entries;
  }

  const startxrefMatch = /startxref\s+(\d+)/.exec(content.slice(startxrefIndex));
  if (!startxrefMatch) {
    return entries;
  }

  const initialOffset = Number(startxrefMatch[1]);
  if (!Number.isFinite(initialOffset) || initialOffset < 0 || initialOffset >= content.length) {
    return entries;
  }

  const pending: number[] = [initialOffset];
  const visited = new Set<number>();

  while (pending.length > 0) {
    const offset = pending.pop();
    if (offset === undefined || visited.has(offset)) {
      continue;
    }
    visited.add(offset);

    // Try traditional xref table first
    const slice = content.slice(offset);
    const isTraditional = /^\s*xref\b/.test(slice);

    let prevOffset: number | undefined;

    if (isTraditional) {
      ({ prevOffset } = parseXRefSection(content, offset, entries));
    } else {
      ({ prevOffset } = parseXRefStream(content, offset, entries));
    }

    if (prevOffset !== undefined && !visited.has(prevOffset)) {
      pending.push(prevOffset);
    }
  }

  return entries;
}

/**
 * Parse a single traditional xref section at the given offset
 */
export function parseXRefSection(
  content: string,
  offset: number,
  entries: Map<string, XRefEntry>
): { prevOffset?: number } {
  const slice = content.slice(offset).replace(/\r\n/g, '\n');
  if (!slice.startsWith('xref')) {
    return {};
  }

  const lines = slice.split('\n');
  let lineIndex = 1;

  while (lineIndex < lines.length) {
    const rawLine = lines[lineIndex] ?? '';
    const line = rawLine.trim();

    if (line === '') {
      lineIndex += 1;
      continue;
    }

    if (line.startsWith('trailer')) {
      break;
    }

    const subsectionMatch = line.match(/^(\d+)\s+(\d+)$/);
    if (!subsectionMatch) {
      break;
    }

    const startObject = Number(subsectionMatch[1]);
    const count = Number(subsectionMatch[2]);
    lineIndex += 1;

    for (let entryIndex = 0; entryIndex < count && lineIndex < lines.length; entryIndex += 1, lineIndex += 1) {
      const entryLine = lines[lineIndex] ?? '';
      const entryMatch = entryLine.match(/^(\d{10})\s+(\d{5})\s+([nf])\s*$/);
      if (!entryMatch) {
        continue;
      }

      const byteOffset = Number.parseInt(entryMatch[1], 10);
      const generation = Number.parseInt(entryMatch[2], 10);
      const inUse = entryMatch[3] === 'n';
      const objectNumber = startObject + entryIndex;
      const key = objectKey(objectNumber, generation);

      entries.set(key, {
        objectNumber,
        generation,
        offset: byteOffset,
        inUse
      });
    }
  }

  const trailerMatch = slice.match(/trailer\s*<<([\s\S]*?)>>/);
  if (!trailerMatch) {
    return {};
  }

  const trailer = trailerMatch[1];
  const prevMatch = trailer.match(/\/Prev\s+(\d+)/);
  const prevOffset = prevMatch ? Number(prevMatch[1]) : undefined;

  if (prevOffset !== undefined && (!Number.isFinite(prevOffset) || prevOffset < 0 || prevOffset >= content.length)) {
    return {};
  }

  return { prevOffset };
}

/**
 * Parse a cross-reference stream (PDF 1.5+) at the given offset.
 * These are regular objects with /Type /XRef that contain a binary stream
 * encoding the xref entries.
 */
export function parseXRefStream(
  content: string,
  offset: number,
  entries: Map<string, XRefEntry>
): { prevOffset?: number } {
  const slice = content.slice(offset);

  // Must start with an object header (N M obj)
  const headerMatch = /^(\d+)\s+(\d+)\s+obj\s*/.exec(slice);
  if (!headerMatch) {
    return {};
  }

  // Find the dictionary - read until >> before stream
  const afterHeader = slice.slice(headerMatch[0].length);

  // Extract the full dictionary by matching nested << >>
  if (!afterHeader.startsWith('<<')) {
    return {};
  }

  let depth = 0;
  let dictEnd = 0;
  for (let i = 0; i < afterHeader.length - 1; i++) {
    if (afterHeader[i] === '<' && afterHeader[i + 1] === '<') {
      depth++;
      i++;
    } else if (afterHeader[i] === '>' && afterHeader[i + 1] === '>') {
      depth--;
      i++;
      if (depth === 0) {
        dictEnd = i + 1;
        break;
      }
    }
  }

  if (dictEnd === 0) {
    return {};
  }

  const dict = afterHeader.slice(0, dictEnd);

  // Verify this is a /Type /XRef object
  if (!/\/Type\s*\/XRef/.test(dict)) {
    return {};
  }

  // Parse /W array (field widths)
  const wMatch = dict.match(/\/W\s*\[([^\]]+)\]/);
  if (!wMatch) {
    return {};
  }
  const W = wMatch[1].trim().split(/\s+/).map(Number);
  if (W.length < 3) {
    return {};
  }

  // Parse /Size
  const sizeMatch = dict.match(/\/Size\s+(\d+)/);
  const size = sizeMatch ? Number(sizeMatch[1]) : 0;

  // Parse /Index array (optional, defaults to [0 Size])
  const indexMatch = dict.match(/\/Index\s*\[([^\]]+)\]/);
  let indexPairs: number[];
  if (indexMatch) {
    indexPairs = indexMatch[1].trim().split(/\s+/).map(Number);
  } else {
    indexPairs = [0, size];
  }

  // Parse /Length
  const lengthMatch = dict.match(/\/Length\s+(\d+)/);
  if (!lengthMatch) {
    return {};
  }
  const streamLength = Number(lengthMatch[1]);

  // Parse /DecodeParms for predictor
  const predictorMatch = dict.match(/\/Predictor\s+(\d+)/);
  const predictor = predictorMatch ? Number(predictorMatch[1]) : 1;
  const columnsMatch = dict.match(/\/Columns\s+(\d+)/);
  const columns = columnsMatch ? Number(columnsMatch[1]) : (W[0] + W[1] + W[2]);

  // Determine filter
  const hasFlate = /\/Filter\s*\/FlateDecode/.test(dict);

  // Locate stream data
  const streamKeyword = afterHeader.indexOf('stream', dictEnd);
  if (streamKeyword === -1) {
    return {};
  }

  let dataStart = offset + headerMatch[0].length + streamKeyword + 'stream'.length;
  if (content[dataStart] === '\r' && content[dataStart + 1] === '\n') {
    dataStart += 2;
  } else if (content[dataStart] === '\n') {
    dataStart += 1;
  }

  // Read raw stream bytes
  const rawBytes = new Uint8Array(streamLength);
  for (let i = 0; i < streamLength; i++) {
    rawBytes[i] = content.charCodeAt(dataStart + i) & 0xFF;
  }

  // Decompress if needed
  let decoded: Uint8Array;
  try {
    decoded = hasFlate ? decodeFlate(rawBytes) : rawBytes;
  } catch {
    return {};
  }

  // Apply PNG predictor if needed (predictor >= 10)
  const rowSize = columns;
  let data: Uint8Array;

  if (predictor >= 10) {
    const rawRowSize = rowSize + 1; // predictor byte + data
    const numRows = Math.floor(decoded.length / rawRowSize);
    data = new Uint8Array(numRows * rowSize);
    const prev = new Uint8Array(rowSize);

    for (let row = 0; row < numRows; row++) {
      const predByte = decoded[row * rawRowSize];
      for (let col = 0; col < rowSize; col++) {
        let val = decoded[row * rawRowSize + 1 + col];
        if (predByte === 2) {
          // PNG Up
          val = (val + prev[col]) & 0xFF;
        }
        // predByte === 0 (None) or 1 (Sub) handled implicitly
        if (predByte === 1 && col > 0) {
          val = (val + data[row * rowSize + col - 1]) & 0xFF;
        }
        data[row * rowSize + col] = val;
        prev[col] = val;
      }
    }
  } else {
    data = decoded;
  }

  // Parse entries using W field widths
  const [w0, w1, w2] = W;
  const entrySize = w0 + w1 + w2;
  let dataOffset = 0;

  for (let pairIdx = 0; pairIdx + 1 < indexPairs.length; pairIdx += 2) {
    const startObj = indexPairs[pairIdx];
    const count = indexPairs[pairIdx + 1];

    for (let i = 0; i < count; i++) {
      if (dataOffset + entrySize > data.length) {
        break;
      }

      // Read type field
      let type = w0 === 0 ? 1 : 0; // default type is 1 if w0 is 0
      for (let b = 0; b < w0; b++) {
        type = (type << 8) | data[dataOffset + b];
      }

      // Read field2
      let field2 = 0;
      for (let b = 0; b < w1; b++) {
        field2 = (field2 << 8) | data[dataOffset + w0 + b];
      }

      // Read field3
      let field3 = 0;
      for (let b = 0; b < w2; b++) {
        field3 = (field3 << 8) | data[dataOffset + w0 + w1 + b];
      }

      const objectNumber = startObj + i;
      dataOffset += entrySize;

      if (type === 0) {
        // Free object
        continue;
      }

      if (type === 1) {
        // Normal object: field2 = byte offset, field3 = generation
        const key = objectKey(objectNumber, field3);
        if (!entries.has(key)) {
          entries.set(key, {
            objectNumber,
            generation: field3,
            offset: field2,
            inUse: true
          });
        }
      } else if (type === 2) {
        // Compressed object in ObjStm: field2 = ObjStm number, field3 = index within ObjStm
        const key = objectKey(objectNumber, 0);
        if (!entries.has(key)) {
          entries.set(key, {
            objectNumber,
            generation: 0,
            offset: 0,
            inUse: true,
            containingObjStm: field2,
            indexInObjStm: field3
          });
        }
      }
    }
  }

  // Parse /Prev for chaining
  const prevMatch = dict.match(/\/Prev\s+(\d+)/);
  const prevOffset = prevMatch ? Number(prevMatch[1]) : undefined;

  if (prevOffset !== undefined && (!Number.isFinite(prevOffset) || prevOffset < 0 || prevOffset >= content.length)) {
    return {};
  }

  return { prevOffset };
}
