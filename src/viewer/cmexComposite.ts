import type { PDFTextItem } from '../types.js';

export type CmexCompositeKind = 'overbrace' | 'underbrace';

export interface CmexComposite {
  kind: CmexCompositeKind;
  anchorIndex: number;
  hiddenIndices: number[];
  minX: number;
  maxX: number;
  centerY: number;
  targetHeight: number;
  fontSize: number;
}

export interface CmexCompositeDetection {
  composites: CmexComposite[];
  hiddenIndices: Set<number>;
}

export function detectCmexComposites(items: PDFTextItem[]): CmexCompositeDetection {
  const composites: CmexComposite[] = [];
  const hiddenIndices = new Set<number>();

  for (let index = 0; index < items.length; index += 1) {
    if (hiddenIndices.has(index)) {
      continue;
    }

    const item = items[index];
    if (!isCompositeCandidate(item)) {
      continue;
    }

    if (item.text === 'z}|') {
      const stemIndex = findOverbraceStemIndex(index, item, items, hiddenIndices);
      if (stemIndex === undefined) {
        continue;
      }

      const stem = items[stemIndex];
      const fontSize = item.fontSize ?? stem.fontSize ?? 12;
      const rawHeight = Math.max(
        item.bounds.maxY,
        stem.bounds.maxY
      ) - Math.min(item.bounds.minY, stem.bounds.minY);

      composites.push({
        kind: 'overbrace',
        anchorIndex: index,
        hiddenIndices: [index, stemIndex],
        minX: item.bounds.minX,
        maxX: stem.bounds.maxX,
        centerY: (item.bounds.minY + item.bounds.maxY) / 2,
        targetHeight: Math.min(rawHeight, fontSize * 1.35),
        fontSize
      });

      hiddenIndices.add(index);
      hiddenIndices.add(stemIndex);
      continue;
    }

    if (item.text === '{z') {
      const underbrace = findUnderbraceSides(index, item, items, hiddenIndices);
      if (!underbrace) {
        continue;
      }

      const { leftIndex, rightIndex } = underbrace;
      const left = items[leftIndex];
      const right = items[rightIndex];
      const fontSize = item.fontSize ?? left.fontSize ?? right.fontSize ?? 12;
      const rawHeight = Math.max(item.bounds.maxY, left.bounds.maxY, right.bounds.maxY) -
        Math.min(item.bounds.minY, left.bounds.minY, right.bounds.minY);

      composites.push({
        kind: 'underbrace',
        anchorIndex: index,
        hiddenIndices: [leftIndex, index, rightIndex],
        minX: left.bounds.minX,
        maxX: right.bounds.maxX,
        centerY: (item.bounds.minY + item.bounds.maxY) / 2,
        targetHeight: Math.min(rawHeight, fontSize * 1.35),
        fontSize
      });

      hiddenIndices.add(leftIndex);
      hiddenIndices.add(index);
      hiddenIndices.add(rightIndex);
    }
  }

  return { composites, hiddenIndices };
}

function findOverbraceStemIndex(
  index: number,
  head: PDFTextItem,
  items: PDFTextItem[],
  hiddenIndices: Set<number>
): number | undefined {
  const fontSize = head.fontSize ?? 12;
  let bestIndex: number | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let candidateIndex = 0; candidateIndex < items.length; candidateIndex += 1) {
    if (candidateIndex === index || hiddenIndices.has(candidateIndex)) {
      continue;
    }

    const candidate = items[candidateIndex];
    if (!isCmexText(candidate, '{') || !hasCompatibleFontSize(head, candidate)) {
      continue;
    }

    const xGap = Math.abs(candidate.bounds.minX - head.bounds.maxX);
    const yDelta = Math.abs(itemBaseline(head) - itemBaseline(candidate));
    const verticalExtension = head.bounds.minY - candidate.bounds.minY;
    if (xGap > fontSize || yDelta > fontSize * 0.2 || verticalExtension < fontSize * 0.5) {
      continue;
    }

    const score = xGap + yDelta + Math.abs(verticalExtension - fontSize);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = candidateIndex;
    }
  }

  return bestIndex;
}

function findUnderbraceSides(
  index: number,
  head: PDFTextItem,
  items: PDFTextItem[],
  hiddenIndices: Set<number>
): { leftIndex: number; rightIndex: number } | undefined {
  const fontSize = head.fontSize ?? 12;
  let leftIndex: number | undefined;
  let leftScore = Number.POSITIVE_INFINITY;
  let rightIndex: number | undefined;
  let rightScore = Number.POSITIVE_INFINITY;

  for (let candidateIndex = 0; candidateIndex < items.length; candidateIndex += 1) {
    if (candidateIndex === index || hiddenIndices.has(candidateIndex)) {
      continue;
    }

    const candidate = items[candidateIndex];
    if (!hasCompatibleFontSize(head, candidate)) {
      continue;
    }

    const yDelta = Math.abs(itemBaseline(head) - itemBaseline(candidate));
    const verticalExtension = head.bounds.minY - candidate.bounds.minY;
    if (yDelta > fontSize * 0.2 || verticalExtension < fontSize * 0.8) {
      continue;
    }

    if (isCmexText(candidate, '|')) {
      const xGap = Math.abs(head.bounds.minX - candidate.bounds.maxX);
      if (xGap <= fontSize) {
        const score = xGap + Math.abs(verticalExtension - fontSize * 2);
        if (score < leftScore) {
          leftScore = score;
          leftIndex = candidateIndex;
        }
      }
      continue;
    }

    if (isCmexText(candidate, '}')) {
      const xGap = Math.abs(candidate.bounds.minX - head.bounds.maxX);
      if (xGap <= fontSize) {
        const score = xGap + Math.abs(verticalExtension - fontSize * 2);
        if (score < rightScore) {
          rightScore = score;
          rightIndex = candidateIndex;
        }
      }
    }
  }

  if (leftIndex === undefined || rightIndex === undefined) {
    return undefined;
  }

  return { leftIndex, rightIndex };
}

function isCompositeCandidate(item: PDFTextItem): boolean {
  return isCmexText(item, 'z}|') || isCmexText(item, '{z');
}

function isCmexText(item: PDFTextItem, expectedText: string): boolean {
  return Boolean(item.font && /CMEX/i.test(item.font) && item.text === expectedText);
}

function hasCompatibleFontSize(left: PDFTextItem, right: PDFTextItem): boolean {
  const leftFontSize = left.fontSize ?? 12;
  const rightFontSize = right.fontSize ?? 12;
  return Math.abs(leftFontSize - rightFontSize) <= 0.5;
}

function itemBaseline(item: PDFTextItem): number {
  return item.baselineStart?.y ?? item.bounds.maxY;
}
