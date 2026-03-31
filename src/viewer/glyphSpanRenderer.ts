import type { PDFGlyphSpan, PDFTextItem } from '../types.js';
import { resolveTextItemRenderFontSize } from '../common/textItemFontSize.js';

export interface RenderableGlyphSpanRun {
  spans: PDFGlyphSpan[];
  totalAdvance: number;
}

export function resolveRenderableGlyphSpanRun(
  item: PDFTextItem,
  options: { force?: boolean } = {}
): RenderableGlyphSpanRun | undefined {
  const isComputerModernText = /^(cm|lasy|line10)/i.test(item.font ?? '');
  const isCompactNumericRun = resolveTextItemRenderFontSize(item) <= 7 && /^[0-9 ]+$/.test(item.text);
  const preservesMeaningfulPdfSpacing = hasMeaningfulPdfSpacingMismatch(item);
  if (!options.force && !isComputerModernText && !isCompactNumericRun && !preservesMeaningfulPdfSpacing) {
    return undefined;
  }

  if (!item.glyphSpans || item.glyphSpans.length === 0) {
    return undefined;
  }

  const spans = item.glyphSpans.filter((span) => Number.isFinite(span.advance) && span.advance > 0);
  if (spans.length === 0 || (!options.force && spans.length <= 1)) {
    return undefined;
  }

  const totalAdvance = spans.reduce((sum, span) => sum + span.advance, 0);
  if (!(totalAdvance > 0)) {
    return undefined;
  }

  return {
    spans,
    totalAdvance
  };
}

function hasMeaningfulPdfSpacingMismatch(item: PDFTextItem): boolean {
  if (!item.glyphSpans || item.glyphSpans.length <= 1) {
    return false;
  }

  const glyphText = item.glyphSpans.map((span) => span.text).join('');
  if (!glyphText || glyphText === item.text) {
    return false;
  }

  if (!/\s{2,}/.test(glyphText)) {
    return false;
  }

  return collapseWhitespace(glyphText) === collapseWhitespace(item.text);
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
