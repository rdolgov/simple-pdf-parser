import type { PDFEmbeddedFontResource, Type3PathCommand } from '../types.js';
import { resolveStandardEncodingGlyphName } from './cffStandardStrings.js';

export interface ParsedType1Glyph {
  glyphName: string;
  width: number;
  pathCommands: Type3PathCommand[];
}

export interface ParsedType1Font {
  fontName?: string;
  fontMatrix: [number, number, number, number, number, number];
  fontBBox?: [number, number, number, number];
  encoding: Map<number, string>;
  glyphs: Map<string, ParsedType1Glyph>;
}

const EEXEC_KEY = 55665;
const CHARSTRING_KEY = 4330;
const TYPE1_C1 = 52845;
const TYPE1_C2 = 22719;
const DEFAULT_FONT_MATRIX: ParsedType1Font['fontMatrix'] = [0.001, 0, 0, 0.001, 0, 0];
const DEFAULT_LEN_IV = 4;
const MAX_SUBR_DEPTH = 24;

type InterpreterState = {
  x: number;
  y: number;
  subpathStartX: number;
  subpathStartY: number;
  width: number;
  pathCommands: Type3PathCommand[];
  otherSubrResults: number[];
  flexSequence?: {
    startX: number;
    startY: number;
    points: Array<{ x: number; y: number }>;
  };
};

export function parseType1Font(resource: PDFEmbeddedFontResource): ParsedType1Font | undefined {
  if (!(resource.data.length > 0)) {
    return undefined;
  }

  const source = resource.data;
  const sourceText = latin1Decode(source);
  const cleartextEnd = sourceText.indexOf('eexec');
  const cleartextSource = cleartextEnd === -1 ? sourceText : sourceText.slice(0, cleartextEnd);
  const fontMatrix = parseFontMatrix(cleartextSource) ?? DEFAULT_FONT_MATRIX;
  const fontBBox = parseFontBBox(cleartextSource);
  const encoding = parseType1Encoding(cleartextSource, resource);

  if (cleartextEnd === -1) {
    return undefined;
  }

  const decryptedBytes = decryptEexecSection(source, cleartextEnd);
  if (!decryptedBytes || decryptedBytes.length === 0) {
    return undefined;
  }

  const decryptedText = latin1Decode(decryptedBytes);
  const lenIV = parseLenIV(decryptedText);
  const subrs = parseBinaryType1Section(decryptedBytes, decryptedText, '/Subrs', true, lenIV);
  const glyphPrograms = parseBinaryType1Section(decryptedBytes, decryptedText, '/CharStrings', false, lenIV);
  if (glyphPrograms.size === 0) {
    return undefined;
  }

  const glyphs = new Map<string, ParsedType1Glyph>();
  for (const [glyphName, program] of glyphPrograms.entries()) {
    if (typeof glyphName !== 'string') {
      continue;
    }
    const glyph = parseType1Glyph(glyphName, program, subrs);
    if (glyph) {
      glyphs.set(glyphName, glyph);
    }
  }

  if (glyphs.size === 0) {
    return undefined;
  }

  return {
    fontName: parseFontName(cleartextSource) ?? resource.baseFontName,
    fontMatrix,
    fontBBox,
    encoding,
    glyphs
  };
}

function parseFontMatrix(source: string): ParsedType1Font['fontMatrix'] | undefined {
  const match = source.match(
    /\/FontMatrix\s*\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]/
  );
  if (!match) {
    return undefined;
  }

  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6])
  ];
}

function parseFontBBox(source: string): [number, number, number, number] | undefined {
  const match = source.match(
    /\/FontBBox\s*\{?\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\}?/
  );
  if (!match) {
    return undefined;
  }

  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4])
  ];
}

function parseFontName(source: string): string | undefined {
  const match = source.match(/\/FontName\s+\/([^\s]+)/);
  return match?.[1];
}

function parseType1Encoding(source: string, resource?: PDFEmbeddedFontResource): Map<number, string> {
  const encoding = new Map<number, string>();
  for (let code = 0; code < 256; code += 1) {
    encoding.set(code, '.notdef');
  }

  const sectionIndex = source.indexOf('/Encoding');
  const section = sectionIndex === -1
    ? ''
    : source.slice(sectionIndex, Math.min(source.length, sectionIndex + 6000));

  const programBaseEncoding = parseNamedType1Encoding(section);
  if (programBaseEncoding) {
    applyNamedType1Encoding(encoding, programBaseEncoding);
  }
  if (resource?.baseEncoding) {
    applyNamedType1Encoding(encoding, resource.baseEncoding);
  }

  if (section) {
    const putPattern = /dup\s+(\d+)\s+\/([^\s]+)\s+put/g;
    let match: RegExpExecArray | null;
    while ((match = putPattern.exec(section)) !== null) {
      encoding.set(Number(match[1]) & 0xff, match[2]);
    }
  }

  if (resource?.glyphNames) {
    for (const [code, glyphName] of Object.entries(resource.glyphNames)) {
      const numericCode = Number(code);
      if (!Number.isFinite(numericCode) || !glyphName) {
        continue;
      }
      encoding.set(numericCode & 0xff, glyphName);
    }
  }

  return encoding;
}

function parseNamedType1Encoding(section: string): string | undefined {
  if (!section) {
    return undefined;
  }

  const match = section.match(/\/Encoding\s+\/?([A-Za-z0-9]+)\s+def\b/);
  return match?.[1];
}

function applyNamedType1Encoding(target: Map<number, string>, encodingName: string): void {
  switch (encodingName) {
    case 'StandardEncoding':
      for (let code = 0; code < 256; code += 1) {
        const glyphName = resolveStandardEncodingGlyphName(code);
        if (glyphName) {
          target.set(code, glyphName);
        }
      }
      break;
    default:
      break;
  }
}

function parseLenIV(source: string): number {
  const match = source.match(/\/lenIV\s+(-?\d+)/);
  if (!match) {
    return DEFAULT_LEN_IV;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : DEFAULT_LEN_IV;
}

function decryptEexecSection(source: Uint8Array, cleartextEnd: number): Uint8Array | undefined {
  let start = cleartextEnd + 'eexec'.length;
  while (start < source.length && isAsciiWhitespace(source[start])) {
    start += 1;
  }

  if (start >= source.length) {
    return undefined;
  }

  const encrypted = source.subarray(start);
  const decrypted = decryptType1Bytes(resolveEexecPayload(encrypted), EEXEC_KEY);
  if (decrypted.length <= 4) {
    return undefined;
  }

  return decrypted.subarray(4);
}

function resolveEexecPayload(bytes: Uint8Array): Uint8Array {
  let cursor = 0;
  while (cursor < bytes.length && isAsciiWhitespace(bytes[cursor])) {
    cursor += 1;
  }

  let hexLength = 0;
  while (cursor + hexLength < bytes.length && isHexOrWhitespace(bytes[cursor + hexLength])) {
    hexLength += 1;
    if (hexLength > 1024) {
      break;
    }
  }

  if (hexLength >= 512) {
    const hexBytes: number[] = [];
    let highNibble: number | undefined;
    for (let index = cursor; index < bytes.length; index += 1) {
      const value = hexNibble(bytes[index]);
      if (value === undefined) {
        if (!isAsciiWhitespace(bytes[index])) {
          break;
        }
        continue;
      }
      if (highNibble === undefined) {
        highNibble = value;
      } else {
        hexBytes.push((highNibble << 4) | value);
        highNibble = undefined;
      }
    }
    return Uint8Array.from(hexBytes);
  }

  return bytes.subarray(cursor);
}

function parseBinaryType1Section(
  bytes: Uint8Array,
  source: string,
  sectionName: '/Subrs' | '/CharStrings',
  numericKeys: boolean,
  lenIV: number
): Map<number | string, Uint8Array> {
  const result = new Map<number | string, Uint8Array>();
  const sectionIndex = source.indexOf(sectionName);
  if (sectionIndex === -1) {
    return result;
  }

  const pattern = numericKeys
    ? /dup\s+(\d+)\s+(\d+)\s+(?:RD|-\|)/g
    : /\/([^\s/]+)\s+(\d+)\s+(?:RD|-\|)/g;
  pattern.lastIndex = sectionIndex;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const key = numericKeys ? Number(match[1]) : match[1];
    const length = Number(match[2]);
    if (!Number.isFinite(length) || length <= 0) {
      continue;
    }

    let dataStart = match.index + match[0].length;
    if (dataStart < bytes.length && isAsciiWhitespace(bytes[dataStart])) {
      dataStart += 1;
    }
    if (dataStart + length > bytes.length) {
      break;
    }

    const encryptedProgram = bytes.subarray(dataStart, dataStart + length);
    result.set(key, decryptCharString(encryptedProgram, lenIV));
    pattern.lastIndex = dataStart + length;
  }

  return result;
}

function decryptCharString(bytes: Uint8Array, lenIV: number): Uint8Array {
  const decrypted = decryptType1Bytes(bytes, CHARSTRING_KEY);
  const strip = lenIV >= 0 ? lenIV : 0;
  return strip >= decrypted.length ? new Uint8Array() : decrypted.subarray(strip);
}

function decryptType1Bytes(bytes: Uint8Array, seed: number): Uint8Array {
  const decrypted = new Uint8Array(bytes.length);
  let r = seed;

  for (let index = 0; index < bytes.length; index += 1) {
    const cipher = bytes[index];
    const plain = cipher ^ (r >> 8);
    decrypted[index] = plain;
    r = (((cipher + r) * TYPE1_C1) + TYPE1_C2) & 0xffff;
  }

  return decrypted;
}

function parseType1Glyph(
  glyphName: string,
  program: Uint8Array,
  subrs: Map<number | string, Uint8Array>
): ParsedType1Glyph | undefined {
  const state: InterpreterState = {
    x: 0,
    y: 0,
    subpathStartX: 0,
    subpathStartY: 0,
    width: 0,
    pathCommands: [],
    otherSubrResults: [],
    flexSequence: undefined
  };

  const subrMap = new Map<number, Uint8Array>();
  for (const [key, value] of subrs.entries()) {
    if (typeof key === 'number') {
      subrMap.set(key, value);
    }
  }

  const ok = executeType1CharString(program, subrMap, state, 0, []);
  if (!ok) {
    return undefined;
  }

  return {
    glyphName,
    width: state.width,
    pathCommands: state.pathCommands
  };
}

function executeType1CharString(
  program: Uint8Array,
  subrs: Map<number, Uint8Array>,
  state: InterpreterState,
  depth: number,
  stack: number[]
): boolean {
  if (depth > MAX_SUBR_DEPTH) {
    return false;
  }

  for (let cursor = 0; cursor < program.length; ) {
    const byte = program[cursor] ?? 0;
    cursor += 1;

    if (byte >= 32) {
      const decoded = decodeType1Number(program, cursor - 1);
      if (!decoded) {
        return false;
      }
      stack.push(decoded.value);
      cursor = decoded.next;
      continue;
    }

    if (byte === 12) {
      const escaped = program[cursor] ?? 0;
      cursor += 1;
      if (!executeEscapedType1Operator(escaped, state, stack)) {
        return false;
      }
      continue;
    }

    switch (byte) {
      case 1:
      case 3:
        stack.length = 0;
        break;
      case 4: {
        const dy = shiftNumber(stack);
        moveCurrentPoint(state, state.x, state.y + dy);
        break;
      }
      case 5:
        if (stack.length >= 2) {
          const dx = shiftNumber(stack);
          const dy = shiftNumber(stack);
          lineTo(state, state.x + dx, state.y + dy);
        }
        stack.length = 0;
        break;
      case 6: {
        if (stack.length > 0) {
          const dx = shiftNumber(stack);
          lineTo(state, state.x + dx, state.y);
        }
        stack.length = 0;
        break;
      }
      case 7: {
        if (stack.length > 0) {
          const dy = shiftNumber(stack);
          lineTo(state, state.x, state.y + dy);
        }
        stack.length = 0;
        break;
      }
      case 8:
        if (stack.length >= 6) {
          const dx1 = shiftNumber(stack);
          const dy1 = shiftNumber(stack);
          const dx2 = shiftNumber(stack);
          const dy2 = shiftNumber(stack);
          const dx3 = shiftNumber(stack);
          const dy3 = shiftNumber(stack);
          curveTo(
            state,
            state.x + dx1,
            state.y + dy1,
            state.x + dx1 + dx2,
            state.y + dy1 + dy2,
            state.x + dx1 + dx2 + dx3,
            state.y + dy1 + dy2 + dy3
          );
        }
        stack.length = 0;
        break;
      case 9:
        closePath(state);
        break;
      case 10: {
        const subrIndex = Math.trunc(stack.pop() ?? 0);
        const subr = subrs.get(subrIndex);
        if (subr && !executeType1CharString(subr, subrs, state, depth + 1, stack)) {
          return false;
        }
        break;
      }
      case 11:
        return true;
      case 13: {
        const sidebearing = shiftNumber(stack);
        const width = shiftNumber(stack);
        state.width = width;
        state.x = sidebearing;
        state.y = 0;
        stack.length = 0;
        break;
      }
      case 14:
        stack.length = 0;
        return true;
      case 21: {
        const dx = shiftNumber(stack);
        const dy = shiftNumber(stack);
        moveCurrentPoint(state, state.x + dx, state.y + dy);
        break;
      }
      case 22: {
        const dx = shiftNumber(stack);
        moveCurrentPoint(state, state.x + dx, state.y);
        break;
      }
      case 30:
        executeVhHvCurve(state, stack, true);
        break;
      case 31:
        executeVhHvCurve(state, stack, false);
        break;
      default:
        stack.length = 0;
        break;
    }
  }

  return true;
}

function executeEscapedType1Operator(
  operator: number,
  state: InterpreterState,
  stack: number[]
): boolean {
  switch (operator) {
    case 0:
    case 1:
    case 2:
      stack.length = 0;
      return true;
    case 6:
      stack.length = 0;
      return true;
    case 7: {
      const sbx = shiftNumber(stack);
      const sby = shiftNumber(stack);
      const wx = shiftNumber(stack);
      const wy = shiftNumber(stack);
      state.width = wx;
      state.x = sbx;
      state.y = sby;
      stack.length = 0;
      void wy;
      return true;
    }
    case 12: {
      const numerator = shiftNumber(stack);
      const denominator = shiftNumber(stack);
      stack.push(denominator === 0 ? 0 : numerator / denominator);
      return true;
    }
    case 16: {
      const otherSubr = Math.trunc(stack.pop() ?? 0);
      const argCount = Math.max(0, Math.trunc(stack.pop() ?? 0));
      const args = stack.splice(Math.max(0, stack.length - argCount), argCount);
      state.otherSubrResults = executeOtherSubr(otherSubr, args, state);
      return true;
    }
    case 17:
      stack.push(state.otherSubrResults.shift() ?? 0);
      return true;
    case 33: {
      const x = shiftNumber(stack);
      const y = shiftNumber(stack);
      state.x = x;
      state.y = y;
      return true;
    }
    default:
      stack.length = 0;
      return true;
  }
}

function executeVhHvCurve(state: InterpreterState, stack: number[], startsVertical: boolean): void {
  if (stack.length < 4) {
    stack.length = 0;
    return;
  }

  if (startsVertical) {
    const dy1 = shiftNumber(stack);
    const dx2 = shiftNumber(stack);
    const dy2 = shiftNumber(stack);
    const dx3 = shiftNumber(stack);
    curveTo(
      state,
      state.x,
      state.y + dy1,
      state.x + dx2,
      state.y + dy1 + dy2,
      state.x + dx2 + dx3,
      state.y + dy1 + dy2
    );
  } else {
    const dx1 = shiftNumber(stack);
    const dx2 = shiftNumber(stack);
    const dy2 = shiftNumber(stack);
    const dy3 = shiftNumber(stack);
    curveTo(
      state,
      state.x + dx1,
      state.y,
      state.x + dx1 + dx2,
      state.y + dy2,
      state.x + dx1 + dx2,
      state.y + dy2 + dy3
    );
  }
  stack.length = 0;
}

function moveCurrentPoint(state: InterpreterState, x: number, y: number): void {
  if (state.flexSequence) {
    state.x = x;
    state.y = y;
    return;
  }

  state.x = x;
  state.y = y;
  state.subpathStartX = x;
  state.subpathStartY = y;
  state.pathCommands.push({ op: 'M', x, y });
}

function lineTo(state: InterpreterState, x: number, y: number): void {
  state.pathCommands.push({ op: 'L', x, y });
  state.x = x;
  state.y = y;
}

function curveTo(
  state: InterpreterState,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number
): void {
  state.pathCommands.push({ op: 'C', x1, y1, x2, y2, x3, y3 });
  state.x = x3;
  state.y = y3;
}

function closePath(state: InterpreterState): void {
  const last = state.pathCommands[state.pathCommands.length - 1];
  if (!last || last.op === 'Z') {
    return;
  }
  state.pathCommands.push({ op: 'Z' });
}

function executeOtherSubr(otherSubr: number, args: number[], state: InterpreterState): number[] {
  switch (otherSubr) {
    case 0:
      return executeFlexOtherSubr0(args, state);
    case 1:
      state.flexSequence = {
        startX: state.x,
        startY: state.y,
        points: []
      };
      return [];
    case 2:
      if (state.flexSequence) {
        state.flexSequence.points.push({ x: state.x, y: state.y });
      }
      return [];
    case 3:
      // Hint replacement is irrelevant for outline reconstruction. Route to Subrs[3],
      // the standard no-op fallback, so the remaining charstring executes correctly.
      return [3];
    default:
      return args;
  }
}

function executeFlexOtherSubr0(args: number[], state: InterpreterState): number[] {
  const flex = state.flexSequence;
  state.flexSequence = undefined;

  const finalX = args[1] ?? state.x;
  const finalY = args[2] ?? state.y;

  if (!flex) {
    return [finalX, finalY];
  }

  const points = flex.points;
  if (points.length >= 7) {
    state.x = flex.startX;
    state.y = flex.startY;
    const firstControl = points[1];
    const secondControl = points[2];
    const joinPoint = points[3];
    const thirdControl = points[4];
    const fourthControl = points[5];
    const endPoint = points[6];

    curveTo(state, firstControl.x, firstControl.y, secondControl.x, secondControl.y, joinPoint.x, joinPoint.y);
    curveTo(state, thirdControl.x, thirdControl.y, fourthControl.x, fourthControl.y, endPoint.x, endPoint.y);
  }

  state.x = finalX;
  state.y = finalY;
  return [finalX, finalY];
}

function decodeType1Number(
  program: Uint8Array,
  start: number
): { value: number; next: number } | undefined {
  const byte = program[start] ?? 0;
  if (byte >= 32 && byte <= 246) {
    return { value: byte - 139, next: start + 1 };
  }

  if (byte >= 247 && byte <= 250) {
    const next = program[start + 1];
    if (next === undefined) {
      return undefined;
    }
    return {
      value: (byte - 247) * 256 + next + 108,
      next: start + 2
    };
  }

  if (byte >= 251 && byte <= 254) {
    const next = program[start + 1];
    if (next === undefined) {
      return undefined;
    }
    return {
      value: -(byte - 251) * 256 - next - 108,
      next: start + 2
    };
  }

  if (byte === 255) {
    const b1 = program[start + 1];
    const b2 = program[start + 2];
    const b3 = program[start + 3];
    const b4 = program[start + 4];
    if ([b1, b2, b3, b4].some((value) => value === undefined)) {
      return undefined;
    }
    const integer = ((b1 << 24) | (b2 << 16) | (b3 << 8) | b4) >> 0;
    return {
      value: integer / 65536,
      next: start + 5
    };
  }

  return undefined;
}

function shiftNumber(stack: number[]): number {
  return stack.length > 0 ? stack.shift() ?? 0 : 0;
}

function latin1Decode(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

function isAsciiWhitespace(byte: number | undefined): boolean {
  return byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
}

function isHexOrWhitespace(byte: number | undefined): boolean {
  return hexNibble(byte) !== undefined || isAsciiWhitespace(byte);
}

function hexNibble(byte: number | undefined): number | undefined {
  if (byte === undefined) {
    return undefined;
  }
  if (byte >= 48 && byte <= 57) {
    return byte - 48;
  }
  if (byte >= 65 && byte <= 70) {
    return byte - 55;
  }
  if (byte >= 97 && byte <= 102) {
    return byte - 87;
  }
  return undefined;
}
