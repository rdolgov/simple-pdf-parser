import type { PDFEmbeddedFontResource } from 'pdf-layout-parser';

import type { SerializedPdfPage } from './pdfPageTransfer';

export type PdfParseWorkerRequest = {
  type: 'parse-document';
  pdfData: ArrayBuffer;
};

export type PdfParseWorkerResponse =
  | {
      type: 'parsed-page-batch';
      pages: SerializedPdfPage[];
      fontResources?: Record<string, PDFEmbeddedFontResource>;
      totalPages: number;
      complete: boolean;
    }
  | {
      type: 'error';
      message: string;
    };
