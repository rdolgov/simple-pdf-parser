import { mergeTextRuns } from '../parser/textSmoother.js';
import { resolveTextItemRenderFontSize } from '../common/textItemFontSize.js';
import type {
  PDFImageBounds,
  PDFImageItem,
  PDFLayout,
  PDFPage,
  PDFTextItem
} from '../types.js';

export interface HtmlTextSpan {
  text: string;
  bounds: PDFImageBounds;
  font?: string;
  fontSize?: number;
}

export interface HtmlLine {
  text: string;
  spans: HtmlTextSpan[];
  bounds: PDFImageBounds;
  baseline: number;
  lineHeight: number;
}

interface HtmlBlockBase {
  bounds: PDFImageBounds;
  confidence: number;
}

interface HtmlTextBlockBase extends HtmlBlockBase {
  text: string;
  lines: HtmlLine[];
  spans: HtmlTextSpan[];
}

export interface HtmlParagraphBlock extends HtmlTextBlockBase {
  type: 'paragraph';
}

export interface HtmlHeadingBlock extends HtmlTextBlockBase {
  type: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface HtmlTableCell {
  text: string;
  spans: HtmlTextSpan[];
  bounds: PDFImageBounds;
}

export interface HtmlTableRow {
  cells: HtmlTableCell[];
  bounds: PDFImageBounds;
}

export interface HtmlTableBlock extends HtmlBlockBase {
  type: 'table';
  rows: HtmlTableRow[];
  columnCount: number;
}

export interface HtmlImageBlock extends HtmlBlockBase {
  type: 'image';
  image: PDFImageItem;
}

export type HtmlContentBlock = HtmlParagraphBlock | HtmlHeadingBlock | HtmlTableBlock | HtmlImageBlock;

export interface HtmlPageLayout {
  number: number;
  width: number;
  height: number;
  content: HtmlContentBlock[];
}

export interface HtmlDocumentLayout {
  pages: HtmlPageLayout[];
}

export interface HtmlLayoutConverterOptions {
  lineMergeTolerance?: number;
  paragraphSpacingMultiplier?: number;
  indentTolerance?: number;
  spaceGapMultiplier?: number;
  tableColumnGapThreshold?: number;
  tableAlignmentTolerance?: number;
  tableMinRows?: number;
  tableMinColumns?: number;
  headingFontRatioLevel1?: number;
  headingFontRatioLevel2?: number;
  headingFontRatioLevel3?: number;
}

const DEFAULT_OPTIONS: Required<HtmlLayoutConverterOptions> = {
  lineMergeTolerance: 2,
  paragraphSpacingMultiplier: 1.8,
  indentTolerance: 18,
  spaceGapMultiplier: 0.25,
  tableColumnGapThreshold: 40,
  tableAlignmentTolerance: 18,
  tableMinRows: 2,
  tableMinColumns: 2,
  headingFontRatioLevel1: 1.6,
  headingFontRatioLevel2: 1.35,
  headingFontRatioLevel3: 1.15
};

interface PageFontStats {
  average: number;
  median: number;
}

type InternalLine = HtmlLine;

interface TableDetectionResult {
  block: HtmlTableBlock;
  nextIndex: number;
}

export function convertLayoutToHtml(
  layout: PDFLayout,
  options: HtmlLayoutConverterOptions = {}
): HtmlDocumentLayout {
  const config = { ...DEFAULT_OPTIONS, ...options };

  return {
    pages: layout.pages.map((page) => convertPage(page, config))
  };
}

function convertPage(page: PDFPage, config: Required<HtmlLayoutConverterOptions>): HtmlPageLayout {
  const fontStats = computeFontStats(page.textItems);
  const textItems = normalizeTextItems(page.textItems);
  const lines = groupIntoLines(textItems, config);
  const blocks = buildBlocksFromLines(lines, page, fontStats, config);
  const images = page.imageItems.map<HtmlImageBlock>((image) => ({
    type: 'image',
    image,
    bounds: cloneBounds(image.bounds),
    confidence: 0.9
  }));

  const orderedContent = mergeAndOrderBlocks(blocks, images);

  return {
    number: page.number,
    width: page.size.width,
    height: page.size.height,
    content: orderedContent
  };
}

function normalizeTextItems(textItems: PDFTextItem[]): PDFTextItem[] {
  const sorted = [...textItems].sort((a, b) => {
    const byY = compareNumbers(b.bounds.minY, a.bounds.minY);
    if (byY !== 0) {
      return byY;
    }
    return compareNumbers(a.bounds.minX, b.bounds.minX);
  });
  return mergeTextRuns(sorted);
}

function computeFontStats(items: PDFTextItem[]): PageFontStats {
  const sizes = items
    .map((item) => normalizedFontSize(item))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (sizes.length === 0) {
    return { average: 12, median: 12 };
  }

  const average = sizes.reduce((sum, size) => sum + size, 0) / sizes.length;
  const median =
    sizes.length % 2 === 0
      ? (sizes[sizes.length / 2 - 1] + sizes[sizes.length / 2]) / 2
      : sizes[Math.floor(sizes.length / 2)];

  return { average, median };
}

function groupIntoLines(
  items: PDFTextItem[],
  config: Required<HtmlLayoutConverterOptions>
): InternalLine[] {
  const lines: InternalLine[] = [];

  for (const item of items) {
    const span = createSpan(item);
    const baseline = computeBaseline(item);
    const targetLine = findOrCreateLine(lines, baseline, config.lineMergeTolerance);
    targetLine.spans.push(span);
  }

  for (const line of lines) {
    line.spans.sort((a, b) => compareNumbers(a.bounds.minX, b.bounds.minX));
    const bounds = mergeBounds(line.spans.map((span) => span.bounds));
    line.bounds = bounds;
    line.lineHeight = Math.max(bounds.maxY - bounds.minY, 1);
    line.text = concatenateSpans(line.spans, config.spaceGapMultiplier);
  }

  lines.sort((a, b) => compareNumbers(b.baseline, a.baseline));
  return lines;
}

function findOrCreateLine(
  lines: InternalLine[],
  baseline: number,
  tolerance: number
): InternalLine {
  for (const existing of lines) {
    if (Math.abs(existing.baseline - baseline) <= tolerance) {
      return existing;
    }
  }

  const newLine: InternalLine = {
    text: '',
    spans: [],
    bounds: createEmptyBounds(),
    baseline,
    lineHeight: 1
  };
  lines.push(newLine);
  return newLine;
}

function buildBlocksFromLines(
  lines: InternalLine[],
  page: PDFPage,
  fontStats: PageFontStats,
  config: Required<HtmlLayoutConverterOptions>
): HtmlContentBlock[] {
  const blocks: HtmlContentBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line || isLineEmpty(line)) {
      index += 1;
      continue;
    }

    const tableResult = detectTable(lines, index, config);
    if (tableResult) {
      blocks.push(tableResult.block);
      index = tableResult.nextIndex;
      continue;
    }

    const paragraphResult = collectParagraph(lines, index, fontStats, config);
    blocks.push(paragraphResult.block);
    index = paragraphResult.nextIndex;
  }

  return blocks;
}

function detectTable(
  lines: InternalLine[],
  startIndex: number,
  config: Required<HtmlLayoutConverterOptions>
): TableDetectionResult | undefined {
  const seed = lines[startIndex];
  if (!seed || !isTabularLine(seed, config)) {
    return undefined;
  }

  const anchors = seed.spans.map((span) => ({
    minX: span.bounds.minX,
    maxX: span.bounds.maxX
  }));

  const rows: HtmlTableRow[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (!isTabularLine(line, config)) {
      break;
    }

    if (!matchesAnchors(line, anchors, config.tableAlignmentTolerance)) {
      break;
    }

    rows.push(createTableRow(line));
    updateAnchors(line, anchors);
    index += 1;
  }

  if (rows.length < config.tableMinRows || anchors.length < config.tableMinColumns) {
    return undefined;
  }

  const block: HtmlTableBlock = {
    type: 'table',
    rows,
    columnCount: anchors.length,
    bounds: mergeBounds(rows.map((row) => row.bounds)),
    confidence: computeTableConfidence(rows.length, anchors.length)
  };

  return {
    block,
    nextIndex: startIndex + rows.length
  };
}

function collectParagraph(
  lines: InternalLine[],
  startIndex: number,
  fontStats: PageFontStats,
  config: Required<HtmlLayoutConverterOptions>
): { block: HtmlParagraphBlock | HtmlHeadingBlock; nextIndex: number } {
  const paragraphLines: InternalLine[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const current = lines[index];
    if (isLineEmpty(current)) {
      break;
    }

    if (paragraphLines.length > 0) {
      const previous = paragraphLines[paragraphLines.length - 1];
      if (shouldBreakParagraph(previous, current, config)) {
        break;
      }
    }

    paragraphLines.push(current);
    index += 1;
  }

  const mergedBounds = mergeBounds(paragraphLines.map((line) => line.bounds));
  const text = paragraphLines.map((line) => line.text.trim()).join(' ');
  const spans = paragraphLines.flatMap((line) => line.spans);
  const averageFont = spans.reduce((sum, span) => sum + (span.fontSize ?? estimateSpanFontSize(span)), 0);
  const fontAverage = spans.length > 0 ? averageFont / spans.length : fontStats.average;

  const headingLevel = detectHeadingLevel(paragraphLines, fontAverage, fontStats, config);
  if (headingLevel) {
    const block: HtmlHeadingBlock = {
      type: 'heading',
      level: headingLevel,
      text,
      lines: paragraphLines,
      spans,
      bounds: mergedBounds,
      confidence: 0.6 + 0.1 * (6 - headingLevel)
    };
    return { block, nextIndex: index };
  }

  const block: HtmlParagraphBlock = {
    type: 'paragraph',
    text,
    lines: paragraphLines,
    spans,
    bounds: mergedBounds,
    confidence: 0.5
  };

  return { block, nextIndex: index };
}

function shouldBreakParagraph(
  previous: InternalLine,
  current: InternalLine,
  config: Required<HtmlLayoutConverterOptions>
): boolean {
  const baselineGap = previous.baseline - current.baseline;
  const referenceHeight = Math.max(previous.lineHeight, current.lineHeight);

  if (baselineGap > referenceHeight * config.paragraphSpacingMultiplier) {
    return true;
  }

  const indentDelta = Math.abs(previous.bounds.minX - current.bounds.minX);
  if (indentDelta > config.indentTolerance && baselineGap > referenceHeight * 0.5) {
    return true;
  }

  const currentStartsWithListMarker = /^[•·\-–—]\s+/.test(current.text.trim());
  const previousStartsWithListMarker = /^[•·\-–—]\s+/.test(previous.text.trim());

  if (currentStartsWithListMarker && !previousStartsWithListMarker) {
    return true;
  }

  return false;
}

function detectHeadingLevel(
  lines: InternalLine[],
  paragraphAverageFont: number,
  fontStats: PageFontStats,
  config: Required<HtmlLayoutConverterOptions>
): HtmlHeadingBlock['level'] | undefined {
  if (lines.length > 2) {
    return undefined;
  }

  const sizeRatio = paragraphAverageFont / (fontStats.median || fontStats.average || 12);
  if (sizeRatio >= config.headingFontRatioLevel1) {
    return 1;
  }
  if (sizeRatio >= config.headingFontRatioLevel2) {
    return 2;
  }
  if (sizeRatio >= config.headingFontRatioLevel3) {
    return 3;
  }

  return undefined;
}

function isTabularLine(line: InternalLine, config: Required<HtmlLayoutConverterOptions>): boolean {
  if (line.spans.length < config.tableMinColumns) {
    return false;
  }

  let largeGaps = 0;
  for (let i = 1; i < line.spans.length; i += 1) {
    const gap = line.spans[i].bounds.minX - line.spans[i - 1].bounds.maxX;
    if (gap >= config.tableColumnGapThreshold) {
      largeGaps += 1;
    }
  }

  return largeGaps >= 1;
}

function matchesAnchors(
  line: InternalLine,
  anchors: Array<{ minX: number; maxX: number }>,
  tolerance: number
): boolean {
  if (line.spans.length !== anchors.length) {
    return false;
  }

  for (let index = 0; index < anchors.length; index += 1) {
    const span = line.spans[index];
    const anchor = anchors[index];
    const delta = Math.abs(span.bounds.minX - anchor.minX);

    if (delta > tolerance) {
      return false;
    }
  }

  return true;
}

function createTableRow(line: InternalLine): HtmlTableRow {
  const cells: HtmlTableCell[] = line.spans.map((span) => ({
    text: span.text.trim(),
    spans: [span],
    bounds: cloneBounds(span.bounds)
  }));

  return {
    cells,
    bounds: cloneBounds(line.bounds)
  };
}

function updateAnchors(
  line: InternalLine,
  anchors: Array<{ minX: number; maxX: number }>
): void {
  for (let index = 0; index < anchors.length && index < line.spans.length; index += 1) {
    const span = line.spans[index];
    const anchor = anchors[index];
    anchor.minX = (anchor.minX * 0.7) + (span.bounds.minX * 0.3);
    anchor.maxX = (anchor.maxX * 0.7) + (span.bounds.maxX * 0.3);
  }
}

function computeTableConfidence(rows: number, columns: number): number {
  const base = 0.6;
  const rowFactor = Math.min(rows / 6, 1);
  const columnFactor = Math.min(columns / 5, 1);
  return Math.min(base + 0.2 * rowFactor + 0.1 * columnFactor, 0.95);
}

function createSpan(item: PDFTextItem): HtmlTextSpan {
  return {
    text: item.text,
    bounds: cloneBounds(item.bounds),
    font: item.font,
    fontSize: normalizedFontSize(item)
  };
}

function concatenateSpans(spans: HtmlTextSpan[], spaceGapMultiplier: number): string {
  if (spans.length === 0) {
    return '';
  }

  let result = spans[0].text;

  for (let index = 1; index < spans.length; index += 1) {
    const previous = spans[index - 1];
    const current = spans[index];
    const gap = current.bounds.minX - previous.bounds.maxX;
    const reference = Math.max(previous.bounds.maxY - previous.bounds.minY, 1);
    const threshold = Math.max(reference * spaceGapMultiplier, 0.5);
    const requiresSpace = gap >= threshold;

    if (requiresSpace && !/\s$/.test(result) && !/^\s/.test(current.text)) {
      result += ' ';
    }

    result += current.text;
  }

  return result;
}

function mergeBounds(boundsList: PDFImageBounds[]): PDFImageBounds {
  if (boundsList.length === 0) {
    return createEmptyBounds();
  }

  return boundsList.reduce(
    (acc, bounds) => ({
      minX: Math.min(acc.minX, bounds.minX),
      minY: Math.min(acc.minY, bounds.minY),
      maxX: Math.max(acc.maxX, bounds.maxX),
      maxY: Math.max(acc.maxY, bounds.maxY)
    }),
    { ...boundsList[0] }
  );
}

function createEmptyBounds(): PDFImageBounds {
  return { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY };
}

function cloneBounds(bounds: PDFImageBounds): PDFImageBounds {
  return { minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY };
}

function computeBaseline(item: PDFTextItem): number {
  return Math.min(item.bounds.minY, item.bounds.maxY);
}

function estimateFontSize(item: PDFTextItem): number {
  const height = Math.abs(item.bounds.maxY - item.bounds.minY);
  return height > 0 ? height : 12;
}

function estimateSpanFontSize(span: HtmlTextSpan): number {
  const height = Math.abs(span.bounds.maxY - span.bounds.minY);
  return height > 0 ? height : 12;
}

function normalizedFontSize(item: PDFTextItem): number {
  const MIN_FONT_SIZE = 6;
  const estimated = estimateFontSize(item);
  const raw = resolveTextItemRenderFontSize(item);

  if (item.fontSize !== undefined && item.fontSize > 0 && item.fontSize < MIN_FONT_SIZE) {
    if (estimated >= MIN_FONT_SIZE) {
      return estimated;
    }
    return MIN_FONT_SIZE;
  }

  const candidate = Number.isFinite(raw) && raw > 0 ? raw : estimated;
  return Math.max(candidate || MIN_FONT_SIZE, MIN_FONT_SIZE);
}

function isLineEmpty(line: InternalLine): boolean {
  return line.text.trim().length === 0;
}

function compareNumbers(a: number, b: number): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function mergeAndOrderBlocks(
  textBlocks: HtmlContentBlock[],
  imageBlocks: HtmlImageBlock[]
): HtmlContentBlock[] {
  const combined = [...textBlocks, ...imageBlocks];
  combined.sort((a, b) => {
    const byY = compareNumbers(b.bounds.minY, a.bounds.minY);
    if (byY !== 0) {
      return byY;
    }
    return compareNumbers(a.bounds.minX, b.bounds.minX);
  });
  return combined;
}
