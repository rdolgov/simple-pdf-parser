import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { LoadingIcon } from './OverlayIcons';

interface InteractiveWidgetPopupProps {
  title: string;
  position: { top: number; left: number };
  srcDoc: string;
  isLoading: boolean;
  error?: string | null;
  onClose: () => void;
}

export function InteractiveWidgetPopup({
  title,
  position,
  srcDoc,
  isLoading,
  error = null,
  onClose
}: InteractiveWidgetPopupProps): JSX.Element {
  const [dragPosition, setDragPosition] = useState<{ top: number; left: number } | null>(null);
  const [panelSize, setPanelSize] = useState<{ width: number; height: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const isDraggingRef = useRef(false);
  const isResizingRef = useRef(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; elemX: number; elemY: number } | null>(null);
  const resizeStartRef = useRef<{ mouseX: number; mouseY: number; width: number; height: number } | null>(null);
  const fitFrameRef = useRef<number | null>(null);

  useEffect(() => {
    setDragPosition(null);
    setPanelSize(null);
  }, [position.top, position.left, title, srcDoc]);

  const requestWidgetRefit = useCallback(() => {
    if (fitFrameRef.current !== null) {
      cancelAnimationFrame(fitFrameRef.current);
    }

    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = requestAnimationFrame(() => {
        fitFrameRef.current = null;
        const iframeWindow = iframeRef.current?.contentWindow as (Window & {
          __interactiveWidgetRefit?: () => void;
        }) | null;
        iframeWindow?.__interactiveWidgetRefit?.();
      });
    });
  }, []);

  const handlePointerStart = useCallback((event: ReactMouseEvent) => {
    const target = event.target as HTMLElement;
    const container = containerRef.current;
    if (!container) {
      return;
    }

    if (target.closest('.interactive-widget-resize-handle')) {
      event.preventDefault();
      isResizingRef.current = true;
      resizeStartRef.current = {
        mouseX: event.clientX,
        mouseY: event.clientY,
        width: container.offsetWidth,
        height: container.offsetHeight
      };
      return;
    }

    if (!target.closest('.interactive-widget-drag-handle')) {
      return;
    }

    event.preventDefault();
    isDraggingRef.current = true;

    const style = container.style;
    dragStartRef.current = {
      mouseX: event.clientX,
      mouseY: event.clientY,
      elemX: Number.parseFloat(style.left) || 0,
      elemY: Number.parseFloat(style.top) || 0
    };
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isDraggingRef.current || !dragStartRef.current) {
        if (!isResizingRef.current || !resizeStartRef.current) {
          return;
        }

        const nextWidth = Math.max(360, resizeStartRef.current.width + (event.clientX - resizeStartRef.current.mouseX));
        const nextHeight = Math.max(320, resizeStartRef.current.height + (event.clientY - resizeStartRef.current.mouseY));
        const maxWidth = Math.max(360, window.innerWidth - 24);
        const maxHeight = Math.max(320, window.innerHeight - 24);
        setPanelSize({
          width: Math.min(nextWidth, maxWidth),
          height: Math.min(nextHeight, maxHeight)
        });
        return;
      }

      const deltaX = event.clientX - dragStartRef.current.mouseX;
      const deltaY = event.clientY - dragStartRef.current.mouseY;
      setDragPosition({
        top: dragStartRef.current.elemY + deltaY,
        left: dragStartRef.current.elemX + deltaX
      });
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      isResizingRef.current = false;
      dragStartRef.current = null;
      resizeStartRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  useEffect(() => {
    requestWidgetRefit();
  }, [panelSize, requestWidgetRefit, srcDoc]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      requestWidgetRefit();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [requestWidgetRefit]);

  useEffect(() => {
    return () => {
      if (fitFrameRef.current !== null) {
        cancelAnimationFrame(fitFrameRef.current);
        fitFrameRef.current = null;
      }
    };
  }, []);

  const handleContainerClick = useCallback((event: ReactMouseEvent) => {
    event.stopPropagation();
  }, []);

  const currentPosition = dragPosition ?? position;

  return (
    <div
      ref={containerRef}
      className="interactive-widget-popup"
      style={{
        top: `${currentPosition.top}px`,
        left: `${currentPosition.left}px`,
        ...(panelSize ? { width: `${panelSize.width}px`, height: `${panelSize.height}px` } : {})
      }}
      onClick={handleContainerClick}
      onMouseDown={handlePointerStart}
    >
      <div className="interactive-widget-drag-handle">
        <DragIcon />
      </div>
      <button
        type="button"
        className="interactive-widget-close"
        onClick={onClose}
        aria-label="Close interactive widget"
      >
        <CloseIcon />
      </button>

      <div className="interactive-widget-content">
        {isLoading ? (
          <div className="interactive-widget-loading">
            <LoadingIcon />
            <span>Generating interactive explainer...</span>
          </div>
        ) : error ? (
          <div className="interactive-widget-error">{error}</div>
        ) : (
          <iframe
            ref={iframeRef}
            className="interactive-widget-frame"
            title={title}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={srcDoc}
            onLoad={requestWidgetRefit}
          />
        )}
      </div>
      <div className="interactive-widget-resize-handle" aria-hidden="true">
        <ResizeIcon />
      </div>
    </div>
  );
}

function DragIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 6" width="16" height="6" aria-hidden="true">
      <circle cx="4" cy="1.5" r="1.2" fill="currentColor" />
      <circle cx="8" cy="1.5" r="1.2" fill="currentColor" />
      <circle cx="12" cy="1.5" r="1.2" fill="currentColor" />
      <circle cx="4" cy="4.5" r="1.2" fill="currentColor" />
      <circle cx="8" cy="4.5" r="1.2" fill="currentColor" />
      <circle cx="12" cy="4.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

function CloseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3.5 3.5l9 9M12.5 3.5l-9 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ResizeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M5 11l6-6M8 12l4-4M11 13l2-2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
