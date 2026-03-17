import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocument } from 'pdf-layout-parser';

import type { BackgroundRenderProgress, CanvasPageRenderState, ViewMode } from '../types';
import {
  computeCanvasDisplaySize,
  MAIN_THREAD_PAGE_RENDER_COUNT,
  supportsBackgroundCanvasRendering
} from '../utils/backgroundCanvasRendering';
import { buildViewportPriorityPageOrder } from '../utils/backgroundPageScheduling';
import type { PageRenderWorkerRequest, PageRenderWorkerResponse } from '../workers/pageRenderProtocol';

type BackgroundStatus = 'disabled' | 'loading' | 'ready';

const BACKGROUND_PAGE_OBSERVER_ROOT_MARGIN = '1200px 0px 1200px 0px';

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
  backgroundRenderProgress: BackgroundRenderProgress;
  getCanvasRef: (pageNumber: number) => (element: HTMLCanvasElement | null) => void;
  getPageRenderState: (pageNumber: number) => CanvasPageRenderState;
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
  const visibleBackgroundPages = useRef<Map<number, number>>(new Map());
  const transferredPages = useRef<Set<number>>(new Set());
  const workerRef = useRef<Worker | null>(null);
  const intersectionObserverRef = useRef<IntersectionObserver | null>(null);
  const lastPrioritySignatureRef = useRef('');
  const lastWorkerZoomRef = useRef<number | null>(null);
  const activeGeneration = useRef(0);
  const readyGeneration = useRef<number | null>(null);
  const onRenderErrorRef = useRef(onRenderError);
  const backgroundStatusRef = useRef<BackgroundStatus>('disabled');
  const shouldUseBackgroundRenderingRef = useRef(false);
  const [canvasRevision, setCanvasRevision] = useState(0);
  const [backgroundStatus, setBackgroundStatus] = useState<BackgroundStatus>('disabled');
  const [pageRenderStates, setPageRenderStates] = useState<Record<number, CanvasPageRenderState>>({});

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

  const totalPages = document?.pages.length ?? 0;

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

  const setBackgroundPageRenderState = useCallback(
    (pageNumber: number, nextState: CanvasPageRenderState | null) => {
      setPageRenderStates((currentStates) => {
        if (nextState === null) {
          if (!(pageNumber in currentStates)) {
            return currentStates;
          }
          const nextStates = { ...currentStates };
          delete nextStates[pageNumber];
          return nextStates;
        }

        if (currentStates[pageNumber] === nextState) {
          return currentStates;
        }

        return {
          ...currentStates,
          [pageNumber]: nextState
        };
      });
    },
    []
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

  const syncPriorityPages = useCallback(() => {
    if (!shouldUseBackgroundRenderingRef.current || backgroundStatusRef.current !== 'ready') {
      return;
    }

    const priorityPages = buildViewportPriorityPageOrder(visibleBackgroundPages.current.keys(), totalPages);
    const signature = priorityPages.join(',');
    if (signature === lastPrioritySignatureRef.current) {
      return;
    }

    lastPrioritySignatureRef.current = signature;
    postWorkerMessage({
      type: 'set-priority-pages',
      generation: activeGeneration.current,
      pageNumbers: priorityPages
    });
  }, [postWorkerMessage, totalPages]);

  const observeBackgroundCanvas = useCallback(
    (pageNumber: number, element: HTMLCanvasElement | null) => {
      const observer = intersectionObserverRef.current;

      if (!element) {
        visibleBackgroundPages.current.delete(pageNumber);
        syncPriorityPages();
        return;
      }

      observer?.observe(element);
    },
    [syncPriorityPages]
  );

  const attachBackgroundCanvas = useCallback(
    (pageNumber: number, element: HTMLCanvasElement) => {
      if (readyGeneration.current !== activeGeneration.current || !shouldUseBackgroundRendering) {
        setBackgroundPageRenderState(pageNumber, 'preparing');
        return;
      }
      if (transferredPages.current.has(pageNumber)) {
        return;
      }

      try {
        const canvas = element.transferControlToOffscreen();
        transferredPages.current.add(pageNumber);
        setBackgroundPageRenderState(pageNumber, 'queued');
        postWorkerMessage(
          {
            type: 'attach-canvas',
            generation: activeGeneration.current,
            pageNumber,
            canvas
          },
          [canvas]
        );
        syncPriorityPages();
      } catch (error) {
        onRenderErrorRef.current(
          error instanceof Error ? error.message : 'Unable to start background page rendering.'
        );
      }
    },
    [postWorkerMessage, setBackgroundPageRenderState, shouldUseBackgroundRendering, syncPriorityPages]
  );

  useEffect(() => {
    backgroundCanvasElements.current.forEach((element, pageNumber) => {
      applyCanvasDisplaySize(pageNumber, element);
    });
  }, [applyCanvasDisplaySize]);

  useEffect(() => {
    if (!shouldUseBackgroundRendering) {
      intersectionObserverRef.current?.disconnect();
      intersectionObserverRef.current = null;
      visibleBackgroundPages.current.clear();
      lastPrioritySignatureRef.current = '';
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        let didChange = false;

        entries.forEach((entry) => {
          const pageNumber = Number(entry.target.getAttribute('data-page-number'));
          if (!Number.isFinite(pageNumber) || pageNumber <= MAIN_THREAD_PAGE_RENDER_COUNT) {
            return;
          }

          if (entry.isIntersecting) {
            const nextRatio = entry.intersectionRatio;
            if (visibleBackgroundPages.current.get(pageNumber) !== nextRatio) {
              visibleBackgroundPages.current.set(pageNumber, nextRatio);
              didChange = true;
            }
            return;
          }

          if (visibleBackgroundPages.current.delete(pageNumber)) {
            didChange = true;
          }
        });

        if (didChange) {
          syncPriorityPages();
        }
      },
      {
        root: null,
        rootMargin: BACKGROUND_PAGE_OBSERVER_ROOT_MARGIN,
        threshold: [0, 0.01, 0.25, 0.5, 0.75, 1]
      }
    );

    intersectionObserverRef.current = observer;
    backgroundCanvasElements.current.forEach((element) => {
      observer.observe(element);
    });

    return () => {
      observer.disconnect();
      if (intersectionObserverRef.current === observer) {
        intersectionObserverRef.current = null;
      }
      visibleBackgroundPages.current.clear();
      lastPrioritySignatureRef.current = '';
    };
  }, [shouldUseBackgroundRendering, syncPriorityPages]);

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
      lastPrioritySignatureRef.current = '';
      lastWorkerZoomRef.current = null;
      visibleBackgroundPages.current.clear();
      setPageRenderStates({});
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
    lastPrioritySignatureRef.current = '';
    lastWorkerZoomRef.current = zoom;
    visibleBackgroundPages.current.clear();
    setBackgroundStatus('loading');
    setPageRenderStates(() => {
      const nextStates: Record<number, CanvasPageRenderState> = {};
      backgroundCanvasElements.current.forEach((_element, pageNumber) => {
        nextStates[pageNumber] = 'preparing';
      });
      return nextStates;
    });

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
        syncPriorityPages();
        return;
      }

      if (message.type === 'page-render-status') {
        setBackgroundPageRenderState(pageNumberFromMessage(message), message.status);
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
  }, [
    attachBackgroundCanvas,
    devicePixelRatio,
    pdfData,
    postWorkerMessage,
    setBackgroundPageRenderState,
    shouldUseBackgroundRendering,
    syncPriorityPages
  ]);

  useEffect(() => {
    if (backgroundStatus !== 'ready' || !shouldUseBackgroundRendering) {
      return;
    }

    if (lastWorkerZoomRef.current === zoom) {
      return;
    }

    setPageRenderStates((currentStates) => {
      const nextStates: Record<number, CanvasPageRenderState> = {};
      backgroundCanvasElements.current.forEach((_element, pageNumber) => {
        nextStates[pageNumber] = 'queued';
      });

      const currentEntries = Object.entries(currentStates);
      const isUnchanged =
        currentEntries.length === Object.keys(nextStates).length &&
        currentEntries.every(([pageNumber, state]) => nextStates[Number(pageNumber)] === state);

      return isUnchanged ? currentStates : nextStates;
    });

    lastWorkerZoomRef.current = zoom;
    postWorkerMessage({
      type: 'update-zoom',
      generation: activeGeneration.current,
      zoom
    });
  }, [backgroundStatus, postWorkerMessage, shouldUseBackgroundRendering, zoom]);

  useEffect(() => {
    if (!shouldUseBackgroundRendering) {
      backgroundCanvasElements.current.clear();
      setPageRenderStates({});
      return;
    }

    canvasRefs.current.forEach((element, pageNumber) => {
      if (pageNumber <= MAIN_THREAD_PAGE_RENDER_COUNT) {
        return;
      }
      backgroundCanvasElements.current.set(pageNumber, element);
      applyCanvasDisplaySize(pageNumber, element);
      observeBackgroundCanvas(pageNumber, element);
      attachBackgroundCanvas(pageNumber, element);
    });
  }, [applyCanvasDisplaySize, attachBackgroundCanvas, observeBackgroundCanvas, shouldUseBackgroundRendering]);

  const getCanvasRef = useCallback(
    (pageNumber: number) => {
      const existing = canvasRefCallbacks.current.get(pageNumber);
      if (existing) {
        return existing;
      }

      const callback = (element: HTMLCanvasElement | null) => {
        if (element) {
          canvasRefs.current.set(pageNumber, element);
          element.dataset.pageNumber = String(pageNumber);
        } else {
          canvasRefs.current.delete(pageNumber);
        }

        if (shouldUseBackgroundRenderingRef.current && pageNumber > MAIN_THREAD_PAGE_RENDER_COUNT) {
          if (element) {
            backgroundCanvasElements.current.set(pageNumber, element);
            setBackgroundPageRenderState(
              pageNumber,
              readyGeneration.current === activeGeneration.current ? 'queued' : 'preparing'
            );
            applyCanvasDisplaySize(pageNumber, element);
            observeBackgroundCanvas(pageNumber, element);
            attachBackgroundCanvas(pageNumber, element);
          } else {
            const existingElement = backgroundCanvasElements.current.get(pageNumber);
            if (existingElement) {
              intersectionObserverRef.current?.unobserve(existingElement);
            }
            backgroundCanvasElements.current.delete(pageNumber);
            visibleBackgroundPages.current.delete(pageNumber);
            setBackgroundPageRenderState(pageNumber, null);
            if (transferredPages.current.has(pageNumber)) {
              postWorkerMessage({
                type: 'detach-canvas',
                generation: activeGeneration.current,
                pageNumber
              });
              transferredPages.current.delete(pageNumber);
            }
            syncPriorityPages();
          }
        } else {
          const existingElement = backgroundCanvasElements.current.get(pageNumber);
          if (existingElement) {
            intersectionObserverRef.current?.unobserve(existingElement);
          }
          backgroundCanvasElements.current.delete(pageNumber);
          visibleBackgroundPages.current.delete(pageNumber);
          setBackgroundPageRenderState(pageNumber, null);
          syncPriorityPages();
        }

        setCanvasRevision((revision) => revision + 1);
      };

      canvasRefCallbacks.current.set(pageNumber, callback);
      return callback;
    },
    [
      applyCanvasDisplaySize,
      attachBackgroundCanvas,
      observeBackgroundCanvas,
      postWorkerMessage,
      setBackgroundPageRenderState,
      syncPriorityPages
    ]
  );

  const getPageRenderState = useCallback(
    (pageNumber: number): CanvasPageRenderState => {
      if (!shouldUseBackgroundRendering || pageNumber <= MAIN_THREAD_PAGE_RENDER_COUNT) {
        return 'ready';
      }

      return pageRenderStates[pageNumber] ?? (backgroundStatus === 'loading' ? 'preparing' : 'queued');
    },
    [backgroundStatus, pageRenderStates, shouldUseBackgroundRendering]
  );

  const backgroundRenderProgress = useMemo<BackgroundRenderProgress>(() => {
    if (!shouldUseBackgroundRendering) {
      return {
        active: false,
        isPreparing: false,
        pendingPageCount: 0,
        renderingPageCount: 0,
        totalBackgroundPages: 0
      };
    }

    const states = Object.values(pageRenderStates);
    const totalBackgroundPages = states.length;
    const renderingPageCount = states.filter((state) => state === 'rendering').length;
    const readyPageCount = states.filter((state) => state === 'ready').length;
    const pendingPageCount = Math.max(0, totalBackgroundPages - readyPageCount);
    const isPreparing =
      backgroundStatus === 'loading' || states.some((state) => state === 'preparing');

    return {
      active: pendingPageCount > 0 || isPreparing,
      isPreparing,
      pendingPageCount,
      renderingPageCount,
      totalBackgroundPages
    };
  }, [backgroundStatus, pageRenderStates, shouldUseBackgroundRendering]);

  return {
    canvasRefs,
    canvasRevision,
    backgroundRenderProgress,
    getCanvasRef,
    getPageRenderState,
    shouldRenderPageOnMainThread
  };
}

function pageNumberFromMessage(
  message: Extract<PageRenderWorkerResponse, { type: 'page-render-status' }>
): number {
  return message.pageNumber;
}
