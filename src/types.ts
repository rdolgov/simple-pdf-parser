export interface Vector2D {
  x: number;
  y: number;
}

/** A single path command for page-level vector graphics */
export type PDFPathCommand =
  | { op: 'M'; x: number; y: number }
  | { op: 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x3: number; y3: number }
  | { op: 'Z' };

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
export interface Type3GlyphImageLayer {
  bounds: PDFImageBounds;
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

export interface Type3Glyph {
  glyphName: string;
  pathCommands: Type3PathCommand[];
  width: number;
  imageLayers?: Type3GlyphImageLayer[];
}

export interface PDFGlyphSpan {
  text: string;
  advance: number;
  glyphCode?: number;
  /** True when the span was synthesized during text-run smoothing rather than decoded from the PDF. */
  synthetic?: boolean;
}

export interface PDFEmbeddedFontDescriptor {
  ascent?: number;
  descent?: number;
  capHeight?: number;
  italicAngle?: number;
  flags?: number;
  stemV?: number;
  bbox?: [number, number, number, number];
}

export interface PDFEmbeddedFontResource {
  fontKey: string;
  objectKey: string;
  baseFontName?: string;
  subtype?: string;
  /** Optional named base encoding from the PDF font dictionary or font program. */
  baseEncoding?: string;
  /** Optional code -> glyph-name overrides from the PDF font dictionary. */
  glyphNames?: Record<number, string>;
  fontFileKey?: string;
  fontFileKind?: 'FontFile' | 'FontFile2' | 'FontFile3';
  fontFileSubtype?: string;
  data: Uint8Array;
  glyphWidths?: Record<number, number>;
  defaultWidth?: number;
  descriptor?: PDFEmbeddedFontDescriptor;
}

export interface PDFTextItem {
  text: string;
  bounds: PDFImageBounds;
  font?: string;
  fontResourceKey?: string;
  fontSize?: number;
  /** Effective user-space font size after the PDF text matrix is applied. */
  renderFontSize?: number;
  /** Raw PDF text rendering mode (`Tr`), used to suppress invisible text layers during rendering. */
  textRenderMode?: number;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  /** Original PDF content-stream order, used for faithful paint-order rendering. */
  paintOrder?: number;
  /** Raw PDF Tz text horizontal scale, used by exact glyph renderers. */
  textHorizontalScale?: number;
  /** Baseline start point in page coordinates, used for rotated text rendering */
  baselineStart?: Vector2D;
  /** Baseline end point in page coordinates, used for rotated text rendering */
  baselineEnd?: Vector2D;
  /** Optional per-glyph advances preserved from the PDF text-showing operators */
  glyphSpans?: PDFGlyphSpan[];
  /** For Type3 fonts: per-character glyph path data for canvas rendering */
  type3Glyphs?: Type3Glyph[];
  /** For Type3 fonts: the font matrix [a b c d e f] */
  fontMatrix?: [number, number, number, number, number, number];
  clipPaths?: PDFClipPath[];
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
  clipPaths?: PDFClipPath[];
  mask?: {
    width: number;
    height: number;
    data: Uint8Array;
    blackIs1: boolean;
  };
  softMaskPixels?: {
    width: number;
    height: number;
    data: Uint8ClampedArray;
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

export type PDFPathFillRule = 'nonzero' | 'evenodd';
export type PDFLineCapStyle = 'butt' | 'round' | 'square';
export type PDFLineJoinStyle = 'miter' | 'round' | 'bevel';

export interface PDFClipPath {
  commands: PDFPathCommand[];
  fillRule: PDFPathFillRule;
}

/** A general vector path extracted from PDF graphics */
export interface PDFPathItem {
  commands: PDFPathCommand[];
  lineWidth: number;
  strokeColor: [number, number, number, number] | null;
  fillColor: [number, number, number, number] | null;
  fillRule: PDFPathFillRule;
  lineCap: PDFLineCapStyle;
  lineJoin: PDFLineJoinStyle;
  miterLimit: number;
  clipPaths?: PDFClipPath[];
}

export interface PDFPage {
  number: number;
  /** PDF-faithful text items used for visual rendering. */
  displayTextItems?: PDFTextItem[];
  /** Semantic text items used for search, selection, and HTML/layout reconstruction. */
  textItems: PDFTextItem[];
  imageItems: PDFImageItem[];
  lineItems: PDFLineItem[];
  rectItems: PDFRectItem[];
  pathItems?: PDFPathItem[];
  size: PDFPageSize;
}

export interface PDFLayout {
  pages: PDFPage[];
  fontResources?: Record<string, PDFEmbeddedFontResource>;
}

export interface ParseProgressUpdate {
  page: PDFPage;
  pageNumber: number;
  totalPages: number;
  fontResources?: Record<string, PDFEmbeddedFontResource>;
}

export interface ParseOptions {
  strict?: boolean;
  smoothText?: boolean;
  onPageParsed?: (update: ParseProgressUpdate) => void;
}

export type ParseSource = ArrayBuffer | Uint8Array | string;
