import type { HtmlHeadingBlock, HtmlPageLayout, HtmlParagraphBlock, PDFImageBounds } from 'pdf-layout-parser';

type TextBlock = HtmlParagraphBlock | HtmlHeadingBlock;

export interface LogicalHoverSegment {
  blockIndexes: number[];
  blocks: TextBlock[];
  text: string;
  bounds: PDFImageBounds | null;
}

export function resolveLogicalHoverSegment(params: {
  page: HtmlPageLayout;
  blockIndexes: number[];
  selectedBlockIndex: number;
}): LogicalHoverSegment | null {
  const ordered = [...new Set(params.blockIndexes)]
    .sort((left, right) => left - right)
    .map((blockIndex) => {
      const block = params.page.content[blockIndex];
      return isTextBlock(block) ? { blockIndex, block } : null;
    })
    .filter((entry): entry is { blockIndex: number; block: TextBlock } => entry !== null);

  if (ordered.length === 0) {
    return null;
  }

  const selectedPosition = ordered.findIndex((entry) => entry.blockIndex === params.selectedBlockIndex);
  if (selectedPosition < 0) {
    return buildLogicalHoverSegment(ordered);
  }

  const boundaryPositions = ordered
    .map((entry, index) => (isLogicalBoundaryBlock(entry.block) ? index : -1))
    .filter((index) => index >= 0);

  if (boundaryPositions.length <= 1) {
    return buildLogicalHoverSegment(ordered);
  }

  const activeBoundaryPosition = findActiveBoundaryPosition(ordered, selectedPosition);
  const startPosition = activeBoundaryPosition ?? 0;
  let endPosition = ordered.length - 1;
  for (const boundaryPosition of boundaryPositions) {
    if (boundaryPosition > startPosition) {
      endPosition = boundaryPosition - 1;
      break;
    }
  }

  const clipped = ordered.slice(startPosition, Math.max(startPosition + 1, endPosition + 1));
  return buildLogicalHoverSegment(clipped);
}

function buildLogicalHoverSegment(entries: Array<{ blockIndex: number; block: TextBlock }>): LogicalHoverSegment {
  const blocks = entries.map((entry) => entry.block);
  const boundsList = blocks
    .map((block) => block.bounds)
    .filter((bounds): bounds is PDFImageBounds => hasBounds(bounds));

  return {
    blockIndexes: entries.map((entry) => entry.blockIndex),
    blocks,
    text: blocks.map((block) => normalizeText(block.text)).filter(Boolean).join('\n\n'),
    bounds: boundsList.length > 0 ? mergeBounds(boundsList) : null
  };
}

function findActiveBoundaryPosition(
  entries: Array<{ blockIndex: number; block: TextBlock }>,
  selectedPosition: number
): number | null {
  for (let index = selectedPosition; index >= 0; index -= 1) {
    if (isLogicalBoundaryBlock(entries[index].block)) {
      return index;
    }
  }
  return null;
}

function isLogicalBoundaryBlock(block: TextBlock): boolean {
  if (block.type === 'heading') {
    return true;
  }

  const text = normalizeText(block.text);
  if (text.length === 0 || text.length > 140) {
    return false;
  }

  return (
    /^(\d+(?:\.\d+)+)\s+\S/.test(text) ||
    /^(appendix|references)\b/i.test(text)
  );
}

function isTextBlock(block: unknown): block is TextBlock {
  return Boolean(
    block &&
    typeof block === 'object' &&
    'type' in block &&
    (((block as { type?: string }).type === 'paragraph') || (block as { type?: string }).type === 'heading')
  );
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function hasBounds(bounds: unknown): bounds is PDFImageBounds {
  return Boolean(
    bounds &&
    typeof bounds === 'object' &&
    ['minX', 'minY', 'maxX', 'maxY'].every((key) =>
      typeof (bounds as Record<string, unknown>)[key] === 'number' &&
      Number.isFinite((bounds as Record<string, unknown>)[key] as number)
    )
  );
}

function mergeBounds(boundsList: PDFImageBounds[]): PDFImageBounds {
  return boundsList.reduce(
    (merged, bounds) => ({
      minX: Math.min(merged.minX, bounds.minX),
      minY: Math.min(merged.minY, bounds.minY),
      maxX: Math.max(merged.maxX, bounds.maxX),
      maxY: Math.max(merged.maxY, bounds.maxY)
    }),
    { ...boundsList[0] }
  );
}
