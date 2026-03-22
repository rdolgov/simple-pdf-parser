import type {
  PDFLineCapStyle,
  PDFLineJoinStyle,
  PDFPathCommand,
  PDFPathItem,
  Vector2D
} from '../types.js';
import type { Matrix } from './mathUtils.js';
import { transformPoint } from './mathUtils.js';
import { cloneClipPaths } from './clipPathUtils.js';
import { transformClipPaths } from './clipPathUtils.js';

export const buildRectanglePathCommands = (x: number, y: number, w: number, h: number): PDFPathCommand[] => [
  { op: 'M', x, y },
  { op: 'L', x: x + w, y },
  { op: 'L', x: x + w, y: y + h },
  { op: 'L', x, y: y + h },
  { op: 'Z' }
];

export const clonePathCommands = (commands: PDFPathCommand[]): PDFPathCommand[] =>
  commands.map((command) => ({ ...command }));

export const closePathCommands = (
  commands: PDFPathCommand[],
  currentPoint: Vector2D | null,
  subpathStart: Vector2D | null
): { commands: PDFPathCommand[]; currentPoint: Vector2D | null } => {
  if (!subpathStart || !currentPoint) {
    return { commands, currentPoint };
  }

  const lastCommand = commands[commands.length - 1];
  if (lastCommand?.op === 'Z') {
    return { commands, currentPoint: { ...subpathStart } };
  }

  return {
    commands: [...commands, { op: 'Z' }],
    currentPoint: { ...subpathStart }
  };
};

export const mapPdfLineCap = (value: number | undefined): PDFLineCapStyle => {
  switch (value) {
    case 1:
      return 'round';
    case 2:
      return 'square';
    default:
      return 'butt';
  }
};

export const mapPdfLineJoin = (value: number | undefined): PDFLineJoinStyle => {
  switch (value) {
    case 1:
      return 'round';
    case 2:
      return 'bevel';
    default:
      return 'miter';
  }
};

export const transformPathItem = (
  item: PDFPathItem,
  matrix: Matrix,
  options: { transformClipPaths?: boolean } = {}
): PDFPathItem => ({
  ...item,
  commands: item.commands.map((command) => {
    switch (command.op) {
      case 'M':
      case 'L': {
        const point = transformPoint(matrix, command.x, command.y);
        return { op: command.op, x: point.x, y: point.y };
      }
      case 'C': {
        const p1 = transformPoint(matrix, command.x1, command.y1);
        const p2 = transformPoint(matrix, command.x2, command.y2);
        const p3 = transformPoint(matrix, command.x3, command.y3);
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
  }),
  lineWidth: transformStrokeWidth(item.lineWidth, matrix),
  clipPaths: options.transformClipPaths === false ? cloneClipPaths(item.clipPaths) : transformClipPaths(item.clipPaths, matrix)
});

export const transformStrokeWidth = (lineWidth: number, matrix: Matrix): number => {
  if (!(lineWidth > 0)) {
    return lineWidth;
  }

  const scaleX = Math.hypot(matrix[0], matrix[1]);
  const scaleY = Math.hypot(matrix[2], matrix[3]);
  const scale = scaleX > 0 && scaleY > 0 ? (scaleX + scaleY) / 2 : scaleX || scaleY || 1;
  return lineWidth * scale;
};
