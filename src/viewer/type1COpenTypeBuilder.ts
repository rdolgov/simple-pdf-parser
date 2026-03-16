import type { PDFEmbeddedFontResource } from '../types.js';
import {
  resolveCffStandardString,
  resolveStandardEncodingGlyphName
} from './cffStandardStrings.js';

export interface SyntheticEmbeddedFontProgram {
  buffer: Uint8Array;
  glyphCodeToText: Map<number, string>;
}

type CffTopDict = {
  charsetOffset?: number;
  encodingOffset?: number;
  charStringsOffset?: number;
};

type CffIndex = {
  count: number;
  objects: Uint8Array[];
  nextOffset: number;
};

const PRIVATE_USE_AREA_START = 0xe000;
const OTTO_TAG = 0x4f54544f;
const CHECKSUM_ADJUSTMENT_MAGIC = 0xb1b0afba;

export function buildSyntheticOpenTypeFromType1C(
  resource: PDFEmbeddedFontResource
): SyntheticEmbeddedFontProgram | undefined {
  if (!resource.data || resource.data.length === 0) {
    return undefined;
  }

  const parsed = parseType1CProgram(resource.data);
  if (!parsed || parsed.glyphCount <= 0 || parsed.codeToGlyphId.size === 0) {
    return undefined;
  }

  const glyphEntries = Array.from(parsed.codeToGlyphId.entries())
    .filter((entry) => entry[1] > 0 && entry[1] < parsed.glyphCount)
    .sort((left, right) => left[0] - right[0])
    .map(([glyphCode, glyphId], index) => ({
      glyphCode,
      glyphId,
      codePoint: PRIVATE_USE_AREA_START + index
    }));

  if (glyphEntries.length === 0) {
    return undefined;
  }

  const glyphCodeToText = new Map<number, string>();
  for (const entry of glyphEntries) {
    glyphCodeToText.set(entry.glyphCode, String.fromCharCode(entry.codePoint));
  }

  return {
    buffer: buildSyntheticOpenTypeBuffer(resource, glyphEntries),
    glyphCodeToText
  };
}

function parseType1CProgram(data: Uint8Array): { glyphCount: number; codeToGlyphId: Map<number, number> } | undefined {
  if (data.length < 4) {
    return undefined;
  }

  const headerSize = data[2] ?? 4;
  let offset = headerSize;
  const nameIndex = readIndex(data, offset);
  offset = nameIndex.nextOffset;
  const topDictIndex = readIndex(data, offset);
  offset = topDictIndex.nextOffset;
  const stringIndex = readIndex(data, offset);
  offset = stringIndex.nextOffset;

  if (topDictIndex.objects.length === 0) {
    return undefined;
  }

  const customStrings = stringIndex.objects.map(decodeLatin1);
  const topDict = parseTopDict(topDictIndex.objects[0]);
  if (!topDict.charStringsOffset) {
    return undefined;
  }

  const charStringsIndex = readIndex(data, topDict.charStringsOffset);
  const glyphCount = charStringsIndex.count;
  if (glyphCount <= 0) {
    return undefined;
  }

  const glyphNames = topDict.charsetOffset
    ? parseCharset(data, topDict.charsetOffset, glyphCount, customStrings)
    : undefined;

  const codeToGlyphId = parseCodeToGlyphId(
    data,
    topDict.encodingOffset,
    glyphCount,
    glyphNames
  );

  return {
    glyphCount,
    codeToGlyphId
  };
}

function parseTopDict(data: Uint8Array): CffTopDict {
  const result: CffTopDict = {};
  const operands: number[] = [];

  for (let offset = 0; offset < data.length; ) {
    const byte = data[offset];
    if (byte <= 21) {
      const operator = byte === 12 ? 1200 + (data[offset + 1] ?? 0) : byte;
      if (operator === 15) {
        result.charsetOffset = operands[operands.length - 1];
      } else if (operator === 16) {
        result.encodingOffset = operands[operands.length - 1];
      } else if (operator === 17) {
        result.charStringsOffset = operands[operands.length - 1];
      }
      operands.length = 0;
      offset += byte === 12 ? 2 : 1;
      continue;
    }

    const decoded = readDictNumber(data, offset);
    operands.push(decoded.value);
    offset = decoded.nextOffset;
  }

  return result;
}

function parseCharset(
  data: Uint8Array,
  offset: number,
  glyphCount: number,
  customStrings: string[]
): string[] | undefined {
  if (offset <= 2 || offset >= data.length) {
    return undefined;
  }

  const format = data[offset];
  const glyphNames = new Array<string>(glyphCount);
  glyphNames[0] = '.notdef';
  let cursor = offset + 1;
  let glyphId = 1;

  if (format === 0) {
    while (glyphId < glyphCount && cursor + 1 < data.length) {
      const sid = readUInt16(data, cursor);
      cursor += 2;
      glyphNames[glyphId] = resolveCffStandardString(sid, customStrings) ?? `.sid${sid}`;
      glyphId += 1;
    }
    return glyphNames;
  }

  if (format === 1 || format === 2) {
    while (glyphId < glyphCount && cursor + 2 < data.length) {
      const sid = readUInt16(data, cursor);
      cursor += 2;
      const count = format === 1 ? data[cursor] ?? 0 : readUInt16(data, cursor);
      cursor += format === 1 ? 1 : 2;
      for (let index = 0; index <= count && glyphId < glyphCount; index += 1) {
        const name = resolveCffStandardString(sid + index, customStrings) ?? `.sid${sid + index}`;
        glyphNames[glyphId] = name;
        glyphId += 1;
      }
    }
    return glyphNames;
  }

  return undefined;
}

function parseCodeToGlyphId(
  data: Uint8Array,
  encodingOffset: number | undefined,
  glyphCount: number,
  glyphNames: string[] | undefined
): Map<number, number> {
  if (encodingOffset === undefined) {
    return new Map();
  }

  if (encodingOffset === 0 && glyphNames) {
    const nameToGlyphId = new Map<string, number>();
    glyphNames.forEach((name, glyphId) => {
      if (name) {
        nameToGlyphId.set(name, glyphId);
      }
    });

    const map = new Map<number, number>();
    for (let code = 0; code < 256; code += 1) {
      const glyphName = resolveStandardEncodingGlyphName(code);
      const glyphId = glyphName ? nameToGlyphId.get(glyphName) : undefined;
      if (glyphId !== undefined) {
        map.set(code, glyphId);
      }
    }
    return map;
  }

  if (encodingOffset <= 1 || encodingOffset >= data.length) {
    return new Map();
  }

  const formatByte = data[encodingOffset];
  const format = formatByte & 0x7f;
  const hasSupplement = (formatByte & 0x80) !== 0;
  const map = new Map<number, number>();
  let cursor = encodingOffset + 1;

  if (format === 0) {
    const codeCount = data[cursor] ?? 0;
    cursor += 1;
    for (let index = 0; index < codeCount && index + 1 < glyphCount; index += 1) {
      const code = data[cursor + index];
      if (code !== undefined) {
        map.set(code, index + 1);
      }
    }
    cursor += codeCount;
  } else if (format === 1) {
    const rangeCount = data[cursor] ?? 0;
    cursor += 1;
    let glyphId = 1;
    for (let rangeIndex = 0; rangeIndex < rangeCount && glyphId < glyphCount; rangeIndex += 1) {
      const firstCode = data[cursor] ?? 0;
      const leftCount = data[cursor + 1] ?? 0;
      cursor += 2;
      for (let offset = 0; offset <= leftCount && glyphId < glyphCount; offset += 1) {
        map.set((firstCode + offset) & 0xff, glyphId);
        glyphId += 1;
      }
    }
  }

  if (hasSupplement && glyphNames) {
    const nameToGlyphId = new Map<string, number>();
    glyphNames.forEach((name, glyphId) => {
      if (name) {
        nameToGlyphId.set(name, glyphId);
      }
    });

    const supplementCount = data[cursor] ?? 0;
    cursor += 1;
    for (let index = 0; index < supplementCount && cursor + 2 < data.length; index += 1) {
      const code = data[cursor] ?? 0;
      const sid = readUInt16(data, cursor + 1);
      cursor += 3;
      const name = resolveCffStandardString(sid, []);
      const glyphId = name ? nameToGlyphId.get(name) : undefined;
      if (glyphId !== undefined) {
        map.set(code, glyphId);
      }
    }
  }

  return map;
}

function buildSyntheticOpenTypeBuffer(
  resource: PDFEmbeddedFontResource,
  glyphEntries: Array<{ glyphCode: number; glyphId: number; codePoint: number }>
): Uint8Array {
  const glyphCount = Math.max(1, glyphEntries.reduce((max, entry) => Math.max(max, entry.glyphId), 0) + 1);
  const familyName = sanitizePostScriptName(resource.baseFontName ?? 'EmbeddedFont');
  const postScriptName = `${familyName}-${sanitizePostScriptName(resource.fontKey)}`;
  const bbox = resource.descriptor?.bbox ?? [0, -250, 1000, 900];
  const ascender = clampInt16(resource.descriptor?.ascent ?? 800);
  const descender = clampInt16(resource.descriptor?.descent ?? -200);
  const italicAngle = resource.descriptor?.italicAngle ?? 0;
  const advanceWidths = buildAdvanceWidths(resource, glyphEntries, glyphCount);
  const advanceWidth = Math.max(...advanceWidths, 0);
  const avgWidth = Math.round(
    advanceWidths.reduce((sum, value) => sum + value, 0) / Math.max(advanceWidths.length, 1)
  );
  const maxCodePoint = glyphEntries[glyphEntries.length - 1]?.codePoint ?? PRIVATE_USE_AREA_START;
  const minCodePoint = glyphEntries[0]?.codePoint ?? PRIVATE_USE_AREA_START;

  const tables = [
    { tag: 'CFF ', data: cloneBytes(resource.data) },
    { tag: 'OS/2', data: buildOs2Table(avgWidth, ascender, descender, minCodePoint, maxCodePoint) },
    { tag: 'cmap', data: buildCmapTable(glyphEntries) },
    { tag: 'head', data: buildHeadTable(bbox, italicAngle, isBold(resource), isItalic(resource)) },
    { tag: 'hhea', data: buildHheaTable(advanceWidth, ascender, descender, glyphCount) },
    { tag: 'hmtx', data: buildHmtxTable(advanceWidths) },
    { tag: 'maxp', data: buildMaxpTable(glyphCount) },
    { tag: 'name', data: buildNameTable(familyName, postScriptName) },
    { tag: 'post', data: buildPostTable(italicAngle) }
  ].sort((left, right) => left.tag.localeCompare(right.tag));

  return buildSfnt(tables);
}

function buildCmapTable(
  glyphEntries: Array<{ glyphCode: number; glyphId: number; codePoint: number }>
): Uint8Array {
  const segCount = glyphEntries.length + 1;
  const segCountX2 = segCount * 2;
  const searchPower = Math.floor(Math.log2(Math.max(segCount, 1)));
  const searchRange = Math.pow(2, searchPower) * 2;
  const entrySelector = searchPower;
  const rangeShift = segCountX2 - searchRange;
  const subtableLength = 16 + segCount * 8;
  const table = new Uint8Array(12 + subtableLength);
  const view = new DataView(table.buffer);

  view.setUint16(0, 0);
  view.setUint16(2, 1);
  view.setUint16(4, 3);
  view.setUint16(6, 1);
  view.setUint32(8, 12);

  const offset = 12;
  view.setUint16(offset, 4);
  view.setUint16(offset + 2, subtableLength);
  view.setUint16(offset + 4, 0);
  view.setUint16(offset + 6, segCountX2);
  view.setUint16(offset + 8, searchRange);
  view.setUint16(offset + 10, entrySelector);
  view.setUint16(offset + 12, rangeShift);

  let cursor = offset + 14;
  for (const entry of glyphEntries) {
    view.setUint16(cursor, entry.codePoint);
    cursor += 2;
  }
  view.setUint16(cursor, 0xffff);
  cursor += 2;
  view.setUint16(cursor, 0);
  cursor += 2;

  for (const entry of glyphEntries) {
    view.setUint16(cursor, entry.codePoint);
    cursor += 2;
  }
  view.setUint16(cursor, 0xffff);
  cursor += 2;

  for (const entry of glyphEntries) {
    view.setUint16(cursor, (entry.glyphId - entry.codePoint) & 0xffff);
    cursor += 2;
  }
  view.setUint16(cursor, 1);
  cursor += 2;

  for (let index = 0; index < segCount; index += 1) {
    view.setUint16(cursor, 0);
    cursor += 2;
  }

  return table;
}

function buildHeadTable(
  bbox: [number, number, number, number],
  italicAngle: number,
  bold: boolean,
  italic: boolean
): Uint8Array {
  const table = new Uint8Array(54);
  const view = new DataView(table.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint32(4, 0x00010000);
  view.setUint32(8, 0);
  view.setUint32(12, 0x5f0f3cf5);
  view.setUint16(16, 0x000b);
  view.setUint16(18, 1000);
  view.setBigUint64(20, 0n);
  view.setBigUint64(28, 0n);
  view.setInt16(36, clampInt16(bbox[0]));
  view.setInt16(38, clampInt16(bbox[1]));
  view.setInt16(40, clampInt16(bbox[2]));
  view.setInt16(42, clampInt16(bbox[3]));
  const macStyle = (bold ? 1 : 0) | (italic ? 2 : 0);
  view.setUint16(44, macStyle);
  view.setUint16(46, 8);
  view.setInt16(48, 2);
  view.setInt16(50, 0);
  view.setInt16(52, 0);
  return table;
}

function buildHheaTable(
  advanceWidth: number,
  ascender: number,
  descender: number,
  glyphCount: number
): Uint8Array {
  const table = new Uint8Array(36);
  const view = new DataView(table.buffer);
  view.setUint32(0, 0x00010000);
  view.setInt16(4, ascender);
  view.setInt16(6, descender);
  view.setInt16(8, 0);
  view.setUint16(10, advanceWidth);
  view.setInt16(12, 0);
  view.setInt16(14, 0);
  view.setInt16(16, advanceWidth);
  view.setInt16(18, 1);
  view.setInt16(20, 0);
  view.setInt16(22, 0);
  view.setInt16(24, 0);
  view.setInt16(26, 0);
  view.setInt16(28, 0);
  view.setInt16(30, 0);
  view.setInt16(32, 0);
  view.setUint16(34, glyphCount);
  return table;
}

function buildHmtxTable(advanceWidths: number[]): Uint8Array {
  const glyphCount = advanceWidths.length;
  const table = new Uint8Array(glyphCount * 4);
  const view = new DataView(table.buffer);
  for (let index = 0; index < glyphCount; index += 1) {
    const offset = index * 4;
    view.setUint16(offset, clampUInt16(advanceWidths[index] || 0));
    view.setInt16(offset + 2, 0);
  }
  return table;
}

function buildMaxpTable(glyphCount: number): Uint8Array {
  const table = new Uint8Array(6);
  const view = new DataView(table.buffer);
  view.setUint32(0, 0x00005000);
  view.setUint16(4, glyphCount);
  return table;
}

function buildNameTable(familyName: string, postScriptName: string): Uint8Array {
  const records = [
    { nameId: 1, value: familyName },
    { nameId: 2, value: 'Regular' },
    { nameId: 6, value: postScriptName }
  ];

  const encodedValues = records.map((record) => ({
    ...record,
    data: encodeUtf16Be(record.value)
  }));

  const table = new Uint8Array(6 + encodedValues.length * 12 + encodedValues.reduce((sum, record) => sum + record.data.length, 0));
  const view = new DataView(table.buffer);
  view.setUint16(0, 0);
  view.setUint16(2, encodedValues.length);
  view.setUint16(4, 6 + encodedValues.length * 12);

  let recordOffset = 6;
  let stringOffset = 0;
  for (const record of encodedValues) {
    view.setUint16(recordOffset, 3);
    view.setUint16(recordOffset + 2, 1);
    view.setUint16(recordOffset + 4, 0x0409);
    view.setUint16(recordOffset + 6, record.nameId);
    view.setUint16(recordOffset + 8, record.data.length);
    view.setUint16(recordOffset + 10, stringOffset);
    table.set(record.data, view.getUint16(4) + stringOffset);
    stringOffset += record.data.length;
    recordOffset += 12;
  }

  return table;
}

function buildOs2Table(
  avgWidth: number,
  ascender: number,
  descender: number,
  minCodePoint: number,
  maxCodePoint: number
): Uint8Array {
  const table = new Uint8Array(86);
  const view = new DataView(table.buffer);
  view.setUint16(0, 1);
  view.setInt16(2, clampInt16(avgWidth));
  view.setUint16(4, 400);
  view.setUint16(6, 5);
  view.setUint16(8, 0);
  view.setInt16(10, 650);
  view.setInt16(12, 699);
  view.setInt16(14, 0);
  view.setInt16(16, 140);
  view.setInt16(18, 650);
  view.setInt16(20, 699);
  view.setInt16(22, 0);
  view.setInt16(24, 140);
  view.setInt16(26, 0);
  view.setInt16(28, 0);
  view.setInt16(30, 0);
  view.setInt16(32, 0);
  for (let index = 0; index < 10; index += 1) {
    table[32 + index] = 0;
  }
  view.setUint32(42, 0);
  view.setUint32(46, 0);
  view.setUint32(50, 0);
  view.setUint32(54, 0);
  table.set([0x50, 0x44, 0x46, 0x20], 58);
  view.setUint16(62, minCodePoint & 0xffff);
  view.setUint16(64, maxCodePoint & 0xffff);
  view.setInt16(66, ascender);
  view.setInt16(68, descender);
  view.setInt16(70, 0);
  view.setUint16(72, ascender > 0 ? ascender : 800);
  view.setUint16(74, descender < 0 ? -descender : 200);
  view.setUint32(78, 0);
  view.setUint32(82, 0);
  return table;
}

function buildPostTable(italicAngle: number): Uint8Array {
  const table = new Uint8Array(32);
  const view = new DataView(table.buffer);
  view.setUint32(0, 0x00030000);
  view.setInt32(4, toFixed16_16(italicAngle));
  view.setInt16(8, -100);
  view.setInt16(10, 50);
  view.setUint32(12, 0);
  view.setUint32(16, 0);
  view.setUint32(20, 0);
  view.setUint32(24, 0);
  view.setUint32(28, 0);
  return table;
}

function buildSfnt(tables: Array<{ tag: string; data: Uint8Array }>): Uint8Array {
  const numTables = tables.length;
  const tableBuffers = tables.map((table) => ({ ...table, data: padTo4(table.data) }));
  const searchPower = Math.floor(Math.log2(Math.max(numTables, 1)));
  const searchRange = Math.pow(2, searchPower) * 16;
  const entrySelector = searchPower;
  const rangeShift = numTables * 16 - searchRange;
  const headerSize = 12 + numTables * 16;
  const totalSize = headerSize + tableBuffers.reduce((sum, table) => sum + table.data.length, 0);
  const sfnt = new Uint8Array(totalSize);
  const view = new DataView(sfnt.buffer);

  view.setUint32(0, OTTO_TAG);
  view.setUint16(4, numTables);
  view.setUint16(6, searchRange);
  view.setUint16(8, entrySelector);
  view.setUint16(10, rangeShift);

  let dataOffset = headerSize;
  let headOffset = 0;
  tableBuffers.forEach((table, index) => {
    const recordOffset = 12 + index * 16;
    writeTag(view, recordOffset, table.tag);
    view.setUint32(recordOffset + 4, computeChecksum(table.data));
    view.setUint32(recordOffset + 8, dataOffset);
    view.setUint32(recordOffset + 12, table.data.length);
    sfnt.set(table.data, dataOffset);
    if (table.tag === 'head') {
      headOffset = dataOffset;
    }
    dataOffset += table.data.length;
  });

  const totalChecksum = computeChecksum(sfnt);
  const adjustment = (CHECKSUM_ADJUSTMENT_MAGIC - totalChecksum) >>> 0;
  if (headOffset > 0) {
    view.setUint32(headOffset + 8, adjustment);
  }

  return sfnt;
}

function readIndex(data: Uint8Array, offset: number): CffIndex {
  if (offset + 2 > data.length) {
    return { count: 0, objects: [], nextOffset: offset };
  }

  const count = readUInt16(data, offset);
  if (count === 0) {
    return { count, objects: [], nextOffset: offset + 2 };
  }

  const offSize = data[offset + 2];
  const offsetsStart = offset + 3;
  const dataStart = offsetsStart + (count + 1) * offSize;
  const relativeOffsets: number[] = [];
  for (let index = 0; index < count + 1; index += 1) {
    relativeOffsets.push(readOffset(data, offsetsStart + index * offSize, offSize));
  }

  const objects: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = dataStart + relativeOffsets[index] - 1;
    const end = dataStart + relativeOffsets[index + 1] - 1;
    objects.push(data.slice(start, end));
  }

  return {
    count,
    objects,
    nextOffset: dataStart + relativeOffsets[count] - 1
  };
}

function readDictNumber(data: Uint8Array, offset: number): { value: number; nextOffset: number } {
  const byte = data[offset];
  if (byte >= 32 && byte <= 246) {
    return { value: byte - 139, nextOffset: offset + 1 };
  }
  if (byte >= 247 && byte <= 250) {
    return { value: (byte - 247) * 256 + (data[offset + 1] ?? 0) + 108, nextOffset: offset + 2 };
  }
  if (byte >= 251 && byte <= 254) {
    return { value: -(byte - 251) * 256 - (data[offset + 1] ?? 0) - 108, nextOffset: offset + 2 };
  }
  if (byte === 28) {
    return { value: readInt16(data, offset + 1), nextOffset: offset + 3 };
  }
  if (byte === 29) {
    return { value: readInt32(data, offset + 1), nextOffset: offset + 5 };
  }
  if (byte === 30) {
    let cursor = offset + 1;
    let text = '';
    let done = false;
    while (!done && cursor < data.length) {
      const packed = data[cursor];
      cursor += 1;
      const nibbles = [(packed >> 4) & 0x0f, packed & 0x0f];
      for (const nibble of nibbles) {
        if (nibble === 0x0f) {
          done = true;
          break;
        }
        text += decodeRealNibble(nibble);
      }
    }
    return { value: Number(text), nextOffset: cursor };
  }

  return { value: 0, nextOffset: offset + 1 };
}

function readOffset(data: Uint8Array, offset: number, size: number): number {
  let value = 0;
  for (let index = 0; index < size; index += 1) {
    value = (value << 8) | (data[offset + index] ?? 0);
  }
  return value;
}

function readUInt16(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0);
}

function readInt16(data: Uint8Array, offset: number): number {
  const value = readUInt16(data, offset);
  return value & 0x8000 ? value - 0x10000 : value;
}

function readInt32(data: Uint8Array, offset: number): number {
  const value =
    ((data[offset] ?? 0) << 24) |
    ((data[offset + 1] ?? 0) << 16) |
    ((data[offset + 2] ?? 0) << 8) |
    (data[offset + 3] ?? 0);
  return value | 0;
}

function decodeRealNibble(nibble: number): string {
  switch (nibble) {
    case 0x0a:
      return '.';
    case 0x0b:
      return 'E';
    case 0x0c:
      return 'E-';
    case 0x0d:
      return '';
    case 0x0e:
      return '-';
    default:
      return String(nibble);
  }
}

function decodeLatin1(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) {
    result += String.fromCharCode(byte);
  }
  return result;
}

function encodeUtf16Be(value: string): Uint8Array {
  const buffer = new Uint8Array(value.length * 2);
  const view = new DataView(buffer.buffer);
  for (let index = 0; index < value.length; index += 1) {
    view.setUint16(index * 2, value.charCodeAt(index));
  }
  return buffer;
}

function padTo4(data: Uint8Array): Uint8Array {
  const paddedLength = (data.length + 3) & ~3;
  if (paddedLength === data.length) {
    return data;
  }
  const padded = new Uint8Array(paddedLength);
  padded.set(data);
  return padded;
}

function computeChecksum(data: Uint8Array): number {
  const padded = padTo4(data);
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  let sum = 0;
  for (let offset = 0; offset < padded.length; offset += 4) {
    sum = (sum + view.getUint32(offset)) >>> 0;
  }
  return sum >>> 0;
}

function writeTag(view: DataView, offset: number, tag: string): void {
  for (let index = 0; index < 4; index += 1) {
    view.setUint8(offset + index, tag.charCodeAt(index) || 0x20);
  }
}

function toFixed16_16(value: number): number {
  return Math.round(value * 65536);
}

function sanitizePostScriptName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, '-');
}

function buildAdvanceWidths(
  resource: PDFEmbeddedFontResource,
  glyphEntries: Array<{ glyphCode: number; glyphId: number; codePoint: number }>,
  glyphCount: number
): number[] {
  const defaultWidth = clampUInt16(resource.defaultWidth ?? 1000);
  const widths = new Array<number>(glyphCount).fill(defaultWidth);
  widths[0] = defaultWidth;

  for (const entry of glyphEntries) {
    const width = resource.glyphWidths?.[entry.glyphCode] ?? resource.defaultWidth ?? defaultWidth;
    widths[entry.glyphId] = clampUInt16(width);
  }

  return widths;
}

function clampInt16(value: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}

function clampUInt16(value: number): number {
  return Math.max(0, Math.min(0xffff, Math.round(value)));
}

function isItalic(resource: PDFEmbeddedFontResource): boolean {
  return (resource.descriptor?.italicAngle ?? 0) < 0 || /italic|oblique|cmti|cmsl/i.test(resource.baseFontName ?? '');
}

function isBold(resource: PDFEmbeddedFontResource): boolean {
  return /bold|cmbx|cmbx/i.test(resource.baseFontName ?? '');
}

function cloneBytes(data: Uint8Array): Uint8Array {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy;
}
