import type { PDFGlyphSpan, PDFTextItem } from '../types.js';

export interface RenderableGlyphSpanRun {
  spans: PDFGlyphSpan[];
  totalAdvance: number;
}

export function resolveRenderableGlyphSpanRun(
  item: PDFTextItem,
  options: { force?: boolean } = {}
): RenderableGlyphSpanRun | undefined {
  const isComputerModernText = /^(cm|lasy|line10)/i.test(item.font ?? '');
  const isCompactNumericRun = (item.fontSize ?? 0) <= 7 && /^[0-9 ]+$/.test(item.text);
  if (!options.force && !isComputerModernText && !isCompactNumericRun) {
    return undefined;
  }

  if (!item.glyphSpans || item.glyphSpans.length === 0) {
    return undefined;
  }

  const spans = item.glyphSpans.filter((span) => span.text.length > 0 && Number.isFinite(span.advance) && span.advance > 0);
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
