import type { PDFTextItem } from '../types.js';
import { looksLikeTableCellToken } from '../common/tabularTokenHeuristics.js';
import { resolveTextItemRenderFontSize } from '../common/textItemFontSize.js';
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
  const fontSize = resolveTextItemRenderFontSize(item);

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

  if (fontSize > 0 && fontSize <= 8.5) {
    return exactEmbeddedGlyphs
      ? { minScaleY: 0.7, maxScaleY: 1.12 }
      : { minScaleY: 0.82, maxScaleY: 1.08 };
  }

  return { minScaleY: 1, maxScaleY: 1 };
}

export function shouldUseParsedVerticalFit(
  item: PDFTextItem,
  embeddedFont: RegisteredEmbeddedFont | undefined
): boolean {
  if (isStretchyMathDelimiter(item) || isStretchyMathOperator(item)) {
    return true;
  }

  if (isDisplayCmexOperator(item)) {
    return true;
  }

  const fontSize = resolveTextItemRenderFontSize(item);
  if (fontSize > 0 && fontSize <= 8.5) {
    return true;
  }

  return embeddedFont?.renderMode === 'glyph-span' && fontSize > 0 && fontSize <= 10;
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

export function resolveParsedHeightScale(
  item: PDFTextItem,
  embeddedFont: RegisteredEmbeddedFont | undefined
): number {
  const fontSize = resolveTextItemRenderFontSize(item);
  if (!(fontSize > 0) || fontSize > 7.5) {
    return 1;
  }

  const compactText = item.text.replace(/\s+/g, '');
  if (compactText.length === 0 || compactText.length > 2) {
    return 1;
  }

  const isComputerModernScript = /^(cm|lasy|line10)/i.test(item.font ?? '');
  if (isComputerModernScript && embeddedFont?.renderMode === 'glyph-span') {
    return 0.76;
  }

  if (isComputerModernScript) {
    return 0.8;
  }

  if (!isLikelyCompactScriptToken(item, compactText)) {
    return 1;
  }

  return 0.82;
}

export function resolvePlainTextScaleX(rawScaleX: number, item: PDFTextItem): number {
  if (looksLikeTableCellToken(item.text)) {
    return 1;
  }

  return rawScaleX;
}

function isLikelyCompactScriptToken(item: PDFTextItem, compactText: string): boolean {
  const normalizedFont = (item.font ?? '').toLowerCase();
  const isMathLikeFont =
    /^(cm|lasy|line10)/.test(normalizedFont) ||
    /math|symbol|stix|cambria math|euclid|mtmi|cmsy|cmex|cmmi|cmbsy/.test(normalizedFont);
  if (isMathLikeFont) {
    return true;
  }

  if (/^\d+$/.test(compactText)) {
    return true;
  }

  return compactText.length === 1 && /^[A-Za-z]$/.test(compactText);
}
