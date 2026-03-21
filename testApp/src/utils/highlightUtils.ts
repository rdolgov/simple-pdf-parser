import type {
  HtmlContentBlock,
  HtmlHeadingBlock,
  HtmlPageLayout,
  HtmlParagraphBlock,
  HtmlTableBlock,
  PDFImageBounds,
  PDFPage
} from 'pdf-layout-parser';
import type { ExtractedTable } from '../types';

export interface HighlightLineData {
  text: string;
  bounds?: PDFImageBounds;
  lineHeight?: number;
  spans?: HighlightSpanData[];
}

export interface HighlightBlockData {
  bounds: PDFImageBounds;
  lines: HighlightLineData[];
  fontFamily?: string;
  fontSize?: number;
}

export interface HighlightSpanData {
  text: string;
  bounds?: PDFImageBounds;
}

export type TableDetectionSource = 'layout-bounds' | 'cell-bounds' | 'ai';

export type TableDetectionResult = {
  block: HtmlTableBlock;
  source: TableDetectionSource;
};

export type ExtractTableHit = {
  bounds: PDFImageBounds;
  model: ExtractedTable;
};

export type TableAIDetector = (context: {
  page: HtmlPageLayout;
  x: number;
  y: number;
  tables: HtmlTableBlock[];
}) => HtmlTableBlock | null;

const TABLE_HIT_TOLERANCE = 6;
const EXTRACT_TABLE_HIT_TOLERANCE = 18;
const EXTRACT_TABLE_NEAR_HIT_TOLERANCE = 42;

export function hasBounds(bounds: any): bounds is PDFImageBounds {
  if (!bounds) {
    return false;
  }
  return ['minX', 'minY', 'maxX', 'maxY'].every((key) => typeof bounds[key] === 'number' && Number.isFinite(bounds[key]));
}

export function isPointInBounds(bounds: PDFImageBounds, x: number, y: number): boolean {
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
}

export function isPointNearBounds(bounds: PDFImageBounds, x: number, y: number, tolerance: number): boolean {
  return (
    x >= bounds.minX - tolerance &&
    x <= bounds.maxX + tolerance &&
    y >= bounds.minY - tolerance &&
    y <= bounds.maxY + tolerance
  );
}

export function boundsArea(bounds: PDFImageBounds): number {
  return Math.max(0, bounds.maxX - bounds.minX) * Math.max(0, bounds.maxY - bounds.minY);
}

export function buildHighlightBlockKey(pageNumber: number, bounds: PDFImageBounds): string {
  return `${pageNumber}-${bounds.minX.toFixed(3)}-${bounds.minY.toFixed(3)}-${bounds.maxX.toFixed(3)}-${bounds.maxY.toFixed(3)}`;
}

export function buildHighlightBlockData(block: any): HighlightBlockData | null {
  if (!hasBounds(block?.bounds)) {
    return null;
  }
  return {
    bounds: block.bounds,
    lines: extractHighlightLines(block),
    fontFamily: extractFontFamily(block),
    fontSize: extractFontSize(block)
  };
}

export function buildMergedTextHighlightBlockData(blocks: Array<HtmlParagraphBlock | HtmlHeadingBlock>): HighlightBlockData | null {
  const validBlocks = blocks.filter((block) => hasBounds(block?.bounds));
  if (validBlocks.length === 0) {
    return null;
  }

  const lines = validBlocks.flatMap((block) => extractHighlightLines(block));
  const fontFamilies = validBlocks
    .map((block) => extractFontFamily(block))
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const fontSizes = validBlocks
    .map((block) => extractFontSize(block))
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);

  return {
    bounds: mergeBounds(validBlocks.map((block) => block.bounds)),
    lines,
    fontFamily: fontFamilies[0],
    fontSize: fontSizes.length > 0 ? average(fontSizes) : undefined
  };
}

export function findParagraphBlockAtPoint(
  page: HtmlPageLayout,
  x: number,
  y: number
): HtmlParagraphBlock | HtmlHeadingBlock | null {
  let candidate: HtmlParagraphBlock | HtmlHeadingBlock | null = null;

  for (const block of page.content) {
    if (!isParagraphBlock(block) || !hasBounds(block.bounds)) {
      continue;
    }
    if (!isPointInBounds(block.bounds, x, y)) {
      continue;
    }
    if (!candidate) {
      candidate = block;
      continue;
    }
    const candidateArea = (candidate.bounds.maxX - candidate.bounds.minX) * (candidate.bounds.maxY - candidate.bounds.minY);
    const blockArea = (block.bounds.maxX - block.bounds.minX) * (block.bounds.maxY - block.bounds.minY);
    if (blockArea < candidateArea) {
      candidate = block;
    }
  }

  return candidate;
}

export function isParagraphBlock(block: HtmlContentBlock): block is HtmlParagraphBlock | HtmlHeadingBlock {
  return block.type === 'paragraph' || block.type === 'heading';
}

export function isTableBlock(block: HtmlContentBlock): block is HtmlTableBlock {
  return block.type === 'table';
}

export function detectTableAtPoint(
  page: HtmlPageLayout,
  x: number,
  y: number,
  aiDetector?: TableAIDetector
): TableDetectionResult | null {
  const tables = page.content.filter(isTableBlock).filter((table) => hasBounds(table.bounds));

  const inBounds = tables
    .filter((table) => isPointInBounds(table.bounds, x, y))
    .sort((left, right) => boundsArea(left.bounds) - boundsArea(right.bounds));

  if (inBounds.length > 0) {
    return { block: inBounds[0], source: 'layout-bounds' };
  }

  for (const table of tables) {
    for (const row of table.rows ?? []) {
      const rowBounds = hasBounds(row.bounds) ? row.bounds : null;
      if (!rowBounds) {
        continue;
      }
      if (isPointInBounds(rowBounds, x, y) || isPointNearBounds(rowBounds, x, y, TABLE_HIT_TOLERANCE)) {
        return { block: table, source: 'cell-bounds' };
      }
      for (const cell of row.cells ?? []) {
        const cellBounds = hasBounds(cell.bounds) ? cell.bounds : null;
        if (cellBounds && (isPointInBounds(cellBounds, x, y) || isPointNearBounds(cellBounds, x, y, TABLE_HIT_TOLERANCE))) {
          return { block: table, source: 'cell-bounds' };
        }
      }
    }
  }

  if (aiDetector) {
    const aiTable = aiDetector({ page, x, y, tables });
    if (aiTable && isTableBlock(aiTable) && hasBounds(aiTable.bounds)) {
      return { block: aiTable, source: 'ai' };
    }
  }

  return null;
}

export function detectExtractedTableAtPoint(payload: {
  tables: ExtractedTable[];
  page: PDFPage;
  x: number;
  y: number;
}): ExtractTableHit | null {
  const { tables, page, x, y } = payload;
  if (!tables || tables.length === 0) {
    return null;
  }
  console.debug('Detecting extracted table', {
    tableCount: tables.length,
    page: page.number,
    pageHeight: page.size.height,
    x,
    y
  });

  let bestDirectHit: ExtractTableHit | null = null;
  let bestDirectArea = Number.POSITIVE_INFINITY;
  let bestNearHit: ExtractTableHit | null = null;
  let bestNearDistance = Number.POSITIVE_INFINITY;
  let bestNearArea = Number.POSITIVE_INFINITY;

  for (const table of tables) {
    if (!table.bounds) {
      continue;
    }
    const tablePage = table.page ?? 0;
    const matchesPage = tablePage === page.number;
    if (!matchesPage) {
      continue;
    }
    const normalizedBounds = normalizeBounds(table.bounds);
    const { minX, maxX, minY, maxY } = normalizedBounds;
    const width = Math.max(0, maxX - minX);
    const height = Math.max(0, maxY - minY);
    const area = width * height;
    if (width <= 0 || height <= 0) {
      continue;
    }

    const adaptiveTolerance = Math.max(
      EXTRACT_TABLE_HIT_TOLERANCE,
      Math.min(32, Math.round(Math.min(width, height) * 0.08))
    );

    if (
      x >= minX - adaptiveTolerance &&
      x <= maxX + adaptiveTolerance &&
      y >= minY - adaptiveTolerance &&
      y <= maxY + adaptiveTolerance
    ) {
      console.debug('Table bounds match', { tableId: table.id, page: page.number, minX, maxX, minY, maxY, x, y });
      if (area < bestDirectArea) {
        bestDirectArea = area;
        bestDirectHit = {
          bounds: { minX, minY, maxX, maxY },
          model: table
        };
      }
      continue;
    }

    const nearDistance = distanceToBounds({ minX, minY, maxX, maxY }, x, y);
    if (nearDistance <= EXTRACT_TABLE_NEAR_HIT_TOLERANCE) {
      if (nearDistance < bestNearDistance || (nearDistance === bestNearDistance && area < bestNearArea)) {
        bestNearDistance = nearDistance;
        bestNearArea = area;
        bestNearHit = {
          bounds: { minX, minY, maxX, maxY },
          model: table
        };
      }
    }
  }

  if (bestDirectHit) {
    return bestDirectHit;
  }
  if (bestNearHit) {
    console.debug('Near table bounds fallback match', {
      tableId: bestNearHit.model.id,
      page: page.number,
      distance: bestNearDistance,
      x,
      y
    });
    return bestNearHit;
  }

  return null;
}

function normalizeBounds(bounds: PDFImageBounds): PDFImageBounds {
  return {
    minX: Math.min(bounds.minX, bounds.maxX),
    minY: Math.min(bounds.minY, bounds.maxY),
    maxX: Math.max(bounds.minX, bounds.maxX),
    maxY: Math.max(bounds.minY, bounds.maxY)
  };
}

function mergeBounds(boundsList: PDFImageBounds[]): PDFImageBounds {
  return boundsList.reduce(
    (merged, bounds) => ({
      minX: Math.min(merged.minX, bounds.minX),
      minY: Math.min(merged.minY, bounds.minY),
      maxX: Math.max(merged.maxX, bounds.maxX),
      maxY: Math.max(merged.maxY, bounds.maxY)
    }),
    {
      minX: boundsList[0]?.minX ?? 0,
      minY: boundsList[0]?.minY ?? 0,
      maxX: boundsList[0]?.maxX ?? 0,
      maxY: boundsList[0]?.maxY ?? 0
    }
  );
}

function distanceToBounds(bounds: PDFImageBounds, x: number, y: number): number {
  const dx = x < bounds.minX ? bounds.minX - x : x > bounds.maxX ? x - bounds.maxX : 0;
  const dy = y < bounds.minY ? bounds.minY - y : y > bounds.maxY ? y - bounds.maxY : 0;
  return Math.hypot(dx, dy);
}

export function getOverrideLineHeight(block: HighlightBlockData): number | undefined {
  if (typeof block.fontSize === 'number' && Number.isFinite(block.fontSize) && block.fontSize > 0) {
    return block.fontSize;
  }
  const lineCount = block.lines.length > 0 ? block.lines.length : 1;
  const blockHeight = block.bounds.maxY - block.bounds.minY;
  const averageLineHeight = blockHeight / lineCount;
  if (Number.isFinite(averageLineHeight) && averageLineHeight > 0) {
    return averageLineHeight;
  }
  return undefined;
}

function extractHighlightLines(block: any): HighlightLineData[] {
  if (block?.type === 'table') {
    return extractTableLines(block);
  }
  if (Array.isArray(block.lines) && block.lines.length > 0) {
    return block.lines.map((line: any) => ({
      text: deriveLineText(line),
      bounds: hasBounds(line.bounds) ? line.bounds : undefined,
      lineHeight: typeof line.lineHeight === 'number' ? line.lineHeight : undefined,
      spans: Array.isArray(line.spans)
        ? line.spans.map((span: any) => ({
            text: typeof span?.text === 'string' ? span.text : '',
            bounds: hasBounds(span?.bounds) ? span.bounds : undefined
          }))
        : undefined
    }));
  }
  if (typeof block.text === 'string' && block.text.length > 0) {
    return [
      {
        text: block.text,
        bounds: hasBounds(block.bounds) ? block.bounds : undefined
      }
    ];
  }
  return [];
}

function extractTableLines(block: HtmlTableBlock): HighlightLineData[] {
  if (!Array.isArray(block.rows) || block.rows.length === 0) {
    return hasBounds(block.bounds)
      ? [
          {
            text: '',
            bounds: block.bounds
          }
        ]
      : [];
  }
  return block.rows.map((row) => {
    const rowBounds = hasBounds(row.bounds) ? row.bounds : hasBounds(block.bounds) ? block.bounds : undefined;
    const rowText = Array.isArray(row.cells)
      ? row.cells
          .map((cell) => (typeof cell?.text === 'string' ? cell.text.trim() : ''))
          .filter((value) => value.length > 0)
          .join(' | ')
      : '';
    return {
      text: rowText.length > 0 ? rowText : ' ',
      bounds: rowBounds,
      lineHeight: rowBounds ? rowBounds.maxY - rowBounds.minY : undefined
    };
  });
}

function deriveLineText(line: any): string {
  if (typeof line?.text === 'string') {
    return line.text;
  }
  if (Array.isArray(line?.items)) {
    return line.items.map((item: any) => (typeof item?.text === 'string' ? item.text : '')).join('');
  }
  return '';
}

function extractFontFamily(block: any): string | undefined {
  const spans = gatherSpans(block);
  const fontSpan = spans.find((span) => typeof span?.font === 'string' && span.font.trim().length > 0);
  return fontSpan?.font;
}

function extractFontSize(block: any): number | undefined {
  const spans = gatherSpans(block);
  const sizeCandidates = spans
    .map((span) => span?.fontSize)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  if (sizeCandidates.length > 0) {
    return average(sizeCandidates);
  }
  if (Array.isArray(block.lines)) {
    const lineHeights = block.lines
      .map((line: any) => (typeof line?.lineHeight === 'number' ? line.lineHeight : undefined))
      .filter((value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
    if (lineHeights.length > 0) {
      return average(lineHeights) * 0.8;
    }
  }
  if (hasBounds(block.bounds)) {
    const height = block.bounds.maxY - block.bounds.minY;
    if (Number.isFinite(height) && height > 0) {
      return height * 0.3;
    }
  }
  return undefined;
}

function gatherSpans(block: any): Array<{ font?: string; fontSize?: number }> {
  if (block?.type === 'table' && Array.isArray(block?.rows)) {
    return block.rows.flatMap((row: any) =>
      Array.isArray(row?.cells)
        ? row.cells.flatMap((cell: any) => (Array.isArray(cell?.spans) ? cell.spans : []))
        : []
    );
  }
  if (Array.isArray(block?.spans) && block.spans.length > 0) {
    return block.spans;
  }
  if (!Array.isArray(block?.lines)) {
    return [];
  }
  return block.lines.flatMap((line: any) => (Array.isArray(line?.spans) ? line.spans : []));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}
