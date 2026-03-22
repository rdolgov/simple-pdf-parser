import type { PDFImageBounds, PDFTextItem, Vector2D } from '../types.js';

const DEFAULT_FONT_SIZE = 12;
const SUSPICIOUS_RAW_FONT_SIZE = 2;
const SUSPICIOUS_SCALE_RATIO = 1.5;

type FontSizedTextItem = Pick<PDFTextItem, 'bounds' | 'fontSize' | 'renderFontSize' | 'baselineStart' | 'baselineEnd'>;

export function resolveTextItemRenderFontSize(item: FontSizedTextItem): number {
  const explicit = readPositiveNumber(item.renderFontSize);
  if (explicit !== undefined) {
    return explicit;
  }

  const raw = readPositiveNumber(item.fontSize);
  const estimated = estimateTextItemVisualFontSize(item.bounds, item.baselineStart, item.baselineEnd);
  if (raw !== undefined) {
    if (
      estimated !== undefined &&
      raw <= SUSPICIOUS_RAW_FONT_SIZE &&
      estimated >= raw * SUSPICIOUS_SCALE_RATIO
    ) {
      return estimated;
    }
    return raw;
  }

  return estimated ?? DEFAULT_FONT_SIZE;
}

export function estimateTextItemVisualFontSize(
  bounds: PDFImageBounds,
  baselineStart?: Vector2D,
  baselineEnd?: Vector2D
): number | undefined {
  if (baselineStart && baselineEnd) {
    const baselineDx = baselineEnd.x - baselineStart.x;
    const baselineDy = baselineEnd.y - baselineStart.y;
    const baselineLength = Math.hypot(baselineDx, baselineDy);
    if (baselineLength > 0.001) {
      const normalX = -baselineDy / baselineLength;
      const normalY = baselineDx / baselineLength;
      const corners = [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.minX, y: bounds.maxY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY }
      ];
      const projections = corners.map((corner) => corner.x * normalX + corner.y * normalY);
      const extent = Math.max(...projections) - Math.min(...projections);
      if (Number.isFinite(extent) && extent > 0) {
        return extent;
      }
    }
  }

  const height = Math.abs(bounds.maxY - bounds.minY);
  return Number.isFinite(height) && height > 0 ? height : undefined;
}

function readPositiveNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}
