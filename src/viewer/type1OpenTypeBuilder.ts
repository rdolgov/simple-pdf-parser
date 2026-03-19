import type { PDFEmbeddedFontResource, Type3PathCommand } from '../types.js';
import { CFF_STANDARD_STRINGS } from './cffStandardStrings.js';
import type { ParsedType1Font, ParsedType1Glyph } from './type1FontProgram.js';

export interface SyntheticEmbeddedFontProgram {
  buffer: Uint8Array;
  glyphCodeToText: Map<number, string>;
}

type SyntheticGlyph = {
  glyphId: number;
  glyphName: string;
  width: number;
  pathCommands: Type3PathCommand[];
};

type CmapEntry = {
  glyphCode: number;
  glyphId: number;
  codePoint: number;
};

const PRIVATE_USE_AREA_START = 0xe000;
const OTTO_TAG = 0x4f54544f;
const CHECKSUM_ADJUSTMENT_MAGIC = 0xb1b0afba;

export function buildSyntheticOpenTypeFromType1(
  resource: PDFEmbeddedFontResource,
  parsed: ParsedType1Font
): SyntheticEmbeddedFontProgram | undefined {
  const encodedGlyphs = Array.from(parsed.encoding.entries())
    .filter(([glyphCode, glyphName]) => glyphCode >= 0 && glyphCode <= 0xff && glyphName !== '.notdef' && parsed.glyphs.has(glyphName))
    .sort((left, right) => left[0] - right[0]);

  if (encodedGlyphs.length === 0) {
    return undefined;
  }

  const glyphs: SyntheticGlyph[] = [
    {
      glyphId: 0,
      glyphName: '.notdef',
      width: clampUInt16(resource.defaultWidth ?? 1000),
      pathCommands: []
    }
  ];
  const glyphIdByName = new Map<string, number>([['.notdef', 0]]);

  for (const [, glyphName] of encodedGlyphs) {
    if (glyphIdByName.has(glyphName)) {
      continue;
    }
    const glyph = parsed.glyphs.get(glyphName);
    if (!glyph) {
      continue;
    }
    glyphIdByName.set(glyphName, glyphs.length);
    glyphs.push({
      glyphId: glyphs.length,
      glyphName,
      width: clampUInt16(resolveGlyphWidth(resource, glyph)),
      pathCommands: glyph.pathCommands
    });
  }

  if (glyphs.length <= 1) {
    return undefined;
  }

  const cmapEntries: CmapEntry[] = [];
  const glyphCodeToText = new Map<number, string>();

  encodedGlyphs.forEach(([glyphCode, glyphName], index) => {
    const glyphId = glyphIdByName.get(glyphName);
    if (glyphId === undefined) {
      return;
    }
    const codePoint = PRIVATE_USE_AREA_START + index;
    cmapEntries.push({ glyphCode, glyphId, codePoint });
    glyphCodeToText.set(glyphCode, String.fromCharCode(codePoint));
  });

  if (cmapEntries.length === 0) {
    return undefined;
  }

  return {
    buffer: buildSyntheticOpenTypeBuffer(resource, parsed, glyphs, cmapEntries),
    glyphCodeToText
  };
}

function buildSyntheticOpenTypeBuffer(
  resource: PDFEmbeddedFontResource,
  parsed: ParsedType1Font,
  glyphs: SyntheticGlyph[],
  cmapEntries: CmapEntry[]
): Uint8Array {
  const familyName = sanitizePostScriptName(resource.baseFontName ?? parsed.fontName ?? 'EmbeddedType1');
  const postScriptName = `${familyName}-${sanitizePostScriptName(resource.fontKey)}`;
  const bbox = resolveFontBBox(resource, parsed, glyphs);
  const ascender = clampInt16(resource.descriptor?.ascent ?? bbox[3]);
  const descender = clampInt16(resource.descriptor?.descent ?? bbox[1]);
  const italicAngle = resource.descriptor?.italicAngle ?? 0;
  const advanceWidths = glyphs.map((glyph) => glyph.width);
  const advanceWidth = Math.max(...advanceWidths, 0);
  const avgWidth = Math.round(
    advanceWidths.reduce((sum, value) => sum + value, 0) / Math.max(advanceWidths.length, 1)
  );
  const minCodePoint = cmapEntries[0]?.codePoint ?? PRIVATE_USE_AREA_START;
  const maxCodePoint = cmapEntries[cmapEntries.length - 1]?.codePoint ?? PRIVATE_USE_AREA_START;
  const cffTable = buildSyntheticCffTable(postScriptName, glyphs, bbox);

  const tables = [
    { tag: 'CFF ', data: cffTable },
    { tag: 'OS/2', data: buildOs2Table(avgWidth, ascender, descender, minCodePoint, maxCodePoint) },
    { tag: 'cmap', data: buildCmapTable(cmapEntries) },
    { tag: 'head', data: buildHeadTable(bbox, italicAngle, isBold(resource), isItalic(resource)) },
    { tag: 'hhea', data: buildHheaTable(advanceWidth, ascender, descender, glyphs.length) },
    { tag: 'hmtx', data: buildHmtxTable(advanceWidths) },
    { tag: 'maxp', data: buildMaxpTable(glyphs.length) },
    { tag: 'name', data: buildNameTable(familyName, postScriptName) },
    { tag: 'post', data: buildPostTable(italicAngle) }
  ].sort((left, right) => left.tag.localeCompare(right.tag));

  return buildSfnt(tables);
}

function buildSyntheticCffTable(
  postScriptName: string,
  glyphs: SyntheticGlyph[],
  bbox: [number, number, number, number]
): Uint8Array {
  const standardSidByName = new Map<string, number>();
  CFF_STANDARD_STRINGS.forEach((name, index) => {
    standardSidByName.set(name, index);
  });

  const customStrings: string[] = [];
  const sidByName = new Map<string, number>([['.notdef', 0]]);

  for (const glyph of glyphs) {
    if (sidByName.has(glyph.glyphName)) {
      continue;
    }

    const standardSid = standardSidByName.get(glyph.glyphName);
    if (standardSid !== undefined) {
      sidByName.set(glyph.glyphName, standardSid);
      continue;
    }

    sidByName.set(glyph.glyphName, CFF_STANDARD_STRINGS.length + customStrings.length);
    customStrings.push(glyph.glyphName);
  }

  const header = Uint8Array.from([1, 0, 4, 4]);
  const nameIndex = buildCffIndex([encodeLatin1(postScriptName)]);
  const stringIndex = buildCffIndex(customStrings.map((value) => encodeLatin1(value)));
  const globalSubrIndex = buildCffIndex([]);
  const charset = buildCharsetTable(glyphs, sidByName);
  const encoding = buildEncodingTable(glyphs.length);
  const charStringsIndex = buildCffIndex(glyphs.map((glyph) => buildType2CharString(glyph)));
  const privateDict = buildPrivateDict();

  let topDictIndex = buildCffIndex([new Uint8Array()]);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const fixedSectionLength =
      header.length + nameIndex.length + topDictIndex.length + stringIndex.length + globalSubrIndex.length;
    const charsetOffset = fixedSectionLength;
    const encodingOffset = charsetOffset + charset.length;
    const charStringsOffset = encodingOffset + encoding.length;
    const privateOffset = charStringsOffset + charStringsIndex.length;
    const topDict = buildTopDict({
      bbox,
      charsetOffset,
      encodingOffset,
      charStringsOffset,
      privateSize: privateDict.length,
      privateOffset
    });
    const nextTopDictIndex = buildCffIndex([topDict]);
    if (nextTopDictIndex.length === topDictIndex.length) {
      topDictIndex = nextTopDictIndex;
      break;
    }
    topDictIndex = nextTopDictIndex;
  }

  return concatBytes([header, nameIndex, topDictIndex, stringIndex, globalSubrIndex, charset, encoding, charStringsIndex, privateDict]);
}

function buildTopDict(config: {
  bbox: [number, number, number, number];
  charsetOffset: number;
  encodingOffset: number;
  charStringsOffset: number;
  privateSize: number;
  privateOffset: number;
}): Uint8Array {
  const data: number[] = [];
  for (const value of config.bbox) {
    pushAll(data, encodeCffInteger(value));
  }
  data.push(5);
  pushAll(data, encodeCffInteger(config.charsetOffset));
  data.push(15);
  pushAll(data, encodeCffInteger(config.encodingOffset));
  data.push(16);
  pushAll(data, encodeCffInteger(config.charStringsOffset));
  data.push(17);
  pushAll(data, encodeCffInteger(config.privateSize));
  pushAll(data, encodeCffInteger(config.privateOffset));
  data.push(18);
  return Uint8Array.from(data);
}

function buildPrivateDict(): Uint8Array {
  const data: number[] = [];
  pushAll(data, encodeCffInteger(0));
  data.push(20);
  pushAll(data, encodeCffInteger(0));
  data.push(21);
  return Uint8Array.from(data);
}

function buildEncodingTable(glyphCount: number): Uint8Array {
  const encodedCount = Math.max(0, glyphCount - 1);
  const data = new Uint8Array(2 + encodedCount);
  data[0] = 0;
  data[1] = encodedCount & 0xff;
  for (let index = 0; index < encodedCount; index += 1) {
    data[index + 2] = (index + 1) & 0xff;
  }
  return data;
}

function buildCharsetTable(glyphs: SyntheticGlyph[], sidByName: Map<string, number>): Uint8Array {
  const data = new Uint8Array(1 + Math.max(0, glyphs.length - 1) * 2);
  data[0] = 0;
  let offset = 1;
  for (let index = 1; index < glyphs.length; index += 1) {
    const sid = sidByName.get(glyphs[index].glyphName) ?? 0;
    data[offset] = (sid >> 8) & 0xff;
    data[offset + 1] = sid & 0xff;
    offset += 2;
  }
  return data;
}

function buildType2CharString(glyph: SyntheticGlyph): Uint8Array {
  const commands: number[] = [];
  const contours = buildContours(glyph.pathCommands);

  if (contours.length === 0) {
    if (glyph.width > 0) {
      pushAll(commands, encodeType2Number(glyph.width));
    }
    commands.push(14);
    return Uint8Array.from(commands);
  }

  let currentX = 0;
  let currentY = 0;
  let emittedFirstMove = false;

  for (const contour of contours) {
    const moveDx = contour.startX - currentX;
    const moveDy = contour.startY - currentY;

    if (!emittedFirstMove) {
      pushAll(commands, encodeType2Number(glyph.width));
      pushAll(commands, encodeType2Number(moveDx));
      pushAll(commands, encodeType2Number(moveDy));
      commands.push(21);
      emittedFirstMove = true;
    } else {
      pushAll(commands, encodeType2Number(moveDx));
      pushAll(commands, encodeType2Number(moveDy));
      commands.push(21);
    }

    currentX = contour.startX;
    currentY = contour.startY;

    for (const segment of contour.segments) {
      if (segment.op === 'L') {
        const dx = segment.x - currentX;
        const dy = segment.y - currentY;
        pushAll(commands, encodeType2Number(dx));
        pushAll(commands, encodeType2Number(dy));
        commands.push(5);
        currentX = segment.x;
        currentY = segment.y;
        continue;
      }

      if (segment.op === 'C') {
        pushAll(commands, encodeType2Number(segment.x1 - currentX));
        pushAll(commands, encodeType2Number(segment.y1 - currentY));
        pushAll(commands, encodeType2Number(segment.x2 - segment.x1));
        pushAll(commands, encodeType2Number(segment.y2 - segment.y1));
        pushAll(commands, encodeType2Number(segment.x3 - segment.x2));
        pushAll(commands, encodeType2Number(segment.y3 - segment.y2));
        commands.push(8);
        currentX = segment.x3;
        currentY = segment.y3;
      }
    }

    if (contour.closed && (currentX !== contour.startX || currentY !== contour.startY)) {
      pushAll(commands, encodeType2Number(contour.startX - currentX));
      pushAll(commands, encodeType2Number(contour.startY - currentY));
      commands.push(5);
      currentX = contour.startX;
      currentY = contour.startY;
    }
  }

  commands.push(14);
  return Uint8Array.from(commands);
}

function buildContours(pathCommands: Type3PathCommand[]): Array<{
  startX: number;
  startY: number;
  segments: Array<
    | { op: 'L'; x: number; y: number }
    | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x3: number; y3: number }
  >;
  closed: boolean;
}> {
  const contours: Array<{
    startX: number;
    startY: number;
    segments: Array<
      | { op: 'L'; x: number; y: number }
      | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x3: number; y3: number }
    >;
    closed: boolean;
  }> = [];
  let currentContour:
    | {
        startX: number;
        startY: number;
        segments: Array<
          | { op: 'L'; x: number; y: number }
          | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x3: number; y3: number }
        >;
        closed: boolean;
      }
    | undefined;

  for (const command of pathCommands) {
    if (command.op === 'M') {
      if (currentContour && currentContour.segments.length === 0) {
        currentContour.startX = command.x;
        currentContour.startY = command.y;
        currentContour.closed = false;
        continue;
      }

      currentContour = {
        startX: command.x,
        startY: command.y,
        segments: [],
        closed: false
      };
      contours.push(currentContour);
      continue;
    }

    if (!currentContour) {
      continue;
    }

    if (command.op === 'L') {
      currentContour.segments.push(command);
      continue;
    }

    if (command.op === 'C') {
      currentContour.segments.push(command);
      continue;
    }

    if (command.op === 'Z') {
      currentContour.closed = true;
      continue;
    }
  }

  return contours.filter((contour) => contour.segments.length > 0);
}

function buildCffIndex(objects: Uint8Array[]): Uint8Array {
  if (objects.length === 0) {
    return Uint8Array.from([0, 0]);
  }

  const offsets = [1];
  let totalDataLength = 0;
  for (const object of objects) {
    totalDataLength += object.length;
    offsets.push(totalDataLength + 1);
  }

  const maxOffset = offsets[offsets.length - 1];
  const offSize = maxOffset <= 0xff ? 1 : maxOffset <= 0xffff ? 2 : maxOffset <= 0xffffff ? 3 : 4;
  const header = new Uint8Array(2 + 1 + offsets.length * offSize);
  header[0] = (objects.length >> 8) & 0xff;
  header[1] = objects.length & 0xff;
  header[2] = offSize;

  let cursor = 3;
  for (const offset of offsets) {
    for (let shift = (offSize - 1) * 8; shift >= 0; shift -= 8) {
      header[cursor] = (offset >> shift) & 0xff;
      cursor += 1;
    }
  }

  return concatBytes([header, ...objects]);
}

function buildCmapTable(entries: CmapEntry[]): Uint8Array {
  const segCount = entries.length + 1;
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
  for (const entry of entries) {
    view.setUint16(cursor, entry.codePoint);
    cursor += 2;
  }
  view.setUint16(cursor, 0xffff);
  cursor += 2;
  view.setUint16(cursor, 0);
  cursor += 2;

  for (const entry of entries) {
    view.setUint16(cursor, entry.codePoint);
    cursor += 2;
  }
  view.setUint16(cursor, 0xffff);
  cursor += 2;

  for (const entry of entries) {
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
  view.setUint16(44, (bold ? 1 : 0) | (italic ? 2 : 0));
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
  const table = new Uint8Array(advanceWidths.length * 4);
  const view = new DataView(table.buffer);
  for (let index = 0; index < advanceWidths.length; index += 1) {
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
  const encoded = records.map((record) => ({
    ...record,
    data: encodeUtf16Be(record.value)
  }));

  const table = new Uint8Array(6 + encoded.length * 12 + encoded.reduce((sum, record) => sum + record.data.length, 0));
  const view = new DataView(table.buffer);
  view.setUint16(0, 0);
  view.setUint16(2, encoded.length);
  view.setUint16(4, 6 + encoded.length * 12);

  let recordOffset = 6;
  let stringOffset = 0;
  for (const record of encoded) {
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
  const tableBuffers = tables.map((table) => ({ ...table, data: padTo4(table.data) }));
  const numTables = tableBuffers.length;
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

function resolveGlyphWidth(resource: PDFEmbeddedFontResource, glyph: ParsedType1Glyph): number {
  if (glyph.width > 0) {
    return glyph.width;
  }
  return resource.defaultWidth ?? 1000;
}

function resolveFontBBox(
  resource: PDFEmbeddedFontResource,
  parsed: ParsedType1Font,
  glyphs: SyntheticGlyph[]
): [number, number, number, number] {
  if (parsed.fontBBox) {
    return parsed.fontBBox;
  }

  if (resource.descriptor?.bbox) {
    return resource.descriptor.bbox;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const glyph of glyphs) {
    for (const command of glyph.pathCommands) {
      if ('x' in command) {
        minX = Math.min(minX, command.x);
        maxX = Math.max(maxX, command.x);
      }
      if ('y' in command) {
        minY = Math.min(minY, command.y);
        maxY = Math.max(maxY, command.y);
      }
      if ('x1' in command) {
        minX = Math.min(minX, command.x1);
        maxX = Math.max(maxX, command.x1);
      }
      if ('y1' in command) {
        minY = Math.min(minY, command.y1);
        maxY = Math.max(maxY, command.y1);
      }
      if ('x2' in command) {
        minX = Math.min(minX, command.x2);
        maxX = Math.max(maxX, command.x2);
      }
      if ('y2' in command) {
        minY = Math.min(minY, command.y2);
        maxY = Math.max(maxY, command.y2);
      }
      if ('x3' in command) {
        minX = Math.min(minX, command.x3);
        maxX = Math.max(maxX, command.x3);
      }
      if ('y3' in command) {
        minY = Math.min(minY, command.y3);
        maxY = Math.max(maxY, command.y3);
      }
    }
  }

  if (![minX, minY, maxX, maxY].every((value) => Number.isFinite(value))) {
    return [0, -250, 1000, 900];
  }

  return [minX, minY, maxX, maxY];
}

function encodeLatin1(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0) & 0xff);
}

function encodeUtf16Be(value: string): Uint8Array {
  const buffer = new Uint8Array(value.length * 2);
  const view = new DataView(buffer.buffer);
  for (let index = 0; index < value.length; index += 1) {
    view.setUint16(index * 2, value.charCodeAt(index));
  }
  return buffer;
}

function encodeCffInteger(value: number): number[] {
  const rounded = Math.round(value);
  if (rounded >= -107 && rounded <= 107) {
    return [rounded + 139];
  }
  if (rounded >= 108 && rounded <= 1131) {
    const adjusted = rounded - 108;
    return [247 + (adjusted >> 8), adjusted & 0xff];
  }
  if (rounded >= -1131 && rounded <= -108) {
    const adjusted = -rounded - 108;
    return [251 + (adjusted >> 8), adjusted & 0xff];
  }
  if (rounded >= -32768 && rounded <= 32767) {
    return [28, (rounded >> 8) & 0xff, rounded & 0xff];
  }
  return [29, (rounded >> 24) & 0xff, (rounded >> 16) & 0xff, (rounded >> 8) & 0xff, rounded & 0xff];
}

function encodeType2Number(value: number): number[] {
  const rounded = Math.round(value);
  if (rounded >= -107 && rounded <= 107) {
    return [rounded + 139];
  }
  if (rounded >= 108 && rounded <= 1131) {
    const adjusted = rounded - 108;
    return [247 + (adjusted >> 8), adjusted & 0xff];
  }
  if (rounded >= -1131 && rounded <= -108) {
    const adjusted = -rounded - 108;
    return [251 + (adjusted >> 8), adjusted & 0xff];
  }
  return [28, (rounded >> 8) & 0xff, rounded & 0xff];
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

function pushAll(target: number[], values: number[]): void {
  for (const value of values) {
    target.push(value);
  }
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
  return /bold|cmbx/i.test(resource.baseFontName ?? '');
}
