import type { AnnotatedHtmlDocumentLayout, AnnotatedHtmlContentBlock } from 'pdf-layout-parser';

export function filterLayoutForPdfFocus(
  layout: AnnotatedHtmlDocumentLayout
): { layout: AnnotatedHtmlDocumentLayout; hiddenPageCount: number } {
  const relevantPages = layout.pages.filter((page) => page.content.some(hasHighlightBlock));
  const hiddenPageCount = layout.pages.length - relevantPages.length;
  if (relevantPages.length === 0) {
    return { layout: { ...layout, pages: [] }, hiddenPageCount: layout.pages.length };
  }
  if (hiddenPageCount <= 0) {
    return { layout, hiddenPageCount: 0 };
  }
  return {
    layout: {
      ...layout,
      pages: relevantPages.map((page) => ({
        ...page,
        content: page.content.map((block) => ({ ...block }))
      }))
    },
    hiddenPageCount
  };
}

export function hasHighlightBlock(block: AnnotatedHtmlContentBlock): boolean {
  return block.relevance?.state === 'highlight';
}
