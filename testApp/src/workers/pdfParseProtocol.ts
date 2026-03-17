import type { PDFEmbeddedFontResource, PDFPage } from 'pdf-layout-parser';

export type PdfParseWorkerRequest = {
  type: 'parse-document';
  pdfData: ArrayBuffer;
};

export type PdfParseWorkerResponse =
  | {
      type: 'parsed-page-batch';
      pages: PDFPage[];
      fontResources?: Record<string, PDFEmbeddedFontResource>;
      totalPages: number;
      complete: boolean;
    }
  | {
      type: 'error';
      message: string;
    };
