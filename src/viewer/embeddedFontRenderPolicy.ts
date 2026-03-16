import type { PDFTextItem } from '../types.js';
import { CMEX_DISPLAY_OPERATOR_CODES } from '../parser/parserConstants.js';
import type { RegisteredEmbeddedFont } from './embeddedFontRegistry.js';

export function isStretchyMathOperator(item: PDFTextItem): boolean {
  return /(cmsy|cmex)/i.test(item.font ?? '') && /[√∑∈∞∗∏∫⋃⋂⋁⋀]/.test(item.text);
}

export function isStretchyMathDelimiter(item: PDFTextItem): boolean {
  return /cmex/i.test(item.font ?? '') && /^[()[\]{}|]$/.test(item.text.trim());
}

export function isDisplayCmexOperator(item: PDFTextItem): boolean {
  if (!/cmex/i.test(item.font ?? '')) {
    return false;
  }

  if (item.glyphSpans?.length !== 1) {
    return false;
  }

  const glyphCode = item.glyphSpans[0]?.glyphCode;
  return (
    typeof glyphCode === 'number' &&
    CMEX_DISPLAY_OPERATOR_CODES.includes(glyphCode as (typeof CMEX_DISPLAY_OPERATOR_CODES)[number])
  );
}

export function resolveVerticalScaleBounds(
  item: PDFTextItem,
  embeddedFont: RegisteredEmbeddedFont | undefined
): { minScaleY: number; maxScaleY: number } {
  const exactEmbeddedGlyphs = embeddedFont?.renderMode === 'glyph-span';
  const stretchyDelimiter = isStretchyMathDelimiter(item);
  const displayOperator = isDisplayCmexOperator(item);

  if (stretchyDelimiter || displayOperator) {
    return exactEmbeddedGlyphs
      ? { minScaleY: 0.35, maxScaleY: 4.5 }
      : { minScaleY: 0.85, maxScaleY: 3.5 };
  }

  if (isStretchyMathOperator(item)) {
    return exactEmbeddedGlyphs
      ? { minScaleY: 0.55, maxScaleY: 2.25 }
      : { minScaleY: 0.85, maxScaleY: 1.15 };
  }

  return { minScaleY: 1, maxScaleY: 1 };
}

export function resolveGlyphScaleX(
  rawScaleX: number,
  item: PDFTextItem,
  spanCount: number,
  embeddedFont: RegisteredEmbeddedFont | undefined
): number {
  if (embeddedFont?.renderMode !== 'glyph-span') {
    return rawScaleX;
  }

  // Preserve exact font outlines for normal text runs, but let single-glyph
  // display operators and delimiters fit the PDF-provided width precisely.
  if (spanCount === 1 && (isStretchyMathDelimiter(item) || isStretchyMathOperator(item))) {
    return rawScaleX;
  }

  return Math.min(Math.max(rawScaleX, 0.9), 1.1);
}
