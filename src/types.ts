export interface Vector2D {
  x: number;
  y: number;
}

/** A single path command for Type3 glyph rendering */
export type Type3PathCommand =
  | { op: 'M'; x: number; y: number }
  | { op: 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x3: number; y3: number }
  | { op: 'Z' }
  | { op: 're'; x: number; y: number; w: number; h: number }
  | { op: 'f' }
  | { op: 'f*' }
  | { op: 'S' }
  | { op: 'B' }
  | { op: 'n' };

/** A Type3 glyph with pre-parsed path commands */
export interface Type3Glyph {
  glyphName: string;
  pathCommands: Type3PathCommand[];
  width: number;
}

export interface PDFTextItem {
  text: string;
  bounds: PDFImageBounds;
  font?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  /** For Type3 fonts: per-character glyph path data for canvas rendering */
  type3Glyphs?: Type3Glyph[];
  /** For Type3 fonts: the font matrix [a b c d e f] */
  fontMatrix?: [number, number, number, number, number, number];
}

export interface PDFPageSize {
  width: number;
  height: number;
}

export interface PDFImageBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PDFImageItem {
  name: string;
  bounds: PDFImageBounds;
  width?: number;
  height?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  mimeType?: string;
  dataUri?: string;
  fillColor?: [number, number, number, number];
  mask?: {
    width: number;
    height: number;
    data: Uint8Array;
    blackIs1: boolean;
  };
  pixels?: {
    width: number;
    height: number;
    data: Uint8ClampedArray;
    offsetX?: number;
    offsetY?: number;
    originalWidth?: number;
    originalHeight?: number;
  };
}

/** A line segment extracted from PDF graphics */
export interface PDFLineItem {
  /** Start point */
  start: Vector2D;
  /** End point */
  end: Vector2D;
  /** Line width in PDF points */
  lineWidth: number;
  /** Stroke color as [r, g, b, a] where each component is 0-1 */
  strokeColor: [number, number, number, number];
}

/** A rectangle extracted from PDF graphics */
export interface PDFRectItem {
  bounds: PDFImageBounds;
  /** Line width in PDF points (0 if no stroke) */
  lineWidth: number;
  /** Stroke color as [r, g, b, a] (null if no stroke) */
  strokeColor: [number, number, number, number] | null;
  /** Fill color as [r, g, b, a] (null if no fill) */
  fillColor: [number, number, number, number] | null;
}

export interface PDFPage {
  number: number;
  textItems: PDFTextItem[];
  imageItems: PDFImageItem[];
  lineItems: PDFLineItem[];
  rectItems: PDFRectItem[];
  size: PDFPageSize;
}

export interface PDFLayout {
  pages: PDFPage[];
}

export interface ParseOptions {
  strict?: boolean;
  smoothText?: boolean;
}

export type ParseSource = ArrayBuffer | Uint8Array | string;
