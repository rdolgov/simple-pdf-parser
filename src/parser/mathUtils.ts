import type { PDFImageBounds, PDFImageItem, PDFTextItem, Vector2D } from '../types.js';
import { transformClipPaths } from './clipPathUtils.js';

export type Matrix = [number, number, number, number, number, number];

export const identityMatrix = (): Matrix => [1, 0, 0, 1, 0, 0];

export const cloneMatrix = (matrix: Matrix): Matrix =>
  [matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]];

export const multiplyMatrices = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5]
];

export const transformPoint = (matrix: Matrix, x: number, y: number): Vector2D => ({
  x: matrix[0] * x + matrix[2] * y + matrix[4],
  y: matrix[1] * x + matrix[3] * y + matrix[5]
});

export const computeImageBounds = (matrix: Matrix): PDFImageBounds => {
  const corners = [
    transformPoint(matrix, 0, 0),
    transformPoint(matrix, 1, 0),
    transformPoint(matrix, 0, 1),
    transformPoint(matrix, 1, 1)
  ];

  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);

  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys)
  };
};

export const transformImageItem = (item: PDFImageItem, matrix: Matrix): PDFImageItem => {
  const transformedBounds = transformBounds(item.bounds, matrix);
  return {
    ...item,
    bounds: transformedBounds,
    clipPaths: transformClipPaths(item.clipPaths, matrix)
  };
};

export const transformBounds = (bounds: PDFImageBounds, matrix: Matrix): PDFImageBounds => {
  const corners = [
    transformPoint(matrix, bounds.minX, bounds.minY),
    transformPoint(matrix, bounds.minX, bounds.maxY),
    transformPoint(matrix, bounds.maxX, bounds.minY),
    transformPoint(matrix, bounds.maxX, bounds.maxY)
  ];

  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);

  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys)
  };
};

export const mergeBounds = (a: PDFImageBounds, b: PDFImageBounds): PDFImageBounds => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY)
});

export const expandTextBounds = (item: PDFTextItem, extraWidth: number): PDFImageBounds => ({
  minX: item.bounds.minX,
  minY: item.bounds.minY,
  maxX: item.bounds.maxX + extraWidth,
  maxY: item.bounds.maxY
});
