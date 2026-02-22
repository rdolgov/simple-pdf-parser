import type { PDFDocument } from 'pdf-layout-parser';

export interface PageFocusData {
  pageNumber: number;
  hasMatches: boolean;
  textItemStates: Map<number, 'highlight' | 'dim' | 'normal'>;
}

export interface FocusOverlayData {
  pagesWithMatches: Set<number>;
  pageData: Map<number, PageFocusData>;
}

/**
 * Processes the focus state layout to determine which pages have matches
 * and which text items should be highlighted or dimmed.
 */
export function processFocusOverlayData(
  document: PDFDocument,
  focusLayout: any
): FocusOverlayData {
  const pagesWithMatches = new Set<number>();
  const pageData = new Map<number, PageFocusData>();

  if (!focusLayout || !focusLayout.pages) {
    return { pagesWithMatches, pageData };
  }

  // Process each page in the focus layout
  for (const htmlPage of focusLayout.pages) {
    const pageNumber = htmlPage.pageNumber;
    const textItemStates = new Map<number, 'highlight' | 'dim' | 'normal'>();
    let pageHasMatches = false;

    // Check all blocks on this page for relevance state
    for (const block of htmlPage.content) {
      if (block.relevance?.state === 'highlight') {
        pageHasMatches = true;

        // Mark text items in this block as highlighted
        if (block.type === 'paragraph' || block.type === 'heading') {
          for (const line of block.lines || []) {
            for (const textItem of line.items || []) {
              if (textItem.originalIndex !== undefined) {
                textItemStates.set(textItem.originalIndex, 'highlight');
              }
            }
          }
        }
      } else if (block.relevance?.state === 'dim' || block.relevance?.state === 'hidden') {
        // Mark text items in this block as dimmed
        if (block.type === 'paragraph' || block.type === 'heading') {
          for (const line of block.lines || []) {
            for (const textItem of line.items || []) {
              if (textItem.originalIndex !== undefined && !textItemStates.has(textItem.originalIndex)) {
                textItemStates.set(textItem.originalIndex, 'dim');
              }
            }
          }
        }
      }
    }

    if (pageHasMatches) {
      pagesWithMatches.add(pageNumber);
    }

    pageData.set(pageNumber, {
      pageNumber,
      hasMatches: pageHasMatches,
      textItemStates
    });
  }

  return { pagesWithMatches, pageData };
}
