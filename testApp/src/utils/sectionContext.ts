import type { HtmlContentBlock, HtmlHeadingBlock, HtmlPageLayout, HtmlParagraphBlock, PDFImageBounds } from 'pdf-layout-parser';

type TextBlock = HtmlParagraphBlock | HtmlHeadingBlock;

export interface SectionContext {
  sectionHeading?: string;
  sectionText?: string;
}

export function buildSectionContext(
  page: HtmlPageLayout | null,
  selectedBlock: TextBlock | null
): SectionContext {
  if (!page || !selectedBlock) {
    return {};
  }

  const textBlocks = page.content.filter(isTextBlock);
  if (textBlocks.length === 0) {
    return {};
  }

  const blockIndex = findClosestTextBlockIndex(textBlocks, selectedBlock);
  if (blockIndex < 0) {
    return {};
  }

  const current = textBlocks[blockIndex];
  const headingIndex =
    current.type === 'heading'
      ? blockIndex
      : findNearestHeadingIndex(textBlocks, blockIndex);
  const sectionHeading =
    headingIndex >= 0 && textBlocks[headingIndex].type === 'heading'
      ? textBlocks[headingIndex].text.trim()
      : undefined;

  const sectionStart = headingIndex >= 0 ? headingIndex : blockIndex;
  let sectionEnd = textBlocks.length - 1;
  for (let index = blockIndex + 1; index < textBlocks.length; index += 1) {
    if (textBlocks[index].type === 'heading') {
      sectionEnd = index - 1;
      break;
    }
  }

  const sectionBlocks = textBlocks
    .slice(sectionStart, sectionEnd + 1)
    .filter((block) => block.text.trim().length > 0);
  const sectionText = trimSectionText(sectionBlocks.map((block) => block.text.trim()).join('\n\n'));

  return {
    sectionHeading,
    sectionText: sectionText.length > 0 ? sectionText : undefined
  };
}

function findClosestTextBlockIndex(blocks: TextBlock[], selectedBlock: TextBlock): number {
  const normalizedSelectedText = normalizeText(selectedBlock.text);
  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < blocks.length; index += 1) {
    const candidate = blocks[index];
    let score = 0;
    const normalizedCandidateText = normalizeText(candidate.text);

    if (normalizedCandidateText === normalizedSelectedText) {
      score += 1000;
    } else if (normalizedCandidateText.includes(normalizedSelectedText)) {
      score += 900;
    } else if (normalizedSelectedText.includes(normalizedCandidateText)) {
      score += 700;
    }

    score += overlapScore(candidate.bounds, selectedBlock.bounds) * 200;
    score -= centerDistance(candidate.bounds, selectedBlock.bounds) * 0.5;

    if (candidate.type === selectedBlock.type) {
      score += 20;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function findNearestHeadingIndex(blocks: TextBlock[], fromIndex: number): number {
  for (let index = fromIndex; index >= 0; index -= 1) {
    if (blocks[index].type === 'heading') {
      return index;
    }
  }
  return -1;
}

function overlapScore(left: PDFImageBounds, right: PDFImageBounds): number {
  const overlapWidth = Math.max(0, Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX));
  const overlapHeight = Math.max(0, Math.min(left.maxY, right.maxY) - Math.max(left.minY, right.minY));
  const overlapArea = overlapWidth * overlapHeight;
  if (overlapArea <= 0) {
    return 0;
  }
  const leftArea = Math.max((left.maxX - left.minX) * (left.maxY - left.minY), 1);
  const rightArea = Math.max((right.maxX - right.minX) * (right.maxY - right.minY), 1);
  return overlapArea / Math.min(leftArea, rightArea);
}

function centerDistance(left: PDFImageBounds, right: PDFImageBounds): number {
  const leftCenterX = (left.minX + left.maxX) / 2;
  const leftCenterY = (left.minY + left.maxY) / 2;
  const rightCenterX = (right.minX + right.maxX) / 2;
  const rightCenterY = (right.minY + right.maxY) / 2;
  return Math.hypot(leftCenterX - rightCenterX, leftCenterY - rightCenterY);
}

function trimSectionText(text: string): string {
  const collapsed = text.replace(/\n{3,}/g, '\n\n').trim();
  if (collapsed.length <= 1800) {
    return collapsed;
  }
  return `${collapsed.slice(0, 1797).trimEnd()}...`;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function isTextBlock(block: HtmlContentBlock): block is TextBlock {
  return block.type === 'paragraph' || block.type === 'heading';
}
