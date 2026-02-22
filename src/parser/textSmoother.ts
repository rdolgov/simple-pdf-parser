import type { PDFTextItem } from '../types.js';

export interface TextSmootherOptions {
  lineTolerance?: number;
  gapTolerance?: number;
  overlapTolerance?: number;
  fontTolerance?: number;
  spaceThresholdMultiplier?: number;
  mergeGapMultiplier?: number;
  columnGapMultiplier?: number;
}

const DEFAULT_OPTIONS: Required<TextSmootherOptions> = {
  lineTolerance: 0.75,
  gapTolerance: 80,
  overlapTolerance: 64,
  fontTolerance: 0.5,
  spaceThresholdMultiplier: 0.2,
  mergeGapMultiplier: 0.35,
  columnGapMultiplier: 1.15
};

export function mergeTextRuns(
  items: PDFTextItem[],
  options: TextSmootherOptions = {}
): PDFTextItem[] {
  if (items.length <= 1) {
    return items.slice();
  }

  const env =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { process?: { env?: Record<string, string | undefined> } }).process === 'object'
      ? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process!.env
      : undefined;
  const disableSmoothing = env?.PDF_SMOOTHER_DISABLE === '1';

  if (disableSmoothing) {
    return items.slice();
  }

  const config = { ...DEFAULT_OPTIONS, ...options };
  const result: PDFTextItem[] = [];
  let lastEndX: number | undefined;

  for (const current of items) {
    const last = result[result.length - 1];
    if (!last) {
      const cloned = cloneItem(current);
      result.push(cloned);
      lastEndX = getBounds(cloned).maxX;
      continue;
    }

    const decision = mergeDecision(last, current, lastEndX ?? getBounds(last).maxX, config);
    if (!decision.merge) {
      const cloned = cloneItem(current);
      result.push(cloned);
      lastEndX = getBounds(cloned).maxX;
      continue;
    }

    const normalizedSegment = decision.insertSpace
      ? current.text.replace(/^\s+/, '')
      : current.text;
    const textToAppend = decision.insertSpace
      ? prependSpaceIfNeeded(last.text, normalizedSegment)
      : normalizedSegment;

    last.text += textToAppend;
    const lastBounds = getBounds(last);
    const currentBounds = getBounds(current);
    last.bounds = {
      minX: Math.min(lastBounds.minX, currentBounds.minX),
      minY: Math.min(lastBounds.minY, currentBounds.minY),
      maxX: Math.max(lastBounds.maxX, currentBounds.maxX),
      maxY: Math.max(lastBounds.maxY, currentBounds.maxY)
    };
    lastEndX = last.bounds.maxX;
    last.font = last.font ?? current.font;
    if (last.fontSize === undefined) {
      last.fontSize = current.fontSize;
    }
    // Merge Type3 glyph arrays
    if (current.type3Glyphs && current.type3Glyphs.length > 0) {
      if (last.type3Glyphs) {
        last.type3Glyphs = [...last.type3Glyphs, ...current.type3Glyphs];
      } else {
        last.type3Glyphs = [...current.type3Glyphs];
      }
      if (!last.fontMatrix && current.fontMatrix) {
        last.fontMatrix = current.fontMatrix;
      }
    }
  }

  return result;
}

interface MergeDecision {
  merge: boolean;
  insertSpace: boolean;
}

function mergeDecision(
  prev: PDFTextItem,
  next: PDFTextItem,
  lastEndX: number,
  options: Required<TextSmootherOptions>
): MergeDecision {
  // Don't merge Type3 font items. Their text content is placeholder (NBSPs)
  // and each item carries its own glyph path data that should be rendered
  // at its original position. Merging creates a single wide item that
  // distorts per-glyph spacing in the renderer.
  if (prev.type3Glyphs && prev.type3Glyphs.length > 0) {
    return { merge: false, insertSpace: false };
  }

  const prevY = baselineY(prev);
  const nextY = baselineY(next);
  const deltaY = Math.abs(prevY - nextY);
  if (deltaY > options.lineTolerance) {
    return { merge: false, insertSpace: false };
  }

  const prevBounds = getBounds(prev);
  const nextBounds = getBounds(next);
  const prevSize = (prev.fontSize ?? next.fontSize ?? (prevBounds.maxY - prevBounds.minY)) || 12;
  const nextSize = (next.fontSize ?? prev.fontSize ?? (nextBounds.maxY - nextBounds.minY)) || 12;
  if (Math.abs(prevSize - nextSize) > options.fontTolerance * Math.max(prevSize, nextSize)) {
    return { merge: false, insertSpace: false };
  }

  const gap = getBounds(next).minX - lastEndX;

  if (gap < -options.overlapTolerance) {
    return { merge: false, insertSpace: false };
  }

  const referenceSize = Math.max(
    prevBounds.maxY - prevBounds.minY,
    nextBounds.maxY - nextBounds.minY,
    prevSize,
    nextSize
  );

  const prevChars = Math.max(prev.text.trim().length, 1);
  const nextChars = Math.max(next.text.trim().length, 1);
  const prevWidth = Math.max(prevBounds.maxX - prevBounds.minX, 0);
  const nextWidth = Math.max(nextBounds.maxX - nextBounds.minX, 0);
  const avgCharWidth = Math.max(
    prevChars > 0 ? prevWidth / prevChars : 0,
    nextChars > 0 ? nextWidth / nextChars : 0
  );
  const columnReference = Math.max(referenceSize, avgCharWidth || referenceSize);

  if (gap >= columnReference * options.columnGapMultiplier) {
    return { merge: false, insertSpace: false };
  }

  const largeGapLimit = Math.max(options.gapTolerance * 8, referenceSize * 12);
  const nextStartsWithSpace = /^\s/.test(next.text);

  if (nextStartsWithSpace && gap >= -options.overlapTolerance) {
    if (gap > largeGapLimit) {
      return { merge: false, insertSpace: false };
    }
    return { merge: true, insertSpace: true };
  }

  if (gap > largeGapLimit) {
    return { merge: false, insertSpace: false };
  }

  const requiresSpace = shouldInsertSpace(prev, next, gap, Math.max(prevSize, nextSize), options);

  if (!requiresSpace) {
    const mergeGapLimit = -options.overlapTolerance * options.mergeGapMultiplier;
    if (gap < mergeGapLimit) {
      return { merge: false, insertSpace: false };
    }
  }

  return { merge: true, insertSpace: requiresSpace };
}

function segmentWidth(item: PDFTextItem): number {
  const bounds = item.bounds;
  if (bounds) {
    return Math.max(0, bounds.maxX - bounds.minX);
  }
  const length = item.text.length;
  if (length === 0) {
    return 0;
  }
  const fontSize = item.fontSize ?? 12;
  return length * fontSize * 0.35;
}

function shouldInsertSpace(
  prev: PDFTextItem,
  next: PDFTextItem,
  gap: number,
  referenceSize: number,
  options: Required<TextSmootherOptions>
): boolean {
  if (gap <= 0) {
    return false;
  }

  if (prev.text.trimEnd().endsWith('-')) {
    return false;
  }

  if (/\s$/.test(prev.text) || /^\s/.test(next.text)) {
    return false;
  }

  if (/^[.,;:!?]/.test(next.text)) {
    return false;
  }

  const threshold = Math.max(referenceSize * options.spaceThresholdMultiplier, 0.5);
  if (gap >= threshold) {
    return true;
  }

  const prevWidth = segmentWidth(prev);
  const nextWidth = segmentWidth(next);
  const prevChars = Math.max(prev.text.trim().length, 1);
  const nextChars = Math.max(next.text.trim().length, 1);
  const avgCharWidth = Math.max(prevWidth / prevChars, nextWidth / nextChars);

  const fineThreshold = Math.max(avgCharWidth * options.spaceThresholdMultiplier, 0.5);

  return gap >= fineThreshold;
}

function prependSpaceIfNeeded(previousText: string, currentText: string): string {
  if (previousText.length === 0 || /\s$/.test(previousText) || /^\s/.test(currentText)) {
    return currentText;
  }
  return ` ${currentText.replace(/^\s+/, '')}`;
}

function getBounds(item: PDFTextItem) {
  return item.bounds;
}

function cloneItem(item: PDFTextItem): PDFTextItem {
  return {
    ...item,
    text: item.text,
    bounds: { ...item.bounds }
  };
}

function baselineY(item: PDFTextItem): number {
  const bounds = getBounds(item);
  return Math.min(bounds.minY, bounds.maxY);
}
