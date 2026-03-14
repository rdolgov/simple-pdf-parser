import type {
  HtmlHeadingBlock,
  HtmlLine,
  HtmlParagraphBlock,
  PDFImageBounds
} from 'pdf-layout-parser';

type TextBlock = HtmlParagraphBlock | HtmlHeadingBlock;

type SelectionPoint = {
  x: number;
  y: number;
};

type LineMetrics = {
  index: number;
  line: HtmlLine;
  fontSize: number;
  width: number;
  height: number;
  isOutlier: boolean;
};

const MIN_FONT_RATIO = 0.86;
const MAX_FONT_RATIO = 1.16;
const MIN_PRIMARY_LINE_WIDTH = 24;

export function refineTextBlockForSelection<T extends TextBlock>(block: T, point: SelectionPoint): T {
  if (!Array.isArray(block.lines) || block.lines.length < 2) {
    return block;
  }

  const metrics = block.lines.map((line, index) => buildLineMetrics(line, index));
  const anchor = findAnchorLine(metrics, point);
  if (!anchor) {
    return block;
  }

  if (anchor.isOutlier) {
    return rebuildBlock(block, [anchor.line]);
  }

  const compatible = metrics.filter((metric) => isCompatibleWithAnchor(anchor, metric));
  const selectedLines = findAnchorCluster(compatible, anchor);
  if (selectedLines.length === 0 || selectedLines.length === block.lines.length) {
    return block;
  }

  return rebuildBlock(block, selectedLines);
}

function buildLineMetrics(line: HtmlLine, index: number): LineMetrics {
  const height = line.bounds.maxY - line.bounds.minY;
  const width = line.bounds.maxX - line.bounds.minX;
  const fontSize = estimateLineFontSize(line, height);
  return {
    index,
    line,
    fontSize,
    width,
    height,
    isOutlier: isOutlierLine(width, height, fontSize)
  };
}

function estimateLineFontSize(line: HtmlLine, fallbackHeight: number): number {
  const sizes = line.spans
    .map((span) => span.fontSize)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);

  if (sizes.length === 0) {
    return Math.max(line.lineHeight, fallbackHeight, 1);
  }

  const total = sizes.reduce((sum, value) => sum + value, 0);
  return total / sizes.length;
}

function isOutlierLine(width: number, height: number, fontSize: number): boolean {
  if (height <= 0 || fontSize <= 0) {
    return false;
  }

  return height > Math.max(fontSize * 3, width * 2, 48);
}

function findAnchorLine(metrics: LineMetrics[], point: SelectionPoint): LineMetrics | null {
  const directHit = metrics.find((metric) => isPointInBounds(metric.line.bounds, point.x, point.y));
  if (directHit) {
    return directHit;
  }

  let best: LineMetrics | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const metric of metrics) {
    const distance = distanceToBounds(metric.line.bounds, point.x, point.y);
    if (distance < bestDistance) {
      best = metric;
      bestDistance = distance;
    }
  }
  return best;
}

function isCompatibleWithAnchor(anchor: LineMetrics, candidate: LineMetrics): boolean {
  if (candidate.isOutlier) {
    return false;
  }

  if (!hasCompatibleFontSize(anchor, candidate)) {
    return false;
  }

  if (!hasCompatibleColumn(anchor, candidate)) {
    return false;
  }

  if (anchor.width >= 120 && candidate.width < Math.max(anchor.width * 0.2, MIN_PRIMARY_LINE_WIDTH)) {
    return false;
  }

  return true;
}

function hasCompatibleFontSize(anchor: LineMetrics, candidate: LineMetrics): boolean {
  const ratio = candidate.fontSize / Math.max(anchor.fontSize, 1);
  return ratio >= MIN_FONT_RATIO && ratio <= MAX_FONT_RATIO;
}

function hasCompatibleColumn(anchor: LineMetrics, candidate: LineMetrics): boolean {
  const minXDelta = Math.abs(anchor.line.bounds.minX - candidate.line.bounds.minX);
  if (minXDelta <= Math.max(anchor.fontSize * 2.5, 28)) {
    return true;
  }

  const overlap = horizontalOverlap(anchor.line.bounds, candidate.line.bounds);
  return overlap >= Math.min(anchor.width, candidate.width) * 0.5;
}

function horizontalOverlap(left: PDFImageBounds, right: PDFImageBounds): number {
  return Math.max(0, Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX));
}

function findAnchorCluster(metrics: LineMetrics[], anchor: LineMetrics): HtmlLine[] {
  if (metrics.length === 0) {
    return [];
  }

  const clusters: LineMetrics[][] = [];
  let currentCluster: LineMetrics[] = [];
  for (const metric of metrics) {
    if (currentCluster.length === 0 || isSameCluster(currentCluster[currentCluster.length - 1], metric, anchor)) {
      currentCluster.push(metric);
      continue;
    }

    clusters.push(currentCluster);
    currentCluster = [metric];
  }

  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  const anchorCluster = clusters.find((cluster) => cluster.some((metric) => metric.index === anchor.index));
  return (anchorCluster ?? [anchor]).map((metric) => metric.line);
}

function isSameCluster(previous: LineMetrics, current: LineMetrics, anchor: LineMetrics): boolean {
  const gap = previous.line.bounds.minY - current.line.bounds.maxY;
  return gap <= Math.max(anchor.fontSize * 1.1, previous.fontSize, current.fontSize, 14);
}

function rebuildBlock<T extends TextBlock>(block: T, lines: HtmlLine[]): T {
  const spans = lines.flatMap((line) => line.spans);
  return {
    ...block,
    text: lines.map((line) => line.text.trim()).join(' ').trim(),
    lines,
    spans,
    bounds: mergeBounds(lines.map((line) => line.bounds))
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

function isPointInBounds(bounds: PDFImageBounds, x: number, y: number): boolean {
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
}

function distanceToBounds(bounds: PDFImageBounds, x: number, y: number): number {
  const dx = x < bounds.minX ? bounds.minX - x : x > bounds.maxX ? x - bounds.maxX : 0;
  const dy = y < bounds.minY ? bounds.minY - y : y > bounds.maxY ? y - bounds.maxY : 0;
  return Math.hypot(dx, dy);
}
