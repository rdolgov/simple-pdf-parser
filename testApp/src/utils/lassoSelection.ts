import type { AnnotationBounds } from '../storage/annotationStorage';

export interface LassoPoint {
  x: number;
  y: number;
}

export interface LassoBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LassoCaptureResult {
  bounds: LassoBounds;
  previewDataUri: string;
  compositeDataUri: string;
  mimeType: 'image/png';
}

const DEFAULT_MIN_POINT_DISTANCE = 5;
const DEFAULT_MIN_SELECTION_SIZE = 18;
const DEFAULT_CLOSE_DISTANCE = 18;
const CONTEXT_PADDING = 48;
const PANEL_WIDTH = 380;
const THUMBNAIL_WIDTH = 180;
const COMPOSITE_PADDING = 18;

export function simplifyLassoPoints(points: LassoPoint[], minDistance = DEFAULT_MIN_POINT_DISTANCE): LassoPoint[] {
  if (points.length <= 2) {
    return points.slice();
  }

  const simplified: LassoPoint[] = [points[0]];
  let previous = points[0];

  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    if (distanceBetween(previous, point) >= minDistance) {
      simplified.push(point);
      previous = point;
    }
  }

  const lastPoint = points[points.length - 1];
  if (!samePoint(previous, lastPoint)) {
    simplified.push(lastPoint);
  }

  return simplified;
}

export function getLassoBounds(points: LassoPoint[]): LassoBounds | null {
  if (points.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    left: minX,
    top: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY)
  };
}

export function isValidLassoBounds(bounds: LassoBounds | null, minimumSize = DEFAULT_MIN_SELECTION_SIZE): bounds is LassoBounds {
  return Boolean(bounds && bounds.width >= minimumSize && bounds.height >= minimumSize);
}

export function isLassoLoopClosed(points: LassoPoint[], closeDistance = DEFAULT_CLOSE_DISTANCE): boolean {
  if (points.length < 3) {
    return false;
  }
  return distanceBetween(points[0], points[points.length - 1]) <= closeDistance;
}

export function closeLassoLoop(points: LassoPoint[], closeDistance = DEFAULT_CLOSE_DISTANCE): LassoPoint[] {
  if (points.length < 3) {
    return points.slice();
  }

  const closed = points.slice();
  if (isLassoLoopClosed(closed, closeDistance)) {
    closed[closed.length - 1] = { ...closed[0] };
    return closed;
  }

  closed.push({ ...closed[0] });
  return closed;
}

export function lassoPathToSvg(points: LassoPoint[], options?: { closed?: boolean }): string {
  if (points.length === 0) {
    return '';
  }

  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ') + (options?.closed === false ? '' : ' Z');
}

export function canvasBoundsToPdfBounds(
  bounds: LassoBounds,
  pageHeight: number,
  zoom: number,
  pagePadding: number
): AnnotationBounds {
  const minX = Math.max(0, bounds.left / zoom - pagePadding);
  const maxX = Math.max(minX, (bounds.left + bounds.width) / zoom - pagePadding);
  const maxY = Math.max(0, pageHeight - (bounds.top / zoom - pagePadding));
  const minY = Math.max(0, pageHeight - ((bounds.top + bounds.height) / zoom - pagePadding));

  return {
    minX,
    minY: Math.min(minY, maxY),
    maxX,
    maxY: Math.max(minY, maxY)
  };
}

export function captureLassoSelectionFromCanvas(payload: {
  canvas: HTMLCanvasElement;
  points: LassoPoint[];
}): LassoCaptureResult | null {
  const simplifiedPoints = closeLassoLoop(simplifyLassoPoints(payload.points));
  const bounds = getLassoBounds(simplifiedPoints);

  if (!isValidLassoBounds(bounds) || simplifiedPoints.length < 3) {
    return null;
  }

  const rect = payload.canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const sourceScaleX = payload.canvas.width / rect.width;
  const sourceScaleY = payload.canvas.height / rect.height;
  const outputScale = Math.min(2, Math.max(sourceScaleX, sourceScaleY, 1));

  const previewCanvas = createMaskedCropCanvas(payload.canvas, simplifiedPoints, bounds, sourceScaleX, sourceScaleY, outputScale);
  const contextBounds = expandBounds(bounds, CONTEXT_PADDING, rect.width, rect.height);
  const contextCanvas = createContextCanvas(payload.canvas, simplifiedPoints, bounds, contextBounds, sourceScaleX, sourceScaleY, outputScale);
  const thumbnailCanvas = createThumbnailCanvas(payload.canvas, simplifiedPoints, bounds, outputScale);
  const compositeCanvas = composeSelectionPanels(previewCanvas, contextCanvas, thumbnailCanvas);

  return {
    bounds,
    previewDataUri: previewCanvas.toDataURL('image/png'),
    compositeDataUri: compositeCanvas.toDataURL('image/png'),
    mimeType: 'image/png'
  };
}

function createMaskedCropCanvas(
  sourceCanvas: HTMLCanvasElement,
  points: LassoPoint[],
  bounds: LassoBounds,
  sourceScaleX: number,
  sourceScaleY: number,
  outputScale: number
): HTMLCanvasElement {
  const cropWidth = Math.max(1, Math.ceil(bounds.width * outputScale));
  const cropHeight = Math.max(1, Math.ceil(bounds.height * outputScale));
  const target = document.createElement('canvas');
  target.width = cropWidth;
  target.height = cropHeight;
  const context = target.getContext('2d');
  if (!context) {
    return target;
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, cropWidth, cropHeight);
  context.save();
  drawPath(
    context,
    points.map((point) => ({
      x: (point.x - bounds.left) * outputScale,
      y: (point.y - bounds.top) * outputScale
    }))
  );
  context.clip();
  context.drawImage(
    sourceCanvas,
    bounds.left * sourceScaleX,
    bounds.top * sourceScaleY,
    bounds.width * sourceScaleX,
    bounds.height * sourceScaleY,
    0,
    0,
    cropWidth,
    cropHeight
  );
  context.restore();
  context.strokeStyle = 'rgba(15, 23, 42, 0.35)';
  context.lineWidth = Math.max(1.5, outputScale);
  drawPath(
    context,
    points.map((point) => ({
      x: (point.x - bounds.left) * outputScale,
      y: (point.y - bounds.top) * outputScale
    }))
  );
  context.stroke();

  return target;
}

function createContextCanvas(
  sourceCanvas: HTMLCanvasElement,
  points: LassoPoint[],
  selectionBounds: LassoBounds,
  contextBounds: LassoBounds,
  sourceScaleX: number,
  sourceScaleY: number,
  outputScale: number
): HTMLCanvasElement {
  const targetWidth = Math.max(1, Math.ceil(contextBounds.width * outputScale));
  const targetHeight = Math.max(1, Math.ceil(contextBounds.height * outputScale));
  const target = document.createElement('canvas');
  target.width = targetWidth;
  target.height = targetHeight;
  const context = target.getContext('2d');
  if (!context) {
    return target;
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(
    sourceCanvas,
    contextBounds.left * sourceScaleX,
    contextBounds.top * sourceScaleY,
    contextBounds.width * sourceScaleX,
    contextBounds.height * sourceScaleY,
    0,
    0,
    targetWidth,
    targetHeight
  );

  const relativePoints = points.map((point) => ({
    x: (point.x - contextBounds.left) * outputScale,
    y: (point.y - contextBounds.top) * outputScale
  }));
  context.fillStyle = 'rgba(37, 99, 235, 0.12)';
  context.strokeStyle = 'rgba(29, 78, 216, 0.9)';
  context.lineWidth = Math.max(1.25, outputScale);
  drawPath(context, relativePoints);
  context.fill();
  context.stroke();

  context.strokeStyle = 'rgba(15, 23, 42, 0.22)';
  context.lineWidth = Math.max(1, outputScale * 0.75);
  context.strokeRect(
    (selectionBounds.left - contextBounds.left) * outputScale,
    (selectionBounds.top - contextBounds.top) * outputScale,
    selectionBounds.width * outputScale,
    selectionBounds.height * outputScale
  );

  return target;
}

function createThumbnailCanvas(
  sourceCanvas: HTMLCanvasElement,
  points: LassoPoint[],
  bounds: LassoBounds,
  outputScale: number
): HTMLCanvasElement {
  const aspectRatio = sourceCanvas.height / Math.max(sourceCanvas.width, 1);
  const width = Math.max(1, Math.round(THUMBNAIL_WIDTH * outputScale));
  const height = Math.max(1, Math.round(width * aspectRatio));
  const target = document.createElement('canvas');
  target.width = width;
  target.height = height;
  const context = target.getContext('2d');
  if (!context) {
    return target;
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, width, height);

  const scaleX = width / Math.max(sourceCanvas.getBoundingClientRect().width, 1);
  const scaleY = height / Math.max(sourceCanvas.getBoundingClientRect().height, 1);
  context.fillStyle = 'rgba(37, 99, 235, 0.12)';
  context.strokeStyle = 'rgba(29, 78, 216, 0.95)';
  context.lineWidth = Math.max(1.25, outputScale * 0.9);
  drawPath(
    context,
    points.map((point) => ({
      x: point.x * scaleX,
      y: point.y * scaleY
    }))
  );
  context.fill();
  context.stroke();
  context.strokeStyle = 'rgba(15, 23, 42, 0.18)';
  context.strokeRect(bounds.left * scaleX, bounds.top * scaleY, bounds.width * scaleX, bounds.height * scaleY);

  return target;
}

function composeSelectionPanels(
  previewCanvas: HTMLCanvasElement,
  contextCanvas: HTMLCanvasElement,
  thumbnailCanvas: HTMLCanvasElement
): HTMLCanvasElement {
  const previewScale = PANEL_WIDTH / Math.max(previewCanvas.width, 1);
  const contextScale = PANEL_WIDTH / Math.max(contextCanvas.width, 1);
  const scaledPreviewHeight = Math.max(1, Math.round(previewCanvas.height * previewScale));
  const scaledContextHeight = Math.max(1, Math.round(contextCanvas.height * contextScale));
  const contentWidth = Math.max(
    PANEL_WIDTH,
    Math.round(thumbnailCanvas.width),
    1
  );
  const totalHeight =
    COMPOSITE_PADDING +
    22 +
    scaledPreviewHeight +
    18 +
    22 +
    scaledContextHeight +
    18 +
    22 +
    thumbnailCanvas.height +
    COMPOSITE_PADDING;

  const target = document.createElement('canvas');
  target.width = contentWidth + COMPOSITE_PADDING * 2;
  target.height = totalHeight;
  const context = target.getContext('2d');
  if (!context) {
    return target;
  }

  context.fillStyle = '#f8fafc';
  context.fillRect(0, 0, target.width, target.height);

  let top = COMPOSITE_PADDING;
  top = drawLabeledPanel(context, 'Selected region', previewCanvas, COMPOSITE_PADDING, top, PANEL_WIDTH, scaledPreviewHeight);
  top += 18;
  top = drawLabeledPanel(context, 'Nearby page context', contextCanvas, COMPOSITE_PADDING, top, PANEL_WIDTH, scaledContextHeight);
  top += 18;
  drawLabeledPanel(
    context,
    'Full page thumbnail',
    thumbnailCanvas,
    COMPOSITE_PADDING,
    top,
    thumbnailCanvas.width,
    thumbnailCanvas.height
  );

  return target;
}

function drawLabeledPanel(
  context: CanvasRenderingContext2D,
  label: string,
  source: HTMLCanvasElement,
  left: number,
  top: number,
  width: number,
  height: number
): number {
  context.fillStyle = '#0f172a';
  context.font = '600 16px system-ui, sans-serif';
  context.fillText(label, left, top + 15);

  const panelTop = top + 22;
  context.fillStyle = '#ffffff';
  context.fillRect(left, panelTop, width, height);
  context.shadowColor = 'rgba(15, 23, 42, 0.08)';
  context.shadowBlur = 10;
  context.shadowOffsetY = 4;
  context.drawImage(source, 0, 0, source.width, source.height, left, panelTop, width, height);
  context.shadowColor = 'transparent';
  context.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  context.lineWidth = 1;
  context.strokeRect(left + 0.5, panelTop + 0.5, width - 1, height - 1);

  return panelTop + height;
}

function drawPath(context: CanvasRenderingContext2D, points: LassoPoint[]): void {
  if (points.length === 0) {
    return;
  }

  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.closePath();
}

function expandBounds(bounds: LassoBounds, padding: number, maxWidth: number, maxHeight: number): LassoBounds {
  const left = Math.max(0, bounds.left - padding);
  const top = Math.max(0, bounds.top - padding);
  const right = Math.min(maxWidth, bounds.left + bounds.width + padding);
  const bottom = Math.min(maxHeight, bounds.top + bounds.height + padding);

  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

function distanceBetween(left: LassoPoint, right: LassoPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function samePoint(left: LassoPoint, right: LassoPoint): boolean {
  return left.x === right.x && left.y === right.y;
}
