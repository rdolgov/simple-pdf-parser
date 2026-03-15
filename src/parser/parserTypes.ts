/**
 * Type definitions for the PDF parser module
 */

import type { Matrix } from './mathUtils.js';

/** Parsed PDF object with dictionary and optional stream */
export interface PDFRawObject {
  id: number;
  generation: number;
  dictionarySource: string;
  stream?: string;
  streamLength?: number;
  streamLengthRef?: ContentRef;
  raw: string;
  offset: number;
}

/** Indirect object reference (e.g., "5 0 R") */
export interface ContentRef {
  id: number;
  generation: number;
}

/** Font resource with encoding and width information */
export interface FontResource {
  toUnicodeMap?: Map<string, string>;
  encodingMap?: Map<number, string>;
  glyphWidths?: Map<number, number>;
  defaultWidth?: number;
  maxCodeLength: number;
  baseFontName?: string;
  cssFontFamily?: string;
  /** Font subtype (Type1, TrueType, Type0, Type3, etc.) */
  subtype?: string;
  /** Font matrix for Type3 fonts (glyph space to text space) */
  fontMatrix?: [number, number, number, number, number, number];
  /** Pre-parsed CharProc glyph paths for Type3 fonts, keyed by glyph name */
  charProcs?: Map<string, import('../types.js').Type3Glyph>;
  /** For Type3 fonts: maps character code → raw glyph name from /Differences */
  glyphNameMap?: Map<number, string>;
}

/** Map of font name to FontResource */
export type FontMap = Map<string, FontResource>;

/** Image resource metadata and decode parameters */
export interface ImageResource {
  object: PDFRawObject;
  width?: number;
  height?: number;
  bitsPerComponent?: number;
  colorSpace?: string;
  indexedColorSpace?: {
    base: string;
    highValue: number;
    lookup: Uint8Array;
  };
  filters: string[];
  imageMask?: boolean;
  decodeParms?: Record<string, number | boolean>;
  decode?: number[];
  softMask?: ContentRef;
}

/** Map of image name to ImageResource */
export type ImageMap = Map<string, ImageResource>;

/** Resource context for a page (fonts, forms, images) */
export interface ResourceContext {
  fonts: FontMap;
  forms: Map<string, PDFRawObject>;
  images: ImageMap;
}

/** Parse context (alias for ResourceContext) */
export interface ParseContext {
  fonts: FontMap;
  forms: Map<string, PDFRawObject>;
  images: ImageMap;
}

/** Stream length as literal number or indirect reference */
export type StreamLengthInfo =
  | { kind: 'number'; value: number }
  | { kind: 'ref'; id: number; generation: number };

/** Cross-reference table entry */
export interface XRefEntry {
  objectNumber: number;
  generation: number;
  offset: number;
  inUse: boolean;
  /** For type-2 entries: the object number of the ObjStm containing this object */
  containingObjStm?: number;
  /** For type-2 entries: the index of this object within the ObjStm */
  indexInObjStm?: number;
}

/** Text rendering state machine */
export interface TextState {
  textMatrix: Matrix;
  textLineMatrix: Matrix;
  font?: string;
  fontSize: number;
  leading: number;
  charSpacing: number;
  wordSpacing: number;
  horizontalScale: number;
  textRise: number;
}

/** Name token wrapper */
export type PDFNameValue = { kind: 'name'; value: string };

/** Operator value type (number, string, name, or array) */
export type PDFOperatorValue = number | string | PDFNameValue | PDFOperatorValue[];
