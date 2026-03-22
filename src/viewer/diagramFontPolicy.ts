import type { PDFEmbeddedFontResource } from '../types.js';

const SEMANTIC_DIAGRAM_FONT_PATTERN = /^LINEW?\d+$/i;

export function isSemanticDiagramFontName(fontName: string | undefined): boolean {
  return typeof fontName === 'string' && SEMANTIC_DIAGRAM_FONT_PATTERN.test(fontName.trim());
}

export function shouldPreferType1COutlineRendering(resource: PDFEmbeddedFontResource): boolean {
  return isSemanticDiagramFontName(resource.baseFontName);
}
