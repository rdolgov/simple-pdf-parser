export type PageRenderWorkerRequest =
  | {
      type: 'load-document';
      generation: number;
      pdfData: ArrayBuffer;
      zoom: number;
      devicePixelRatio: number;
    }
  | {
      type: 'attach-canvas';
      generation: number;
      pageNumber: number;
      canvas: OffscreenCanvas;
    }
  | {
      type: 'detach-canvas';
      generation: number;
      pageNumber: number;
    }
  | {
      type: 'update-zoom';
      generation: number;
      zoom: number;
    }
  | {
      type: 'set-priority-pages';
      generation: number;
      pageNumbers: number[];
    };

export type PageRenderWorkerResponse =
  | {
      type: 'ready';
      generation: number;
    }
  | {
      type: 'page-render-status';
      generation: number;
      pageNumber: number;
      status: 'rendering' | 'ready';
    }
  | {
      type: 'error';
      generation: number;
      message: string;
    };
