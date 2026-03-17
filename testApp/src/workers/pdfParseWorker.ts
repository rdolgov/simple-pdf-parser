/// <reference lib="webworker" />

import {
  PDFParser,
  type PDFEmbeddedFontResource,
  type PDFPage
} from 'pdf-layout-parser';

import type { PdfParseWorkerRequest, PdfParseWorkerResponse } from './pdfParseProtocol';

const workerScope = self as DedicatedWorkerGlobalScope;
const INITIAL_PAGE_BATCH_SIZE = 5;
const FOLLOW_UP_PAGE_BATCH_SIZE = 5;

workerScope.onmessage = (event: MessageEvent<PdfParseWorkerRequest>) => {
  const message = event.data;
  if (message.type !== 'parse-document') {
    return;
  }

  try {
    let totalPages = 0;
    let pagesSinceFlush = 0;
    let didSendCompleteBatch = false;
    const pendingPages: PDFPage[] = [];
    let pendingFontResources: Record<string, PDFEmbeddedFontResource> = {};

    const flushBatch = (complete: boolean) => {
      if (pendingPages.length === 0 && !complete) {
        return;
      }

      const pages = pendingPages.splice(0, pendingPages.length);
      const fontResources =
        Object.keys(pendingFontResources).length > 0 ? pendingFontResources : undefined;
      pendingFontResources = {};
      pagesSinceFlush = 0;
      didSendCompleteBatch = complete;

      postWorkerMessage({
        type: 'parsed-page-batch',
        pages,
        fontResources,
        totalPages,
        complete
      });
    };

    const parser = new PDFParser({
      onPageParsed: ({ page, pageNumber, totalPages: reportedTotalPages, fontResources }) => {
        totalPages = reportedTotalPages;
        pendingPages.push(page);
        pagesSinceFlush += 1;

        if (fontResources) {
          pendingFontResources = {
            ...pendingFontResources,
            ...fontResources
          };
        }

        const batchSize =
          pageNumber <= INITIAL_PAGE_BATCH_SIZE ? 1 : FOLLOW_UP_PAGE_BATCH_SIZE;
        const shouldFlush =
          pageNumber <= INITIAL_PAGE_BATCH_SIZE ||
          pagesSinceFlush >= batchSize ||
          pageNumber === reportedTotalPages;

        if (shouldFlush) {
          flushBatch(pageNumber === reportedTotalPages);
        }
      }
    });

    const layout = parser.parse(message.pdfData);
    if (!didSendCompleteBatch) {
      totalPages = layout.pages.length;
      flushBatch(true);
    }
  } catch (error) {
    postWorkerMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unable to parse PDF.'
    });
  }
};

function postWorkerMessage(message: PdfParseWorkerResponse): void {
  workerScope.postMessage(message);
}
