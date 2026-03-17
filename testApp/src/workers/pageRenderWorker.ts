/// <reference lib="webworker" />

import { CanvasRenderer, PDFDocument } from 'pdf-layout-parser';

import { selectNextPendingBackgroundPage } from '../utils/backgroundPageScheduling';
import type { PageRenderWorkerRequest, PageRenderWorkerResponse } from './pageRenderProtocol';

const workerScope = self as DedicatedWorkerGlobalScope;

let activeGeneration = 0;
let documentModel: PDFDocument | null = null;
let renderer: CanvasRenderer | null = null;
const attachedCanvases = new Map<number, OffscreenCanvas>();
const pendingPages = new Set<number>();
let priorityPages: number[] = [];
let isRendering = false;

workerScope.onmessage = (event: MessageEvent<PageRenderWorkerRequest>) => {
  const message = event.data;

  switch (message.type) {
    case 'load-document':
      void handleLoadDocument(message);
      break;
    case 'attach-canvas':
      if (message.generation !== activeGeneration) {
        return;
      }
      attachedCanvases.set(message.pageNumber, message.canvas);
      queuePage(message.pageNumber);
      break;
    case 'detach-canvas':
      if (message.generation !== activeGeneration) {
        return;
      }
      attachedCanvases.delete(message.pageNumber);
      pendingPages.delete(message.pageNumber);
      break;
    case 'update-zoom':
      if (message.generation !== activeGeneration || !renderer) {
        return;
      }
      renderer.setScale(message.zoom);
      for (const pageNumber of attachedCanvases.keys()) {
        pendingPages.add(pageNumber);
      }
      void flushPendingPages(message.generation);
      break;
    case 'set-priority-pages':
      if (message.generation !== activeGeneration) {
        return;
      }
      priorityPages = message.pageNumbers.slice();
      void flushPendingPages(message.generation);
      break;
  }
};

async function handleLoadDocument(
  message: Extract<PageRenderWorkerRequest, { type: 'load-document' }>
): Promise<void> {
  activeGeneration = message.generation;
  pendingPages.clear();
  priorityPages = [];

  try {
    documentModel = PDFDocument.from(message.pdfData);
    renderer = new CanvasRenderer({
      scale: message.zoom,
      devicePixelRatio: message.devicePixelRatio
    });

    if (message.generation !== activeGeneration) {
      return;
    }

    postWorkerMessage({ type: 'ready', generation: message.generation });
    for (const pageNumber of attachedCanvases.keys()) {
      pendingPages.add(pageNumber);
    }
    await flushPendingPages(message.generation);
  } catch (error) {
    postWorkerMessage({
      type: 'error',
      generation: message.generation,
      message: error instanceof Error ? error.message : 'Background page rendering failed.'
    });
  }
}

function queuePage(pageNumber: number): void {
  if (!documentModel || !renderer || !attachedCanvases.has(pageNumber)) {
    return;
  }
  pendingPages.add(pageNumber);
  void flushPendingPages(activeGeneration);
}

async function flushPendingPages(generation: number): Promise<void> {
  if (isRendering || !documentModel || !renderer) {
    return;
  }

  isRendering = true;
  try {
    while (pendingPages.size > 0 && generation === activeGeneration) {
      const nextPageNumber = selectNextPendingBackgroundPage(pendingPages, priorityPages);
      if (nextPageNumber === undefined) {
        break;
      }
      pendingPages.delete(nextPageNumber);

      const canvas = attachedCanvases.get(nextPageNumber);
      if (!canvas) {
        continue;
      }

      postWorkerMessage({
        type: 'page-render-status',
        generation,
        pageNumber: nextPageNumber,
        status: 'rendering'
      });
      renderer.render(canvas, documentModel, nextPageNumber);
      void refinePageFonts(generation, nextPageNumber, canvas);
      postWorkerMessage({
        type: 'page-render-status',
        generation,
        pageNumber: nextPageNumber,
        status: 'ready'
      });
      await yieldToWorkerQueue();
    }
  } catch (error) {
    postWorkerMessage({
      type: 'error',
      generation,
      message: error instanceof Error ? error.message : 'Background page rendering failed.'
    });
  } finally {
    isRendering = false;
  }
}

function postWorkerMessage(message: PageRenderWorkerResponse): void {
  workerScope.postMessage(message);
}

function yieldToWorkerQueue(): Promise<void> {
  return new Promise((resolve) => {
    workerScope.setTimeout(() => resolve(), 0);
  });
}

async function refinePageFonts(
  generation: number,
  pageNumber: number,
  canvas: OffscreenCanvas
): Promise<void> {
  if (!documentModel || !renderer) {
    return;
  }

  try {
    const didLoadEmbeddedFonts = await renderer.preparePageFonts(documentModel, pageNumber);
    if (
      !didLoadEmbeddedFonts ||
      generation !== activeGeneration ||
      attachedCanvases.get(pageNumber) !== canvas ||
      !documentModel ||
      !renderer
    ) {
      return;
    }

    renderer.render(canvas, documentModel, pageNumber);
  } catch {
    // Ignore font refinement failures and keep the immediate fallback render.
  }
}
