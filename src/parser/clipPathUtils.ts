import type { PDFClipPath } from '../types.js';
import type { Matrix } from './mathUtils.js';

export const cloneClipPath = (clipPath: PDFClipPath): PDFClipPath => ({
  commands: clipPath.commands.map((command) => ({ ...command })),
  fillRule: clipPath.fillRule
});

export const cloneClipPaths = (clipPaths?: PDFClipPath[]): PDFClipPath[] | undefined =>
  clipPaths?.map((clipPath) => cloneClipPath(clipPath));

export const transformClipPath = (clipPath: PDFClipPath, matrix: Matrix): PDFClipPath => ({
  fillRule: clipPath.fillRule,
  commands: clipPath.commands.map((command) => {
    switch (command.op) {
      case 'M':
      case 'L': {
        const point = transformClipPoint(matrix, command.x, command.y);
        return { op: command.op, x: point.x, y: point.y };
      }
      case 'C': {
        const p1 = transformClipPoint(matrix, command.x1, command.y1);
        const p2 = transformClipPoint(matrix, command.x2, command.y2);
        const p3 = transformClipPoint(matrix, command.x3, command.y3);
        return {
          op: 'C',
          x1: p1.x,
          y1: p1.y,
          x2: p2.x,
          y2: p2.y,
          x3: p3.x,
          y3: p3.y
        };
      }
      case 'Z':
        return command;
    }
  })
});

export const transformClipPaths = (clipPaths: PDFClipPath[] | undefined, matrix: Matrix): PDFClipPath[] | undefined =>
  clipPaths?.map((clipPath) => transformClipPath(clipPath, matrix));

function transformClipPoint(matrix: Matrix, x: number, y: number): { x: number; y: number } {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5]
  };
}
