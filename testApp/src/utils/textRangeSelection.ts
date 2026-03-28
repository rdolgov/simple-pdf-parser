import type { PDFImageBounds } from 'pdf-layout-parser';
import {
  buildHighlightLineSpanSlices,
  type HighlightLineData
} from './highlightUtils';

type LocalBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type SelectionSegment = {
  start: number;
  end: number;
  bounds: LocalBounds;
};

type LocalSpanSlice = {
  start: number;
  end: number;
  bounds: LocalBounds;
};

type SelectionCharacterBox = {
  index: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type TextSelectionCharacterBox = SelectionCharacterBox;

export type TextSelectionLineLayout = {
  text: string;
  bounds: LocalBounds;
  characters: SelectionCharacterBox[];
};

export interface TextSelectionLayout {
  lines: TextSelectionLineLayout[];
}

export interface TextSelectionCaret {
  lineIndex: number;
  offset: number;
}

export interface TextSelectionFragment {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TextSelectionRange {
  start?: TextSelectionCaret;
  end?: TextSelectionCaret;
  text: string;
  normalizedText: string;
  fragments: TextSelectionFragment[];
}

export function mergeTextSelectionFragments(fragments: TextSelectionFragment[]): TextSelectionFragment[] {
  const validFragments = fragments
    .filter(
      (fragment) =>
        Number.isFinite(fragment.left) &&
        Number.isFinite(fragment.top) &&
        Number.isFinite(fragment.width) &&
        Number.isFinite(fragment.height) &&
        fragment.width > 0 &&
        fragment.height > 0
    )
    .sort((left, right) => {
      const topDelta = left.top - right.top;
      if (Math.abs(topDelta) > Math.max(Math.min(left.height, right.height) * 0.35, 3)) {
        return topDelta;
      }
      return left.left - right.left;
    });

  if (validFragments.length <= 1) {
    return validFragments;
  }

  const merged: TextSelectionFragment[] = [];

  for (const fragment of validFragments) {
    const previous = merged[merged.length - 1];
    if (!previous || !shouldMergeTextSelectionFragments(previous, fragment)) {
      merged.push({ ...fragment });
      continue;
    }

    const previousRight = previous.left + previous.width;
    const previousBottom = previous.top + previous.height;
    const fragmentRight = fragment.left + fragment.width;
    const fragmentBottom = fragment.top + fragment.height;

    previous.left = Math.min(previous.left, fragment.left);
    previous.top = Math.min(previous.top, fragment.top);
    previous.width = Math.max(previousRight, fragmentRight) - previous.left;
    previous.height = Math.max(previousBottom, fragmentBottom) - previous.top;
  }

  return merged;
}

export function buildTextSelectionLayout(payload: {
  blockBounds: PDFImageBounds;
  lines: HighlightLineData[];
  scaleX: number;
  scaleY: number;
  padding: number;
}): TextSelectionLayout {
  const { blockBounds, lines, scaleX, scaleY, padding } = payload;
  return {
    lines: lines.map((line) => buildSelectionLineLayout({ blockBounds, line, scaleX, scaleY, padding }))
  };
}

export function hasSelectableText(layout: TextSelectionLayout): boolean {
  return layout.lines.some((line) => line.text.length > 0 && line.characters.length > 0);
}

export function resolveTextSelectionCaret(
  layout: TextSelectionLayout,
  point: { x: number; y: number }
): TextSelectionCaret | null {
  const lineIndex = resolveLineIndex(layout.lines, point.y);
  if (lineIndex < 0) {
    return null;
  }

  const line = layout.lines[lineIndex];
  if (!line || line.characters.length === 0) {
    return line ? { lineIndex, offset: 0 } : null;
  }

  return {
    lineIndex,
    offset: resolveLineOffset(line, point.x)
  };
}

export function resolveTextSelectionRange(
  layout: TextSelectionLayout,
  anchor: TextSelectionCaret,
  focus: TextSelectionCaret
): TextSelectionRange | null {
  const normalized = compareCarets(anchor, focus) <= 0
    ? { start: anchor, end: focus }
    : { start: focus, end: anchor };

  if (compareCarets(normalized.start, normalized.end) === 0) {
    return null;
  }

  const selectedLines: string[] = [];
  const fragments: TextSelectionFragment[] = [];

  for (let lineIndex = normalized.start.lineIndex; lineIndex <= normalized.end.lineIndex; lineIndex += 1) {
    const line = layout.lines[lineIndex];
    if (!line) {
      continue;
    }

    const lineStart = lineIndex === normalized.start.lineIndex ? normalized.start.offset : 0;
    const lineEnd = lineIndex === normalized.end.lineIndex ? normalized.end.offset : line.text.length;
    if (lineEnd <= lineStart) {
      continue;
    }

    selectedLines.push(line.text.slice(lineStart, lineEnd));

    const selectedCharacters = line.characters.filter(
      (character) => character.index >= lineStart && character.index < lineEnd
    );
    if (selectedCharacters.length === 0) {
      continue;
    }

    const left = Math.min(...selectedCharacters.map((character) => character.left));
    const right = Math.max(...selectedCharacters.map((character) => character.right));
    const top = Math.min(...selectedCharacters.map((character) => character.top));
    const bottom = Math.max(...selectedCharacters.map((character) => character.bottom));
    fragments.push({
      left,
      top,
      width: Math.max(right - left, 1),
      height: Math.max(bottom - top, 1)
    });
  }

  const text = selectedLines.join('\n');
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  if (normalizedText.length === 0 || fragments.length === 0) {
    return null;
  }

  return {
    start: normalized.start,
    end: normalized.end,
    text,
    normalizedText,
    fragments: mergeTextSelectionFragments(fragments)
  };
}

function buildSelectionLineLayout(payload: {
  blockBounds: PDFImageBounds;
  line: HighlightLineData;
  scaleX: number;
  scaleY: number;
  padding: number;
}): TextSelectionLineLayout {
  const { blockBounds, line, scaleX, scaleY, padding } = payload;
  const text = line.text ?? '';
  const lineBounds = resolveLineBounds(blockBounds, line);
  const localLineBounds = toLocalBounds(lineBounds, blockBounds, scaleX, scaleY, padding);

  if (text.length === 0) {
    return {
      text,
      bounds: localLineBounds,
      characters: []
    };
  }

  const localSpanSlices = buildHighlightLineSpanSlices(line).map<LocalSpanSlice>((slice) => ({
    start: slice.start,
    end: slice.end,
    bounds: toLocalBounds(slice.bounds, blockBounds, scaleX, scaleY, padding)
  }));
  const segments = buildSelectionSegments(text, localLineBounds, localSpanSlices);
  if (segments.length === 0) {
    return {
      text,
      bounds: localLineBounds,
      characters: buildUniformCharacterBoxes(text.length, localLineBounds)
    };
  }

  const characters: SelectionCharacterBox[] = [];
  for (const segment of segments) {
    const segmentCharacters = buildUniformCharacterBoxes(segment.end - segment.start, segment.bounds);
    for (let index = 0; index < segmentCharacters.length; index += 1) {
      const character = segmentCharacters[index];
      characters.push({
        index: segment.start + index,
        left: character.left,
        right: character.right,
        top: character.top,
        bottom: character.bottom
      });
    }
  }

  if (characters.length !== text.length) {
    return {
      text,
      bounds: localLineBounds,
      characters: buildUniformCharacterBoxes(text.length, localLineBounds)
    };
  }

  return {
    text,
    bounds: localLineBounds,
    characters
  };
}

function resolveLineBounds(blockBounds: PDFImageBounds, line: HighlightLineData): PDFImageBounds {
  if (line.bounds) {
    return line.bounds;
  }

  const spanBounds = line.spans
    ?.map((span) => span.bounds)
    .filter((bounds): bounds is PDFImageBounds => Boolean(bounds));
  if (spanBounds && spanBounds.length > 0) {
    return mergePdfBounds(spanBounds);
  }

  return blockBounds;
}

function buildSelectionSegments(
  lineText: string,
  localLineBounds: LocalBounds,
  spanSlices: LocalSpanSlice[]
): SelectionSegment[] {
  if (spanSlices.length === 0) {
    return lineText.length > 0
      ? [{ start: 0, end: lineText.length, bounds: localLineBounds }]
      : [];
  }

  const segments: SelectionSegment[] = [];
  let cursor = 0;

  for (let sliceIndex = 0; sliceIndex < spanSlices.length; sliceIndex += 1) {
    const slice = spanSlices[sliceIndex]!;
    if (slice.start > cursor) {
      segments.push({
        start: cursor,
        end: slice.start,
        bounds: buildGapBounds({
          lineBounds: localLineBounds,
          previous: sliceIndex > 0 ? spanSlices[sliceIndex - 1]!.bounds : null,
          next: slice.bounds,
          charCount: slice.start - cursor
        })
      });
    }

    segments.push({
      start: slice.start,
      end: slice.end,
      bounds: slice.bounds
    });
    cursor = slice.end;
  }

  if (cursor < lineText.length) {
    segments.push({
      start: cursor,
      end: lineText.length,
      bounds: buildGapBounds({
        lineBounds: localLineBounds,
        previous: spanSlices[spanSlices.length - 1]!.bounds,
        next: null,
        charCount: lineText.length - cursor
      })
    });
  }

  return segments.filter((segment) => segment.end > segment.start);
}

function buildGapBounds(payload: {
  lineBounds: LocalBounds;
  previous: LocalBounds | null;
  next: LocalBounds | null;
  charCount: number;
}): LocalBounds {
  const { lineBounds, previous, next, charCount } = payload;
  const minX = previous?.maxX ?? lineBounds.minX;
  const maxX = next?.minX ?? lineBounds.maxX;
  const availableWidth = maxX - minX;
  if (availableWidth >= 0.5) {
    return {
      minX,
      minY: lineBounds.minY,
      maxX,
      maxY: lineBounds.maxY
    };
  }

  const lineWidth = Math.max(lineBounds.maxX - lineBounds.minX, 1);
  const approximateCharWidth = Math.max(lineWidth / Math.max(charCount * 6, 1), 4);
  const fallbackWidth = approximateCharWidth * Math.max(charCount, 1);
  const anchorX = previous?.maxX ?? next?.minX ?? lineBounds.minX;
  const centeredMinX = previous
    ? anchorX
    : next
    ? anchorX - fallbackWidth
    : lineBounds.minX;

  return {
    minX: centeredMinX,
    minY: lineBounds.minY,
    maxX: centeredMinX + fallbackWidth,
    maxY: lineBounds.maxY
  };
}

function buildUniformCharacterBoxes(length: number, bounds: LocalBounds): SelectionCharacterBox[] {
  if (length <= 0) {
    return [];
  }

  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const perCharacterWidth = width / length;
  const boxes: SelectionCharacterBox[] = [];

  for (let index = 0; index < length; index += 1) {
    boxes.push({
      index,
      left: bounds.minX + perCharacterWidth * index,
      right: bounds.minX + perCharacterWidth * (index + 1),
      top: bounds.minY,
      bottom: bounds.maxY
    });
  }

  return boxes;
}

function resolveLineIndex(lines: TextSelectionLineLayout[], y: number): number {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }

    if (y >= line.bounds.minY && y <= line.bounds.maxY) {
      return index;
    }

    const distance = y < line.bounds.minY ? line.bounds.minY - y : y - line.bounds.maxY;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function resolveLineOffset(line: TextSelectionLineLayout, x: number): number {
  const characters = line.characters;
  if (characters.length === 0) {
    return 0;
  }

  if (x <= characters[0]!.left) {
    return 0;
  }

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!;
    const midpoint = (character.left + character.right) / 2;
    if (x < midpoint) {
      return index;
    }
  }

  return characters.length;
}

function compareCarets(left: TextSelectionCaret, right: TextSelectionCaret): number {
  if (left.lineIndex !== right.lineIndex) {
    return left.lineIndex - right.lineIndex;
  }
  return left.offset - right.offset;
}

function shouldMergeTextSelectionFragments(
  left: TextSelectionFragment,
  right: TextSelectionFragment
): boolean {
  const leftBottom = left.top + left.height;
  const rightBottom = right.top + right.height;
  const verticalOverlap = Math.min(leftBottom, rightBottom) - Math.max(left.top, right.top);
  const minimumHeight = Math.min(left.height, right.height);
  const overlapRatio = minimumHeight > 0 ? verticalOverlap / minimumHeight : 0;
  if (overlapRatio < 0.55) {
    return false;
  }

  const leftRight = left.left + left.width;
  const gap = right.left - leftRight;
  return gap <= Math.max(minimumHeight * 0.9, 16);
}

function toLocalBounds(
  bounds: PDFImageBounds,
  blockBounds: PDFImageBounds,
  scaleX: number,
  scaleY: number,
  padding: number
): LocalBounds {
  return {
    minX: padding + (bounds.minX - blockBounds.minX) * scaleX,
    minY: padding + (blockBounds.maxY - bounds.maxY) * scaleY,
    maxX: padding + (bounds.maxX - blockBounds.minX) * scaleX,
    maxY: padding + (blockBounds.maxY - bounds.minY) * scaleY
  };
}

function mergePdfBounds(boundsList: PDFImageBounds[]): PDFImageBounds {
  return boundsList.reduce(
    (merged, bounds) => ({
      minX: Math.min(merged.minX, bounds.minX),
      minY: Math.min(merged.minY, bounds.minY),
      maxX: Math.max(merged.maxX, bounds.maxX),
      maxY: Math.max(merged.maxY, bounds.maxY)
    }),
    { ...boundsList[0]! }
  );
}
