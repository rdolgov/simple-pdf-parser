import type { PDFEmbeddedFontResource, Type3PathCommand } from '../types.js';
import {
  resolveCffStandardString,
  resolveStandardEncodingGlyphName
} from './cffStandardStrings.js';
import type { ParsedType1Font } from './type1FontProgram.js';

type CffIndex = {
  count: number;
  objects: Uint8Array[];
  nextOffset: number;
};

type CffTopDict = {
  charsetOffset?: number;
  encodingOffset?: number;
  charStringsOffset?: number;
  privateSize?: number;
  privateOffset?: number;
  fontMatrix?: [number, number, number, number, number, number];
  fontBBox?: [number, number, number, number];
};

type CffPrivateDict = {
  localSubrsOffset?: number;
  defaultWidthX?: number;
  nominalWidthX?: number;
};

type InterpreterState = {
  x: number;
  y: number;
  subpathStartX: number;
  subpathStartY: number;
  pathCommands: Type3PathCommand[];
  width: number;
  transient: number[];
};

type InterpreterMetrics = {
  defaultWidthX: number;
  nominalWidthX: number;
  hintCount: number;
  widthResolved: boolean;
};

const DEFAULT_FONT_MATRIX: ParsedType1Font['fontMatrix'] = [0.001, 0, 0, 0.001, 0, 0];
const MAX_SUBR_DEPTH = 24;

export function parseType1CFont(resource: PDFEmbeddedFontResource): ParsedType1Font | undefined {
  if (!(resource.data.length > 0) || resource.data.length < 4) {
    return undefined;
  }

  const data = resource.data;
  const headerSize = data[2] ?? 4;
  let offset = headerSize;
  const nameIndex = readIndex(data, offset);
  offset = nameIndex.nextOffset;
  const topDictIndex = readIndex(data, offset);
  offset = topDictIndex.nextOffset;
  const stringIndex = readIndex(data, offset);
  offset = stringIndex.nextOffset;
  const globalSubrs = readIndex(data, offset);

  if (topDictIndex.objects.length === 0) {
    return undefined;
  }

  const customStrings = stringIndex.objects.map(decodeLatin1);
  const topDict = parseTopDict(topDictIndex.objects[0]);
  if (!topDict.charStringsOffset) {
    return undefined;
  }

  const charStrings = readIndex(data, topDict.charStringsOffset);
  if (charStrings.count === 0) {
    return undefined;
  }

  const glyphNames =
    topDict.charsetOffset !== undefined
      ? parseCharset(data, topDict.charsetOffset, charStrings.count, customStrings)
      : createFallbackGlyphNames(charStrings.count);
  const encoding = parseEncoding(resource, data, topDict.encodingOffset, glyphNames);
  const privateDict =
    topDict.privateOffset !== undefined && topDict.privateSize !== undefined
      ? parsePrivateDict(data.subarray(topDict.privateOffset, topDict.privateOffset + topDict.privateSize))
      : {};
  const localSubrs =
    topDict.privateOffset !== undefined && privateDict.localSubrsOffset !== undefined
      ? readIndex(data, topDict.privateOffset + privateDict.localSubrsOffset)
      : { count: 0, objects: [], nextOffset: 0 };

  const glyphs = new Map<string, { glyphName: string; width: number; pathCommands: Type3PathCommand[] }>();
  for (let glyphId = 0; glyphId < charStrings.objects.length; glyphId += 1) {
    const glyphName = glyphNames[glyphId] ?? `.gid${glyphId}`;
    const parsedGlyph = parseType2Glyph(
      glyphName,
      charStrings.objects[glyphId],
      localSubrs.objects,
      globalSubrs.objects,
      privateDict.defaultWidthX ?? 0,
      privateDict.nominalWidthX ?? 0
    );
    if (parsedGlyph) {
      glyphs.set(glyphName, parsedGlyph);
    }
  }

  if (glyphs.size === 0) {
    return undefined;
  }

  return {
    fontName: nameIndex.objects[0] ? decodeLatin1(nameIndex.objects[0]) : resource.baseFontName,
    fontMatrix: topDict.fontMatrix ?? DEFAULT_FONT_MATRIX,
    fontBBox: topDict.fontBBox ?? resource.descriptor?.bbox,
    encoding,
    glyphs
  };
}

function parseType2Glyph(
  glyphName: string,
  program: Uint8Array,
  localSubrs: Uint8Array[],
  globalSubrs: Uint8Array[],
  defaultWidthX: number,
  nominalWidthX: number
): { glyphName: string; width: number; pathCommands: Type3PathCommand[] } | undefined {
  const state: InterpreterState = {
    x: 0,
    y: 0,
    subpathStartX: 0,
    subpathStartY: 0,
    pathCommands: [],
    width: defaultWidthX,
    transient: []
  };
  const metrics: InterpreterMetrics = {
    defaultWidthX,
    nominalWidthX,
    hintCount: 0,
    widthResolved: false
  };

  const ok = executeType2CharString(program, localSubrs, globalSubrs, state, metrics, 0, []);
  if (!ok) {
    return undefined;
  }

  if (!metrics.widthResolved) {
    state.width = defaultWidthX;
  }

  return {
    glyphName,
    width: state.width,
    pathCommands: state.pathCommands
  };
}

function executeType2CharString(
  program: Uint8Array,
  localSubrs: Uint8Array[],
  globalSubrs: Uint8Array[],
  state: InterpreterState,
  metrics: InterpreterMetrics,
  depth: number,
  stack: number[]
): boolean {
  if (depth > MAX_SUBR_DEPTH) {
    return false;
  }

  for (let cursor = 0; cursor < program.length; ) {
    const byte = program[cursor] ?? 0;
    cursor += 1;

    if (byte === 28) {
      if (cursor + 1 >= program.length) {
        return false;
      }
      stack.push(readInt16(program, cursor));
      cursor += 2;
      continue;
    }

    if (byte === 255) {
      if (cursor + 3 >= program.length) {
        return false;
      }
      const fixed =
        (((program[cursor] ?? 0) << 24) |
          ((program[cursor + 1] ?? 0) << 16) |
          ((program[cursor + 2] ?? 0) << 8) |
          (program[cursor + 3] ?? 0)) >>
        0;
      stack.push(fixed / 65536);
      cursor += 4;
      continue;
    }

    if (byte >= 32) {
      const decoded = decodeCharStringNumber(program, cursor - 1);
      if (!decoded) {
        return false;
      }
      stack.push(decoded.value);
      cursor = decoded.nextOffset;
      continue;
    }

    if (byte === 12) {
      const escaped = program[cursor] ?? 0;
      cursor += 1;
      if (!executeEscapedType2Operator(escaped, state, stack)) {
        return false;
      }
      continue;
    }

    switch (byte) {
      case 1:
      case 3:
      case 18:
      case 23:
        resolveWidthForHintOperator(state, metrics, stack);
        metrics.hintCount += Math.floor(stack.length / 2);
        stack.length = 0;
        break;
      case 4: {
        resolveWidthForMoveOperator(state, metrics, stack, 1);
        const dy = shiftNumber(stack);
        moveCurrentPoint(state, state.x, state.y + dy);
        stack.length = 0;
        break;
      }
      case 5:
        while (stack.length >= 2) {
          const dx = shiftNumber(stack);
          const dy = shiftNumber(stack);
          lineTo(state, state.x + dx, state.y + dy);
        }
        stack.length = 0;
        break;
      case 6: {
        let horizontal = true;
        while (stack.length > 0) {
          const delta = shiftNumber(stack);
          if (horizontal) {
            lineTo(state, state.x + delta, state.y);
          } else {
            lineTo(state, state.x, state.y + delta);
          }
          horizontal = !horizontal;
        }
        break;
      }
      case 7: {
        let vertical = true;
        while (stack.length > 0) {
          const delta = shiftNumber(stack);
          if (vertical) {
            lineTo(state, state.x, state.y + delta);
          } else {
            lineTo(state, state.x + delta, state.y);
          }
          vertical = !vertical;
        }
        break;
      }
      case 8:
        while (stack.length >= 6) {
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
      case 10: {
        const encodedIndex = Math.trunc(popNumber(stack));
        const subr = resolveSubroutine(localSubrs, encodedIndex);
        if (subr && !executeType2CharString(subr, localSubrs, globalSubrs, state, metrics, depth + 1, stack)) {
          return false;
        }
        break;
      }
      case 11:
        return true;
      case 14:
        resolveWidthForEndChar(state, metrics, stack);
        stack.length = 0;
        return true;
      case 19:
      case 20:
        resolveWidthForHintOperator(state, metrics, stack);
        metrics.hintCount += Math.floor(stack.length / 2);
        stack.length = 0;
        cursor += Math.ceil(metrics.hintCount / 8);
        break;
      case 21: {
        resolveWidthForMoveOperator(state, metrics, stack, 2);
        const dx = shiftNumber(stack);
        const dy = shiftNumber(stack);
        moveCurrentPoint(state, state.x + dx, state.y + dy);
        stack.length = 0;
        break;
      }
      case 22: {
        resolveWidthForMoveOperator(state, metrics, stack, 1);
        const dx = shiftNumber(stack);
        moveCurrentPoint(state, state.x + dx, state.y);
        stack.length = 0;
        break;
      }
      case 24: {
        while (stack.length > 2) {
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
        if (stack.length >= 2) {
          const dx = shiftNumber(stack);
          const dy = shiftNumber(stack);
          lineTo(state, state.x + dx, state.y + dy);
        }
        stack.length = 0;
        break;
      }
      case 25: {
        while (stack.length > 6) {
          const dx = shiftNumber(stack);
          const dy = shiftNumber(stack);
          lineTo(state, state.x + dx, state.y + dy);
        }
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
      }
      case 26: {
        let dx1 = 0;
        if (stack.length % 4 === 1) {
          dx1 = shiftNumber(stack);
        }
        while (stack.length >= 4) {
          const dy1 = shiftNumber(stack);
          const dx2 = shiftNumber(stack);
          const dy2 = shiftNumber(stack);
          const dy3 = shiftNumber(stack);
          curveTo(
            state,
            state.x + dx1,
            state.y + dy1,
            state.x + dx1 + dx2,
            state.y + dy1 + dy2,
            state.x + dx1 + dx2,
            state.y + dy1 + dy2 + dy3
          );
          dx1 = 0;
        }
        stack.length = 0;
        break;
      }
      case 27: {
        let dy1 = 0;
        if (stack.length % 4 === 1) {
          dy1 = shiftNumber(stack);
        }
        while (stack.length >= 4) {
          const dx1 = shiftNumber(stack);
          const dx2 = shiftNumber(stack);
          const dy2 = shiftNumber(stack);
          const dx3 = shiftNumber(stack);
          curveTo(
            state,
            state.x + dx1,
            state.y + dy1,
            state.x + dx1 + dx2,
            state.y + dy1 + dy2,
            state.x + dx1 + dx2 + dx3,
            state.y + dy1 + dy2
          );
          dy1 = 0;
        }
        stack.length = 0;
        break;
      }
      case 29: {
        const encodedIndex = Math.trunc(popNumber(stack));
        const subr = resolveSubroutine(globalSubrs, encodedIndex);
        if (subr && !executeType2CharString(subr, localSubrs, globalSubrs, state, metrics, depth + 1, stack)) {
          return false;
        }
        break;
      }
      case 30:
        executeVhHvCurves(state, stack, true);
        break;
      case 31:
        executeVhHvCurves(state, stack, false);
        break;
      default:
        stack.length = 0;
        break;
    }
  }

  return true;
}

function executeEscapedType2Operator(operator: number, state: InterpreterState, stack: number[]): boolean {
  switch (operator) {
    case 3: {
      const right = popNumber(stack);
      const left = popNumber(stack);
      stack.push(left !== 0 && right !== 0 ? 1 : 0);
      return true;
    }
    case 4: {
      const right = popNumber(stack);
      const left = popNumber(stack);
      stack.push(left !== 0 || right !== 0 ? 1 : 0);
      return true;
    }
    case 5: {
      const value = popNumber(stack);
      stack.push(value === 0 ? 1 : 0);
      return true;
    }
    case 9: {
      const value = popNumber(stack);
      stack.push(Math.abs(value));
      return true;
    }
    case 10: {
      const right = popNumber(stack);
      const left = popNumber(stack);
      stack.push(left + right);
      return true;
    }
    case 11: {
      const right = popNumber(stack);
      const left = popNumber(stack);
      stack.push(left - right);
      return true;
    }
    case 12: {
      const divisor = popNumber(stack);
      const dividend = popNumber(stack);
      stack.push(divisor === 0 ? 0 : dividend / divisor);
      return true;
    }
    case 14: {
      const value = popNumber(stack);
      stack.push(-value);
      return true;
    }
    case 15: {
      const right = popNumber(stack);
      const left = popNumber(stack);
      stack.push(left === right ? 1 : 0);
      return true;
    }
    case 18:
      popNumber(stack);
      return true;
    case 20: {
      const index = Math.trunc(popNumber(stack));
      const value = popNumber(stack);
      if (index >= 0) {
        state.transient[index] = value;
      }
      return true;
    }
    case 21: {
      const index = Math.trunc(popNumber(stack));
      stack.push(index >= 0 ? state.transient[index] ?? 0 : 0);
      return true;
    }
    case 22: {
      const v2 = popNumber(stack);
      const v1 = popNumber(stack);
      const s2 = popNumber(stack);
      const s1 = popNumber(stack);
      stack.push(v1 <= v2 ? s1 : s2);
      return true;
    }
    case 23:
      stack.push(0.5);
      return true;
    case 24: {
      const right = popNumber(stack);
      const left = popNumber(stack);
      stack.push(left * right);
      return true;
    }
    case 26: {
      const value = popNumber(stack);
      stack.push(value < 0 ? 0 : Math.sqrt(value));
      return true;
    }
    case 27: {
      stack.push(stack[stack.length - 1] ?? 0);
      return true;
    }
    case 28: {
      const first = popNumber(stack);
      const second = popNumber(stack);
      stack.push(first);
      stack.push(second);
      return true;
    }
    case 29: {
      const index = Math.trunc(popNumber(stack));
      const normalized = index < 0 ? stack.length + index : stack.length - 1 - index;
      stack.push(normalized >= 0 && normalized < stack.length ? stack[normalized] ?? 0 : 0);
      return true;
    }
    case 30: {
      const shift = Math.trunc(popNumber(stack));
      const count = Math.max(0, Math.trunc(popNumber(stack)));
      if (count <= 0 || count > stack.length) {
        return true;
      }
      const segment = stack.splice(stack.length - count, count);
      const normalized = ((shift % count) + count) % count;
      if (normalized > 0) {
        segment.unshift(...segment.splice(count - normalized, normalized));
      }
      stack.push(...segment);
      return true;
    }
    case 34:
      executeHflex(state, stack);
      return true;
    case 35:
      executeFlex(state, stack);
      return true;
    case 36:
      executeHflex1(state, stack);
      return true;
    case 37:
      executeFlex1(state, stack);
      return true;
    default:
      stack.length = 0;
      return true;
  }
}

function executeHflex(state: InterpreterState, stack: number[]): void {
  if (stack.length < 7) {
    stack.length = 0;
    return;
  }

  const startX = state.x;
  const startY = state.y;
  const dx1 = shiftNumber(stack);
  const dx2 = shiftNumber(stack);
  const dy2 = shiftNumber(stack);
  const dx3 = shiftNumber(stack);
  const dx4 = shiftNumber(stack);
  const dx5 = shiftNumber(stack);
  const dx6 = shiftNumber(stack);

  curveTo(
    state,
    startX + dx1,
    startY,
    startX + dx1 + dx2,
    startY + dy2,
    startX + dx1 + dx2 + dx3,
    startY + dy2
  );
  curveTo(
    state,
    state.x + dx4,
    state.y,
    state.x + dx4 + dx5,
    startY,
    state.x + dx4 + dx5 + dx6,
    startY
  );
  stack.length = 0;
}

function executeFlex(state: InterpreterState, stack: number[]): void {
  if (stack.length < 13) {
    stack.length = 0;
    return;
  }

  const startX = state.x;
  const startY = state.y;
  const dx1 = shiftNumber(stack);
  const dy1 = shiftNumber(stack);
  const dx2 = shiftNumber(stack);
  const dy2 = shiftNumber(stack);
  const dx3 = shiftNumber(stack);
  const dy3 = shiftNumber(stack);
  const dx4 = shiftNumber(stack);
  const dy4 = shiftNumber(stack);
  const dx5 = shiftNumber(stack);
  const dy5 = shiftNumber(stack);
  const dx6 = shiftNumber(stack);
  const dy6 = shiftNumber(stack);
  shiftNumber(stack);

  curveTo(
    state,
    startX + dx1,
    startY + dy1,
    startX + dx1 + dx2,
    startY + dy1 + dy2,
    startX + dx1 + dx2 + dx3,
    startY + dy1 + dy2 + dy3
  );
  curveTo(
    state,
    state.x + dx4,
    state.y + dy4,
    state.x + dx4 + dx5,
    state.y + dy4 + dy5,
    state.x + dx4 + dx5 + dx6,
    state.y + dy4 + dy5 + dy6
  );
  stack.length = 0;
}

function executeHflex1(state: InterpreterState, stack: number[]): void {
  if (stack.length < 9) {
    stack.length = 0;
    return;
  }

  const startX = state.x;
  const startY = state.y;
  const dx1 = shiftNumber(stack);
  const dy1 = shiftNumber(stack);
  const dx2 = shiftNumber(stack);
  const dy2 = shiftNumber(stack);
  const dx3 = shiftNumber(stack);
  const dx4 = shiftNumber(stack);
  const dx5 = shiftNumber(stack);
  const dy5 = shiftNumber(stack);
  const dx6 = shiftNumber(stack);

  curveTo(
    state,
    startX + dx1,
    startY + dy1,
    startX + dx1 + dx2,
    startY + dy1 + dy2,
    startX + dx1 + dx2 + dx3,
    startY + dy1 + dy2
  );
  curveTo(
    state,
    state.x + dx4,
    state.y,
    state.x + dx4 + dx5,
    state.y + dy5,
    state.x + dx4 + dx5 + dx6,
    startY
  );
  stack.length = 0;
}

function executeFlex1(state: InterpreterState, stack: number[]): void {
  if (stack.length < 11) {
    stack.length = 0;
    return;
  }

  const startX = state.x;
  const startY = state.y;
  const dx1 = shiftNumber(stack);
  const dy1 = shiftNumber(stack);
  const dx2 = shiftNumber(stack);
  const dy2 = shiftNumber(stack);
  const dx3 = shiftNumber(stack);
  const dy3 = shiftNumber(stack);
  const dx4 = shiftNumber(stack);
  const dy4 = shiftNumber(stack);
  const dx5 = shiftNumber(stack);
  const dy5 = shiftNumber(stack);
  const d6 = shiftNumber(stack);

  curveTo(
    state,
    startX + dx1,
    startY + dy1,
    startX + dx1 + dx2,
    startY + dy1 + dy2,
    startX + dx1 + dx2 + dx3,
    startY + dy1 + dy2 + dy3
  );

  const dx = dx1 + dx2 + dx3 + dx4 + dx5;
  const dy = dy1 + dy2 + dy3 + dy4 + dy5;
  const endX = Math.abs(dx) > Math.abs(dy) ? state.x + dx4 + dx5 + d6 : state.x + dx4 + dx5;
  const endY = Math.abs(dx) > Math.abs(dy) ? state.y + dy4 + dy5 : state.y + dy4 + dy5 + d6;
  curveTo(
    state,
    state.x + dx4,
    state.y + dy4,
    state.x + dx4 + dx5,
    state.y + dy4 + dy5,
    endX,
    endY
  );
  stack.length = 0;
}

function executeVhHvCurves(state: InterpreterState, stack: number[], startsVertical: boolean): void {
  let vertical = startsVertical;
  while (stack.length >= 4) {
    if (vertical) {
      const dy1 = shiftNumber(stack);
      const dx2 = shiftNumber(stack);
      const dy2 = shiftNumber(stack);
      const dx3 = shiftNumber(stack);
      const dy3 = stack.length === 1 ? shiftNumber(stack) : 0;
      curveTo(
        state,
        state.x,
        state.y + dy1,
        state.x + dx2,
        state.y + dy1 + dy2,
        state.x + dx2 + dx3,
        state.y + dy1 + dy2 + dy3
      );
    } else {
      const dx1 = shiftNumber(stack);
      const dx2 = shiftNumber(stack);
      const dy2 = shiftNumber(stack);
      const dy3 = shiftNumber(stack);
      const dx3 = stack.length === 1 ? shiftNumber(stack) : 0;
      curveTo(
        state,
        state.x + dx1,
        state.y,
        state.x + dx1 + dx2,
        state.y + dy2,
        state.x + dx1 + dx2 + dx3,
        state.y + dy2 + dy3
      );
    }
    vertical = !vertical;
  }
  stack.length = 0;
}

function resolveWidthForHintOperator(state: InterpreterState, metrics: InterpreterMetrics, stack: number[]): void {
  if (metrics.widthResolved) {
    return;
  }

  const hasExplicitWidth = stack.length % 2 === 1;
  state.width = hasExplicitWidth ? metrics.nominalWidthX + shiftNumber(stack) : metrics.defaultWidthX;
  metrics.widthResolved = true;
}

function resolveWidthForMoveOperator(
  state: InterpreterState,
  metrics: InterpreterMetrics,
  stack: number[],
  operandCount: number
): void {
  if (metrics.widthResolved) {
    return;
  }

  const hasExplicitWidth = stack.length > operandCount;
  state.width = hasExplicitWidth ? metrics.nominalWidthX + shiftNumber(stack) : metrics.defaultWidthX;
  metrics.widthResolved = true;
}

function resolveWidthForEndChar(state: InterpreterState, metrics: InterpreterMetrics, stack: number[]): void {
  if (metrics.widthResolved) {
    return;
  }

  const hasExplicitWidth = stack.length === 1 || stack.length === 5;
  state.width = hasExplicitWidth ? metrics.nominalWidthX + shiftNumber(stack) : metrics.defaultWidthX;
  metrics.widthResolved = true;
}

function moveCurrentPoint(state: InterpreterState, x: number, y: number): void {
  closeOpenSubpath(state);
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

function closeOpenSubpath(state: InterpreterState): void {
  const last = state.pathCommands[state.pathCommands.length - 1];
  if (!last || last.op === 'M' || last.op === 'Z') {
    return;
  }
  state.pathCommands.push({ op: 'Z' });
}

function resolveSubroutine(subrs: Uint8Array[], encodedIndex: number): Uint8Array | undefined {
  if (subrs.length === 0) {
    return undefined;
  }
  return subrs[encodedIndex + resolveSubroutineBias(subrs.length)];
}

function resolveSubroutineBias(subrCount: number): number {
  if (subrCount < 1240) {
    return 107;
  }
  if (subrCount < 33900) {
    return 1131;
  }
  return 32768;
}

function parseTopDict(data: Uint8Array): CffTopDict {
  const result: CffTopDict = {};
  const operands: number[] = [];

  for (let offset = 0; offset < data.length; ) {
    const byte = data[offset] ?? 0;
    if (byte <= 21) {
      const operator = byte === 12 ? 1200 + (data[offset + 1] ?? 0) : byte;
      if (operator === 5 && operands.length >= 4) {
        result.fontBBox = [operands[0], operands[1], operands[2], operands[3]];
      } else if (operator === 15) {
        result.charsetOffset = operands[operands.length - 1];
      } else if (operator === 16) {
        result.encodingOffset = operands[operands.length - 1];
      } else if (operator === 17) {
        result.charStringsOffset = operands[operands.length - 1];
      } else if (operator === 18 && operands.length >= 2) {
        result.privateSize = operands[0];
        result.privateOffset = operands[1];
      } else if (operator === 1207 && operands.length >= 6) {
        result.fontMatrix = [
          operands[0],
          operands[1],
          operands[2],
          operands[3],
          operands[4],
          operands[5]
        ];
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

function parsePrivateDict(data: Uint8Array): CffPrivateDict {
  const result: CffPrivateDict = {};
  const operands: number[] = [];

  for (let offset = 0; offset < data.length; ) {
    const byte = data[offset] ?? 0;
    if (byte <= 21) {
      const operator = byte === 12 ? 1200 + (data[offset + 1] ?? 0) : byte;
      if (operator === 19) {
        result.localSubrsOffset = operands[operands.length - 1];
      } else if (operator === 20) {
        result.defaultWidthX = operands[operands.length - 1];
      } else if (operator === 21) {
        result.nominalWidthX = operands[operands.length - 1];
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
): string[] {
  if (glyphCount <= 0) {
    return [];
  }

  if (offset <= 2 || offset >= data.length) {
    return createFallbackGlyphNames(glyphCount);
  }

  const glyphNames = createFallbackGlyphNames(glyphCount);
  const format = data[offset] ?? 0;
  let cursor = offset + 1;
  let glyphId = 1;

  if (format === 0) {
    while (glyphId < glyphCount && cursor + 1 < data.length) {
      const sid = readUInt16(data, cursor);
      glyphNames[glyphId] = resolveCffStandardString(sid, customStrings) ?? `.sid${sid}`;
      glyphId += 1;
      cursor += 2;
    }
    return glyphNames;
  }

  if (format === 1 || format === 2) {
    while (glyphId < glyphCount && cursor + 2 < data.length) {
      const sid = readUInt16(data, cursor);
      cursor += 2;
      const left = format === 1 ? data[cursor] ?? 0 : readUInt16(data, cursor);
      cursor += format === 1 ? 1 : 2;
      for (let index = 0; index <= left && glyphId < glyphCount; index += 1) {
        glyphNames[glyphId] = resolveCffStandardString(sid + index, customStrings) ?? `.sid${sid + index}`;
        glyphId += 1;
      }
    }
  }

  return glyphNames;
}

function createFallbackGlyphNames(glyphCount: number): string[] {
  return Array.from({ length: glyphCount }, (_, glyphId) => (glyphId === 0 ? '.notdef' : `.gid${glyphId}`));
}

function parseEncoding(
  resource: PDFEmbeddedFontResource,
  data: Uint8Array,
  encodingOffset: number | undefined,
  glyphNames: string[]
): Map<number, string> {
  const encoding = new Map<number, string>();

  if (resource.baseEncoding === 'StandardEncoding') {
    for (let code = 0; code < 256; code += 1) {
      const glyphName = resolveStandardEncodingGlyphName(code);
      if (glyphName) {
        encoding.set(code, glyphName);
      }
    }
  }

  const codeToGlyphId = parseCodeToGlyphId(data, encodingOffset, glyphNames);
  for (const [code, glyphId] of codeToGlyphId.entries()) {
    const glyphName = glyphNames[glyphId];
    if (glyphName) {
      encoding.set(code, glyphName);
    }
  }

  if (resource.glyphNames) {
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

function parseCodeToGlyphId(
  data: Uint8Array,
  encodingOffset: number | undefined,
  glyphNames: string[]
): Map<number, number> {
  if (encodingOffset === undefined) {
    return new Map();
  }

  if (encodingOffset === 0) {
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

  const formatByte = data[encodingOffset] ?? 0;
  const format = formatByte & 0x7f;
  const hasSupplement = (formatByte & 0x80) !== 0;
  let cursor = encodingOffset + 1;
  const map = new Map<number, number>();

  if (format === 0) {
    const codeCount = data[cursor] ?? 0;
    cursor += 1;
    for (let index = 0; index < codeCount && index + 1 < glyphNames.length; index += 1) {
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
    for (let rangeIndex = 0; rangeIndex < rangeCount && glyphId < glyphNames.length; rangeIndex += 1) {
      const firstCode = data[cursor] ?? 0;
      const leftCount = data[cursor + 1] ?? 0;
      cursor += 2;
      for (let rangeOffset = 0; rangeOffset <= leftCount && glyphId < glyphNames.length; rangeOffset += 1) {
        map.set((firstCode + rangeOffset) & 0xff, glyphId);
        glyphId += 1;
      }
    }
  }

  if (hasSupplement) {
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
      const glyphName = resolveCffStandardString(sid, []);
      const glyphId = glyphName ? nameToGlyphId.get(glyphName) : undefined;
      if (glyphId !== undefined) {
        map.set(code, glyphId);
      }
    }
  }

  return map;
}

function readIndex(data: Uint8Array, offset: number): CffIndex {
  if (offset + 1 >= data.length) {
    return { count: 0, objects: [], nextOffset: offset };
  }

  const count = readUInt16(data, offset);
  offset += 2;
  if (count === 0) {
    return { count, objects: [], nextOffset: offset };
  }

  const offSize = data[offset] ?? 0;
  offset += 1;
  const offsets: number[] = [];
  for (let index = 0; index < count + 1; index += 1) {
    offsets.push(readOffset(data, offset, offSize));
    offset += offSize;
  }

  const dataStart = offset;
  const objects: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = dataStart + offsets[index] - 1;
    const end = dataStart + offsets[index + 1] - 1;
    objects.push(data.subarray(start, end));
  }

  return {
    count,
    objects,
    nextOffset: dataStart + offsets[count] - 1
  };
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
  return (readUInt16(data, offset) << 16) >> 16;
}

function readDictNumber(data: Uint8Array, start: number): { value: number; nextOffset: number } {
  const byte = data[start] ?? 0;
  if (byte >= 32 && byte <= 246) {
    return { value: byte - 139, nextOffset: start + 1 };
  }
  if (byte >= 247 && byte <= 250) {
    return {
      value: (byte - 247) * 256 + (data[start + 1] ?? 0) + 108,
      nextOffset: start + 2
    };
  }
  if (byte >= 251 && byte <= 254) {
    return {
      value: -(byte - 251) * 256 - (data[start + 1] ?? 0) - 108,
      nextOffset: start + 2
    };
  }
  if (byte === 28) {
    return { value: readInt16(data, start + 1), nextOffset: start + 3 };
  }
  if (byte === 29) {
    const value =
      (((data[start + 1] ?? 0) << 24) |
        ((data[start + 2] ?? 0) << 16) |
        ((data[start + 3] ?? 0) << 8) |
        (data[start + 4] ?? 0)) >>
      0;
    return { value, nextOffset: start + 5 };
  }
  if (byte === 30) {
    let cursor = start + 1;
    let text = '';
    while (cursor < data.length) {
      const current = data[cursor] ?? 0;
      cursor += 1;
      for (const nibble of [current >> 4, current & 0x0f]) {
        if (nibble === 0x0f) {
          return { value: Number(text), nextOffset: cursor };
        }
        text += decodeNibble(nibble);
      }
    }
  }
  return { value: 0, nextOffset: start + 1 };
}

function decodeCharStringNumber(data: Uint8Array, start: number): { value: number; nextOffset: number } | undefined {
  const byte = data[start] ?? 0;
  if (byte >= 32 && byte <= 246) {
    return { value: byte - 139, nextOffset: start + 1 };
  }
  if (byte >= 247 && byte <= 250) {
    return {
      value: (byte - 247) * 256 + (data[start + 1] ?? 0) + 108,
      nextOffset: start + 2
    };
  }
  if (byte >= 251 && byte <= 254) {
    return {
      value: -(byte - 251) * 256 - (data[start + 1] ?? 0) - 108,
      nextOffset: start + 2
    };
  }
  return undefined;
}

function decodeNibble(nibble: number): string {
  if (nibble <= 9) {
    return String(nibble);
  }
  if (nibble === 0x0a) {
    return '.';
  }
  if (nibble === 0x0b) {
    return 'E';
  }
  if (nibble === 0x0c) {
    return 'E-';
  }
  if (nibble === 0x0e) {
    return '-';
  }
  return '';
}

function decodeLatin1(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

function shiftNumber(stack: number[]): number {
  return stack.length > 0 ? stack.shift() ?? 0 : 0;
}

function popNumber(stack: number[]): number {
  return stack.length > 0 ? stack.pop() ?? 0 : 0;
}
