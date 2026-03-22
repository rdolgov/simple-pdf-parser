import type { PDFTextItem } from '../types.js';
import { looksLikeTableCellToken as isTableCellToken } from '../common/tabularTokenHeuristics.js';

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
  spaceThresholdMultiplier: 0.16,
  mergeGapMultiplier: 0.35,
  columnGapMultiplier: 1.15
};

const COMMON_SHORT_WORDS = new Set([
  'a', 'all', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'but', 'by', 'can',
  'do', 'for', 'he', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'not', 'of',
  'on', 'one', 'or', 'our', 'out', 'so', 'the', 'to', 'up', 'us', 'we', 'you'
]);

const COMBINED_SHORT_WORDS = new Set([
  'into'
]);

const COMMON_PREFIX_FRAGMENTS = new Set([
  'ab', 'ad', 'anti', 'auto', 'bi', 'co', 'com', 'con', 'counter', 'de', 'di',
  'dis', 'em', 'en', 'ex', 'extra', 'fore', 'hetero', 'homo', 'hyper', 'il',
  'im', 'in', 'inter', 'ir', 'macro', 'micro', 'mid', 'mis', 'mono', 'multi',
  'non', 'over', 'poly', 'post', 'pre', 'pro', 're', 'semi', 'sub', 'super',
  'tele', 'trans', 'tri', 'un', 'under'
]);

const COMMON_SUFFIX_FRAGMENTS = new Set([
  'able', 'ably', 'age', 'al', 'ally', 'ance', 'ant', 'ary', 'ation', 'ations',
  'ative', 'atively', 'd', 'dom', 'ed', 'en', 'ence', 'ent', 'er', 'ers', 'es',
  'est', 'ful', 'h', 'hood', 'ial', 'ian', 'ible', 'ic', 'ics', 'ies', 'ing',
  'ion', 'ions', 'ious', 'ish', 'ism', 'ist', 'ity', 'ive', 'ization', 'ize',
  'ized', 'less', 'ly', 'ment', 'ments', 'ness', 'or', 'ory', 'ous', 'r', 'ry',
  's', 'ship', 'tion', 'tions', 'ty', 'ure', 'ward', 'wards', 'y'
]);

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
  const orderedItems = sortForSmoothing(dropDegenerateDuplicateRuns(items), config);
  const result: PDFTextItem[] = [];
  let lastEndX: number | undefined;

  for (const current of orderedItems) {
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
    const previousLastEndX = lastEndX ?? getBounds(last).maxX;

    last.text += textToAppend;
    const lastBounds = getBounds(last);
    const currentBounds = getBounds(current);
    last.bounds = {
      minX: Math.min(lastBounds.minX, currentBounds.minX),
      minY: Math.min(lastBounds.minY, currentBounds.minY),
      maxX: Math.max(lastBounds.maxX, currentBounds.maxX),
      maxY: Math.max(lastBounds.maxY, currentBounds.maxY)
    };
    last.baselineStart = clonePoint(last.baselineStart ?? current.baselineStart);
    last.baselineEnd = clonePoint(current.baselineEnd ?? current.baselineStart ?? last.baselineEnd);
    last.font = last.font ?? current.font;
    if (last.fontSize === undefined) {
      last.fontSize = current.fontSize;
    }
    if (current.glyphSpans && current.glyphSpans.length > 0) {
      const insertedSpaceAdvance = decision.insertSpace
        ? Math.max(0, currentBounds.minX - previousLastEndX)
        : 0;
      if (last.glyphSpans) {
        if (insertedSpaceAdvance > 0) {
          last.glyphSpans.push({ text: ' ', advance: insertedSpaceAdvance, synthetic: true });
        }
        last.glyphSpans = [...last.glyphSpans, ...current.glyphSpans.map(cloneGlyphSpan)];
      } else {
        last.glyphSpans = current.glyphSpans.map(cloneGlyphSpan);
      }
    }
    lastEndX = last.bounds.maxX;
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
  // Don't merge glyph-by-glyph drawing fonts. Their spacing is encoded by the
  // original PDF positions, so combining runs distorts diagrams and symbols.
  if (hasIntrinsicGlyphSpacing(prev) || hasIntrinsicGlyphSpacing(next)) {
    return { merge: false, insertSpace: false };
  }

  if (!hasCompatibleTextStyle(prev, next)) {
    return { merge: false, insertSpace: false };
  }

  if (shouldKeepSeparateMathDelimiters(prev, next)) {
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

  if (shouldKeepSeparateTableCells(prev, next, gap, avgCharWidth)) {
    return { merge: false, insertSpace: false };
  }

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
    if (gap > 0 && !isLikelySplitWord(prev.text, next.text, gap, avgCharWidth) && canLeaveAsSeparateFragments(prev.text, next.text)) {
      return { merge: false, insertSpace: false };
    }
    const mergeGapLimit = -options.overlapTolerance * options.mergeGapMultiplier;
    if (gap < mergeGapLimit) {
      return { merge: false, insertSpace: false };
    }
  }

  return { merge: true, insertSpace: requiresSpace };
}

function hasIntrinsicGlyphSpacing(item: PDFTextItem): boolean {
  return (item.type3Glyphs && item.type3Glyphs.length > 0) || /line10/i.test(item.font ?? '');
}

function hasCompatibleTextStyle(prev: PDFTextItem, next: PDFTextItem): boolean {
  if (prev.fontResourceKey && next.fontResourceKey && prev.fontResourceKey !== next.fontResourceKey) {
    return false;
  }

  if (prev.font && next.font && prev.font !== next.font) {
    return false;
  }

  if (prev.fontWeight && next.fontWeight && prev.fontWeight !== next.fontWeight) {
    return false;
  }

  if (prev.fontStyle && next.fontStyle && prev.fontStyle !== next.fontStyle) {
    return false;
  }

  return true;
}

function shouldKeepSeparateMathDelimiters(prev: PDFTextItem, next: PDFTextItem): boolean {
  return isStretchyMathDelimiterItem(prev) && isStretchyMathDelimiterItem(next);
}

function isStretchyMathDelimiterItem(item: PDFTextItem): boolean {
  return /cmex/i.test(item.font ?? '') && isStretchyMathDelimiterText(item.text);
}

function isStretchyMathDelimiterText(text: string): boolean {
  return /^[()[\]{}|]$/.test(text.trim());
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
  if (prev.text.trimEnd().endsWith('-')) {
    return false;
  }

  if (/\s$/.test(prev.text) || /^\s/.test(next.text)) {
    return false;
  }

  if (/^[.,;:!?]/.test(next.text)) {
    return false;
  }

  const advanceOverflow = Math.max(
    (prev.baselineEnd?.x ?? prev.bounds.maxX) - prev.bounds.maxX,
    0
  );
  const prevWidth = segmentWidth(prev);
  const nextWidth = segmentWidth(next);
  const prevChars = Math.max(prev.text.trim().length, 1);
  const nextChars = Math.max(next.text.trim().length, 1);
  const avgCharWidth = Math.max(prevWidth / prevChars, nextWidth / nextChars);
  const slightOverlapTolerance = Math.max(avgCharWidth * 0.12, 0.6);

  if (gap < -slightOverlapTolerance) {
    return false;
  }

  if (isLikelySplitWord(prev.text, next.text, gap, avgCharWidth)) {
    return false;
  }

  if (hasLikelyWordBoundary(prev.text, next.text, gap, avgCharWidth)) {
    return true;
  }

  const threshold = Math.max(referenceSize * options.spaceThresholdMultiplier, 0.5);
  const overflowThreshold = Math.max(referenceSize * 0.12, 1);
  if (advanceOverflow >= overflowThreshold) {
    return true;
  }

  if (gap >= threshold) {
    return true;
  }

  const fineThreshold = Math.max(avgCharWidth * 0.28, 0.5);

  return gap >= fineThreshold;
}

function isLikelySplitWord(prevText: string, nextText: string, gap: number, avgCharWidth: number): boolean {
  const prevFragment = getTrailingWordFragment(prevText);
  const nextFragment = getLeadingWordFragment(nextText);
  const prevWord = normalizeWordFragment(prevFragment);
  const nextWord = normalizeWordFragment(nextFragment);
  const standalonePrevFragment = isStandaloneAlphabeticFragment(prevText, prevFragment);
  if (prevWord.length === 0 || nextWord.length === 0) {
    return false;
  }

  const titleCaseSplit = standalonePrevFragment && /^[A-Z]$/.test(prevFragment) && /^[a-z]/.test(nextFragment);
  const shortContinuation = isLikelyShortWordContinuation(prevWord, nextWord, nextFragment, gap, avgCharWidth);
  const tightShortPrefixSplit = isTightShortPrefixSplit(prevWord, nextWord, nextFragment, gap, avgCharWidth);
  const tightShortSuffixSplit = isTightShortSuffixSplit(prevWord, nextWord, nextFragment, gap, avgCharWidth);
  const tightThreeLetterPrefixSplit = isTightThreeLetterPrefixSplit(prevWord, nextWord, nextFragment, gap, avgCharWidth);
  const combinedShortWord = COMBINED_SHORT_WORDS.has(`${prevWord}${nextWord}`);

  if (combinedShortWord) {
    return gap <= Math.max(avgCharWidth * 0.22, 1);
  }

  if (
    (COMMON_SHORT_WORDS.has(prevWord) && !tightShortPrefixSplit) ||
    (COMMON_SHORT_WORDS.has(nextWord) && !shortContinuation && !tightShortSuffixSplit && !titleCaseSplit)
  ) {
    return false;
  }

  const suffixSplit = /^[a-z]/.test(nextFragment) && COMMON_SUFFIX_FRAGMENTS.has(nextWord);
  const prefixSplit =
    standalonePrevFragment &&
    /^[a-z]/.test(nextFragment) &&
    (COMMON_PREFIX_FRAGMENTS.has(prevWord) || prevWord.length <= 2);
  const compactSplit =
    standalonePrevFragment &&
    /^[a-z]/.test(nextFragment) &&
    gap <= Math.max(avgCharWidth * 0.18, 1) &&
    prevWord.length + nextWord.length <= 10;
  const tightAlphabeticContinuation =
    /^[a-z]/.test(nextFragment) &&
    prevWord.length >= 2 &&
    nextWord.length >= 4 &&
    prevWord.length + nextWord.length <= 20 &&
    gap <= Math.max(avgCharWidth * 0.12, 0.5);
  const tightCompoundSplit =
    /^[a-z]/.test(nextFragment) &&
    prevWord.length >= 3 &&
    nextWord.length >= 4 &&
    prevWord.length + nextWord.length <= 16 &&
    gap <= Math.max(avgCharWidth * 0.02, 0.25);

  const gapLimit = suffixSplit || titleCaseSplit || prefixSplit || compactSplit || tightCompoundSplit
    ? Math.max(avgCharWidth * 1.6, 8)
    : Math.max(avgCharWidth * 0.85, 4);
  const overlapTolerance = Math.max(avgCharWidth * 0.18, 0.75);

  if (gap >= gapLimit || gap < -overlapTolerance) {
    return false;
  }

  return (
    shortContinuation ||
    tightShortPrefixSplit ||
    tightShortSuffixSplit ||
    tightThreeLetterPrefixSplit ||
    suffixSplit ||
    titleCaseSplit ||
    prefixSplit ||
    compactSplit ||
    tightAlphabeticContinuation ||
    tightCompoundSplit
  );
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
    bounds: { ...item.bounds },
    baselineStart: clonePoint(item.baselineStart),
    baselineEnd: clonePoint(item.baselineEnd),
    glyphSpans: item.glyphSpans?.map(cloneGlyphSpan)
  };
}

function baselineY(item: PDFTextItem): number {
  const bounds = getBounds(item);
  return Math.min(bounds.minY, bounds.maxY);
}

function clonePoint(point: PDFTextItem['baselineStart']): PDFTextItem['baselineStart'] {
  return point ? { ...point } : undefined;
}

function cloneGlyphSpan(span: NonNullable<PDFTextItem['glyphSpans']>[number]) {
  return { ...span };
}

function normalizeWordFragment(text: string): string {
  const normalized = text.replace(/['’]/g, '').toLowerCase();
  return /^[a-z]+$/.test(normalized) ? normalized : '';
}

function canLeaveAsSeparateFragments(prevText: string, nextText: string): boolean {
  const prevWord = normalizeWordFragment(getTrailingWordFragment(prevText));
  const nextWord = normalizeWordFragment(getLeadingWordFragment(nextText));
  return prevWord.length > 0 && nextWord.length > 0 && !isLikelyShortWordFragment(prevWord, nextWord);
}

function shouldKeepSeparateTableCells(
  prev: PDFTextItem,
  next: PDFTextItem,
  gap: number,
  avgCharWidth: number
): boolean {
  if (!looksLikeTableCellToken(prev.text) || !looksLikeTableCellToken(next.text)) {
    return false;
  }

  const overlapTolerance = Math.max(avgCharWidth * 0.12, 0.75);
  return gap >= -overlapTolerance;
}

function looksLikeTableCellToken(text: string): boolean {
  return isTableCellToken(text);
}

function hasLikelyWordBoundary(prevText: string, nextText: string, gap: number, avgCharWidth: number): boolean {
  const prevFragment = getTrailingWordFragment(prevText);
  const nextFragment = getLeadingWordFragment(nextText);
  const prevWord = normalizeWordFragment(prevFragment);
  const nextWord = normalizeWordFragment(nextFragment);
  const standalonePrevFragment = isStandaloneAlphabeticFragment(prevText, prevFragment);
  const titleCaseSplit = standalonePrevFragment && /^[A-Z]$/.test(prevFragment) && /^[a-z]/.test(nextFragment);
  const shortContinuation = isLikelyShortWordContinuation(prevWord, nextWord, nextFragment, gap, avgCharWidth);
  const tightShortPrefixSplit = isTightShortPrefixSplit(prevWord, nextWord, nextFragment, gap, avgCharWidth);
  const tightShortSuffixSplit = isTightShortSuffixSplit(prevWord, nextWord, nextFragment, gap, avgCharWidth);
  const tightThreeLetterPrefixSplit = isTightThreeLetterPrefixSplit(prevWord, nextWord, nextFragment, gap, avgCharWidth);
  const combinedShortWord = COMBINED_SHORT_WORDS.has(`${prevWord}${nextWord}`);

  if (prevWord.length === 0 || nextWord.length === 0) {
    return false;
  }

  const slightOverlapTolerance = Math.max(avgCharWidth * 0.12, 0.6);
  if (gap < -slightOverlapTolerance) {
    return false;
  }

  if (/[.,;:!?)]$/.test(prevText.trimEnd())) {
    return true;
  }

  if (combinedShortWord && gap <= Math.max(avgCharWidth * 0.22, 1)) {
    return false;
  }

  const clearWordGapThreshold = Math.max(avgCharWidth * 0.16, 0.5);
  if (gap < clearWordGapThreshold) {
    return false;
  }

  if (
    (COMMON_SHORT_WORDS.has(prevWord) && !tightShortPrefixSplit) ||
    (COMMON_SHORT_WORDS.has(nextWord) && !shortContinuation && !tightShortSuffixSplit && !titleCaseSplit)
  ) {
    return true;
  }

  if (/^[A-Z]/.test(nextFragment)) {
    return true;
  }

  if (tightThreeLetterPrefixSplit) {
    return false;
  }

  return prevWord.length >= 3 && nextWord.length >= 3;
}

function isLikelyShortWordContinuation(
  prevWord: string,
  nextWord: string,
  nextFragment: string,
  gap: number,
  avgCharWidth: number
): boolean {
  if (!COMMON_SHORT_WORDS.has(nextWord)) {
    return false;
  }

  if (!/^[a-z]/.test(nextFragment)) {
    return false;
  }

  if (!COMMON_PREFIX_FRAGMENTS.has(prevWord) || prevWord.length > 2) {
    return false;
  }

  if (prevWord.length + nextWord.length < 4) {
    return false;
  }

  return gap <= Math.max(avgCharWidth * 0.22, 1);
}

function isTightShortPrefixSplit(
  prevWord: string,
  nextWord: string,
  nextFragment: string,
  gap: number,
  avgCharWidth: number
): boolean {
  if (!COMMON_SHORT_WORDS.has(prevWord) || prevWord.length > 2) {
    return false;
  }

  if (nextWord.length < 2 || !/^[a-z]/.test(nextFragment)) {
    if (nextWord.length !== 1 || !/^[a-z]/.test(nextFragment)) {
      return false;
    }
  }

  if (nextWord.length === 1 && prevWord.length + nextWord.length < 2) {
    return false;
  }

  if (nextWord.length > 1 && prevWord.length + nextWord.length < 4) {
    return false;
  }

  return gap <= Math.max(avgCharWidth * 0.1, 0.75);
}

function isTightShortSuffixSplit(
  prevWord: string,
  nextWord: string,
  nextFragment: string,
  gap: number,
  avgCharWidth: number
): boolean {
  if (!COMMON_SHORT_WORDS.has(nextWord) || COMMON_SHORT_WORDS.has(prevWord)) {
    return false;
  }

  if (prevWord.length === 0 || prevWord.length > 5 || !/^[a-z]/.test(nextFragment)) {
    return false;
  }

  return gap <= Math.max(avgCharWidth * 0.1, 0.75);
}

function isTightThreeLetterPrefixSplit(
  prevWord: string,
  nextWord: string,
  nextFragment: string,
  gap: number,
  avgCharWidth: number
): boolean {
  if (prevWord.length !== 3 || nextWord.length < 4 || !/^[a-z]/.test(nextFragment)) {
    return false;
  }

  if (COMMON_SHORT_WORDS.has(prevWord)) {
    return false;
  }

  return gap <= Math.max(avgCharWidth * 0.02, 0.35);
}

function getLeadingWordFragment(text: string): string {
  const match = text.match(/^[^A-Za-z]*([A-Za-z]+(?:['’][A-Za-z]+)*)/);
  return match?.[1] ?? '';
}

function getTrailingWordFragment(text: string): string {
  const match = text.match(/([A-Za-z]+(?:['’][A-Za-z]+)*)[^A-Za-z]*$/);
  return match?.[1] ?? '';
}

function isStandaloneAlphabeticFragment(text: string, fragment: string): boolean {
  if (!fragment) {
    return false;
  }

  const trimmed = text.trimEnd();
  const endIndex = trimmed.lastIndexOf(fragment);
  if (endIndex === -1 || endIndex + fragment.length !== trimmed.length) {
    return false;
  }

  const previousChar = trimmed[endIndex - 1];
  return previousChar === undefined || !/[A-Za-z0-9]/.test(previousChar);
}

function isLikelyShortWordFragment(prevWord: string, nextWord: string): boolean {
  if (COMMON_SHORT_WORDS.has(prevWord) || COMMON_SHORT_WORDS.has(nextWord)) {
    return false;
  }

  return COMMON_SUFFIX_FRAGMENTS.has(nextWord) || COMMON_PREFIX_FRAGMENTS.has(prevWord) || prevWord.length <= 3;
}

function sortForSmoothing(items: PDFTextItem[], options: Required<TextSmootherOptions>): PDFTextItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftY = baselineY(left.item);
      const rightY = baselineY(right.item);
      const deltaY = Math.abs(leftY - rightY);

      if (deltaY > options.lineTolerance) {
        return rightY - leftY;
      }

      const deltaX = left.item.bounds.minX - right.item.bounds.minX;
      if (Math.abs(deltaX) > 0.001) {
        return deltaX;
      }

      return left.index - right.index;
    })
    .map(({ item }) => item);
}

function dropDegenerateDuplicateRuns(items: PDFTextItem[]): PDFTextItem[] {
  const groupedIndices = new Map<string, number[]>();

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const key = [
      item.text,
      item.font ?? '',
      roundKey(item.fontSize ?? 0, 100),
      roundKey(item.bounds.minX, 100),
      roundKey(item.bounds.minY, 100),
      roundKey(item.baselineStart?.x ?? item.bounds.minX, 100),
      roundKey(item.baselineStart?.y ?? item.bounds.minY, 100)
    ].join('|');
    const bucket = groupedIndices.get(key);
    if (bucket) {
      bucket.push(index);
    } else {
      groupedIndices.set(key, [index]);
    }
  }

  const skipped = new Set<number>();

  for (const indices of groupedIndices.values()) {
    if (indices.length < 2) {
      continue;
    }

    const hasRenderableSibling = indices.some((index) => !isDegeneratePlaceholderRun(items[index]));
    if (!hasRenderableSibling) {
      continue;
    }

    for (const index of indices) {
      if (isDegeneratePlaceholderRun(items[index])) {
        skipped.add(index);
      }
    }
  }

  return items.filter((_, index) => !skipped.has(index));
}

function isDegeneratePlaceholderRun(item: PDFTextItem): boolean {
  if ((item.type3Glyphs && item.type3Glyphs.length > 0) || /line10/i.test(item.font ?? '')) {
    return false;
  }

  const width = Math.max(0, item.bounds.maxX - item.bounds.minX);
  return width <= 0.01;
}

function roundKey(value: number, multiplier: number): string {
  return String(Math.round(value * multiplier));
}
