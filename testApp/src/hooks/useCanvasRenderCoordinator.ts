import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocument } from 'pdf-layout-parser';

import type { ViewMode } from '../types';
import {
  computeCanvasDisplaySize,
  MAIN_THREAD_PAGE_RENDER_COUNT,
  supportsBackgroundCanvasRendering
} from '../utils/backgroundCanvasRendering';
import type { PageRenderWorkerRequest, PageRenderWorkerResponse } from '../workers/pageRenderProtocol';

type BackgroundStatus = 'disabled' | 'loading' | 'ready';

export interface UseCanvasRenderCoordinatorOptions {
  document: PDFDocument | null;
  pdfData: ArrayBuffer | null;
  zoom: number;
  devicePixelRatio: number;
  viewMode: ViewMode;
  onRenderError: (message: string) => void;
}

export interface UseCanvasRenderCoordinatorResult {
  canvasRefs: React.MutableRefObject<Map<number, HTMLCanvasElement>>;
  canvasRevision: number;
  getCanvasRef: (pageNumber: number) => (element: HTMLCanvasElement | null) => void;
  shouldRenderPageOnMainThread: (pageNumber: number) => boolean;
}

export function useCanvasRenderCoordinator({
  document,
  pdfData,
  zoom,
  devicePixelRatio,
  viewMode,
  onRenderError
}: UseCanvasRenderCoordinatorOptions): UseCanvasRenderCoordinatorResult {
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const canvasRefCallbacks = useRef<Map<number, (element: HTMLCanvasElement | null) => void>>(new Map());
  const backgroundCanvasElements = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const transferredPages = useRef<Set<number>>(new Set());
  const workerRef = useRef<Worker | null>(null);
  const activeGeneration = useRef(0);
  const readyGeneration = useRef<number | null>(null);
  const onRenderErrorRef = useRef(onRenderError);
  const backgroundStatusRef = useRef<BackgroundStatus>('disabled');
  const shouldUseBackgroundRenderingRef = useRef(false);
  const [canvasRevision, setCanvasRevision] = useState(0);
  const [backgroundStatus, setBackgroundStatus] = useState<BackgroundStatus>('disabled');

  useEffect(() => {
    onRenderErrorRef.current = onRenderError;
  }, [onRenderError]);

  useEffect(() => {
    backgroundStatusRef.current = backgroundStatus;
  }, [backgroundStatus]);

  const pageSizes = useMemo(() => {
    const sizes = new Map<number, { width: number; height: number }>();
    document?.pages.forEach((page) => {
      sizes.set(page.number, page.size);
    });
    return sizes;
  }, [document]);

  const shouldUseBackgroundRendering = useMemo(() => {
    if (!document || !pdfData) {
      return false;
    }
    if (viewMode !== 'canvas' && viewMode !== 'focus-pdf') {
      return false;
    }
    return supportsBackgroundCanvasRendering() && document.pages.length > MAIN_THREAD_PAGE_RENDER_COUNT;
  }, [document, pdfData, viewMode]);

  useEffect(() => {
    shouldUseBackgroundRenderingRef.current = shouldUseBackgroundRendering;
  }, [shouldUseBackgroundRendering]);

  const shouldRenderPageOnMainThread = useCallback(
    (pageNumber: number) => !shouldUseBackgroundRendering || pageNumber <= MAIN_THREAD_PAGE_RENDER_COUNT,
    [shouldUseBackgroundRendering]
  );

  const applyCanvasDisplaySize = useCallback(
    (pageNumber: number, element: HTMLCanvasElement) => {
      const size = pageSizes.get(pageNumber);
      if (!size) {
        return;
      }
      const displaySize = computeCanvasDisplaySize(size.width, size.height, zoom);
      element.style.width = `${displaySize.width}px`;
      element.style.height = `${displaySize.height}px`;
    },
    [pageSizes, zoom]
  );

  const postWorkerMessage = useCallback((message: PageRenderWorkerRequest, transfer: Transferable[] = []) => {
    workerRef.current?.postMessage(message, transfer);
  }, []);

  const attachBackgroundCanvas = useCallback(
    (pageNumber: number, element: HTMLCanvasElement) => {
      if (readyGeneration.current !== activeGeneration.current || !shouldUseBackgroundRendering) {
        return;
      }
      if (transferredPages.current.has(pageNumber)) {
        return;
      }

      try {
        const canvas = element.transferControlToOffscreen();
        transferredPages.current.add(pageNumber);
        postWorkerMessage(
          {
            type: 'attach-canvas',
            generation: activeGeneration.current,
            pageNumber,
            canvas
          },
          [canvas]
        );
      } catch (error) {
        onRenderErrorRef.current(
          error instanceof Error ? error.message : 'Unable to start background page rendering.'
        );
      }
    },
    [postWorkerMessage, shouldUseBackgroundRendering]
  );

  useEffect(() => {
    backgroundCanvasElements.current.forEach((element, pageNumber) => {
      applyCanvasDisplaySize(pageNumber, element);
    });
  }, [applyCanvasDisplaySize]);

  useEffect(() => {
    if (!shouldUseBackgroundRendering || !pdfData) {
      const hadActiveResources =
        workerRef.current !== null ||
        readyGeneration.current !== null ||
        transferredPages.current.size > 0 ||
        backgroundStatusRef.current !== 'disabled';
      workerRef.current?.terminate();
      workerRef.current = null;
      readyGeneration.current = null;
      activeGeneration.current += 1;
      transferredPages.current.clear();
      if (hadActiveResources) {
        setBackgroundStatus('disabled');
        setCanvasRevision((revision) => revision + 1);
      }
      return;
    }

    const generation = activeGeneration.current + 1;
    activeGeneration.current = generation;
    readyGeneration.current = null;
    transferredPages.current.clear();
    setBackgroundStatus('loading');

    const worker = new Worker(new URL('../workers/pageRenderWorker.ts', import.meta.url), {
      type: 'module'
    });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<PageRenderWorkerResponse>) => {
      const message = event.data;
      if (message.generation !== generation) {
        return;
      }

      if (message.type === 'ready') {
        readyGeneration.current = generation;
        setBackgroundStatus('ready');
        backgroundCanvasElements.current.forEach((element, pageNumber) => {
          attachBackgroundCanvas(pageNumber, element);
        });
        return;
      }

      if (readyGeneration.current !== generation) {
        worker.terminate();
        workerRef.current = null;
        setBackgroundStatus('disabled');
        setCanvasRevision((revision) => revision + 1);
      }
      onRenderErrorRef.current(message.message);
    };

    worker.onerror = () => {
      if (readyGeneration.current !== generation) {
        worker.terminate();
        workerRef.current = null;
        setBackgroundStatus('disabled');
        setCanvasRevision((revision) => revision + 1);
      }
      onRenderErrorRef.current('Background page rendering failed.');
    };

    postWorkerMessage({
      type: 'load-document',
      generation,
      pdfData: pdfData.slice(0),
      zoom,
      devicePixelRatio
    });

    return () => {
      worker.terminate();
      if (workerRef.current === worker) {
        workerRef.current = null;
      }
    };
  }, [attachBackgroundCanvas, devicePixelRatio, pdfData, postWorkerMessage, shouldUseBackgroundRendering, zoom]);

  useEffect(() => {
    if (backgroundStatus !== 'ready' || !shouldUseBackgroundRendering) {
      return;
    }

    postWorkerMessage({
      type: 'update-zoom',
      generation: activeGeneration.current,
      zoom
    });
  }, [backgroundStatus, postWorkerMessage, shouldUseBackgroundRendering, zoom]);

  useEffect(() => {
    if (!shouldUseBackgroundRendering) {
      backgroundCanvasElements.current.clear();
      return;
    }

    canvasRefs.current.forEach((element, pageNumber) => {
      if (pageNumber <= MAIN_THREAD_PAGE_RENDER_COUNT) {
        return;
      }
      backgroundCanvasElements.current.set(pageNumber, element);
      applyCanvasDisplaySize(pageNumber, element);
      attachBackgroundCanvas(pageNumber, element);
    });
  }, [applyCanvasDisplaySize, attachBackgroundCanvas, shouldUseBackgroundRendering]);

  const getCanvasRef = useCallback(
    (pageNumber: number) => {
      const existing = canvasRefCallbacks.current.get(pageNumber);
      if (existing) {
        return existing;
      }

      const callback = (element: HTMLCanvasElement | null) => {
        if (element) {
          canvasRefs.current.set(pageNumber, element);
        } else {
          canvasRefs.current.delete(pageNumber);
        }

        if (shouldUseBackgroundRenderingRef.current && pageNumber > MAIN_THREAD_PAGE_RENDER_COUNT) {
          if (element) {
            backgroundCanvasElements.current.set(pageNumber, element);
            applyCanvasDisplaySize(pageNumber, element);
            attachBackgroundCanvas(pageNumber, element);
          } else {
            backgroundCanvasElements.current.delete(pageNumber);
            if (transferredPages.current.has(pageNumber)) {
              postWorkerMessage({
                type: 'detach-canvas',
                generation: activeGeneration.current,
                pageNumber
              });
              transferredPages.current.delete(pageNumber);
            }
          }
        } else {
          backgroundCanvasElements.current.delete(pageNumber);
        }

        setCanvasRevision((revision) => revision + 1);
      };

      canvasRefCallbacks.current.set(pageNumber, callback);
      return callback;
    },
    [applyCanvasDisplaySize, attachBackgroundCanvas, postWorkerMessage]
  );

  return {
    canvasRefs,
    canvasRevision,
    getCanvasRef,
    shouldRenderPageOnMainThread
  };
}
