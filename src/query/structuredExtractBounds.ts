export type StructuredRelativeBoundsTuple = [number, number, number, number];

export interface StructuredBoundsCarrier {
  bbox?: unknown;
  bounding_box?: unknown;
}

const STACKED_Y_WRAP_THRESHOLD = 1.05;

export function readStructuredExtractRawBounds(value: unknown): StructuredRelativeBoundsTuple | null {
  let bounds: StructuredRelativeBoundsTuple | null = null;
  if (Array.isArray(value) && value.length === 4) {
    const numbers = value.map((item) => toFiniteNumber(item));
    if (!numbers.some((item) => item === null)) {
      const [x, y, w, h] = numbers as number[];
      bounds = [x, y, w, h];
    }
  } else if (value && typeof value === 'object') {
    const data = value as Record<string, unknown>;
    const x = toFiniteNumber(data.x);
    const y = toFiniteNumber(data.y);
    const width = toFiniteNumber(data.width);
    const height = toFiniteNumber(data.height);
    if (x !== null && y !== null && width !== null && height !== null) {
      bounds = [x, y, width, height];
    } else {
      const left = toFiniteNumber(data.left);
      const top = toFiniteNumber(data.top);
      const right = toFiniteNumber(data.right);
      const bottom = toFiniteNumber(data.bottom);
      if (left !== null && top !== null && right !== null && bottom !== null) {
        bounds = [left, top, right - left, bottom - top];
      }
    }
  }
  if (!bounds) {
    return null;
  }
  const [, , width, height] = bounds;
  if (width <= 0 || height <= 0) {
    return null;
  }
  return bounds;
}

export function detectStructuredExtractPageYBand(elements: StructuredBoundsCarrier[]): number {
  const bandCounts = new Map<number, number>();
  let total = 0;

  for (const element of elements) {
    const bounds = readStructuredExtractRawBounds(element.bbox ?? element.bounding_box);
    if (!bounds) {
      continue;
    }
    total += 1;
    const band = bounds[1] >= STACKED_Y_WRAP_THRESHOLD ? Math.floor(bounds[1]) : 0;
    bandCounts.set(band, (bandCounts.get(band) ?? 0) + 1);
  }

  if (total === 0) {
    return 0;
  }

  let dominantBand = 0;
  let dominantCount = 0;
  for (const [band, count] of bandCounts.entries()) {
    if (count > dominantCount || (count === dominantCount && band > dominantBand)) {
      dominantBand = band;
      dominantCount = count;
    }
  }

  if (dominantBand <= 0) {
    return 0;
  }

  return dominantCount >= Math.ceil(total / 2) ? dominantBand : 0;
}

export function normalizeStructuredExtractRatioBounds(
  rawBounds: StructuredRelativeBoundsTuple,
  pageYBand = 0
): StructuredRelativeBoundsTuple | null {
  let [x, y, width, height] = rawBounds;

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  x = clampUnitPosition(x);
  y = unwrapStackedY(y, pageYBand);
  width = clampUnitSize(width);
  height = clampUnitSize(height);

  if (width <= 0 || height <= 0) {
    return null;
  }

  if (x + width > 1) {
    width = Math.max(0, 1 - x);
  }
  if (y + height > 1) {
    height = Math.max(0, 1 - y);
  }

  if (width <= 0 || height <= 0) {
    return null;
  }

  return [x, y, width, height];
}

export function toPdfBoundsFromNormalizedRatioBounds(
  ratioBounds: StructuredRelativeBoundsTuple,
  pageWidth: number,
  pageHeight: number
): StructuredRelativeBoundsTuple {
  const [x, y, width, height] = ratioBounds;
  const minX = x * pageWidth;
  const maxX = Math.min(1, x + width) * pageWidth;
  const minY = Math.max(0, 1 - y - height) * pageHeight;
  const maxY = Math.min(1, Math.max(0, 1 - y)) * pageHeight;
  return [minX, minY, maxX, maxY];
}

function unwrapStackedY(y: number, pageYBand: number): number {
  if (y <= 0) {
    return 0;
  }
  if (pageYBand > 0 && y >= pageYBand) {
    return clampUnitPosition(y - pageYBand);
  }
  if (y >= STACKED_Y_WRAP_THRESHOLD) {
    return clampUnitPosition(y - Math.floor(y));
  }
  return clampUnitPosition(y);
}

function clampUnitPosition(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function clampUnitSize(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function toFiniteNumber(value: unknown): number | null {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(numberValue) ? numberValue : null;
}
