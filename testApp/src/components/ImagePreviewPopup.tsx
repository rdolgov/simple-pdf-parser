import { useState, useCallback, useRef, useEffect } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';


interface ImagePreviewPopupProps {
  dataUri: string;
  position: { top: number; left: number };
  onClose: () => void;
  onDelete?: () => void;
}

export function ImagePreviewPopup({
  dataUri,
  position,
  onClose,
  onDelete
}: ImagePreviewPopupProps): JSX.Element {
  const [dragPosition, setDragPosition] = useState<{ top: number; left: number } | null>(null);
  const [panelSize, setPanelSize] = useState<{ width: number; height: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const isResizingRef = useRef(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; elemX: number; elemY: number } | null>(null);
  const resizeStartRef = useRef<{ mouseX: number; mouseY: number; width: number; height: number } | null>(null);

  // Reset drag position when click position changes (always open next to clicked button)
  useEffect(() => {
    setDragPosition(null);
    setPanelSize(null);
  }, [position.top, position.left]);


  const handleDragStart = useCallback((e: ReactMouseEvent) => {
    const target = e.target as HTMLElement;
    const container = containerRef.current;
    if (!container) {
      return;
    }

    if (target.closest('.image-preview-resize-handle')) {
      e.preventDefault();
      isResizingRef.current = true;
      resizeStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        width: container.offsetWidth,
        height: container.offsetHeight
      };
      return;
    }

    if (!target.closest('.image-preview-drag-handle')) {
      return;
    }

    e.preventDefault();
    isDraggingRef.current = true;

    const style = container.style;
    const currentTop = parseFloat(style.top) || 0;
    const currentLeft = parseFloat(style.left) || 0;

    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      elemX: currentLeft,
      elemY: currentTop
    };
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const parentRect = getPopupParentRect(container);

      if (isResizingRef.current && resizeStartRef.current) {
        const newWidth = resizeStartRef.current.width + (e.clientX - resizeStartRef.current.mouseX);
        const newHeight = resizeStartRef.current.height + (e.clientY - resizeStartRef.current.mouseY);
        const maxWidth = Math.max(320, parentRect.width);
        const maxHeight = Math.max(220, parentRect.height);
        setPanelSize({
          width: clamp(newWidth, 320, maxWidth),
          height: clamp(newHeight, 220, maxHeight)
        });
        return;
      }

      if (!isDraggingRef.current || !dragStartRef.current) return;

      const deltaX = e.clientX - dragStartRef.current.mouseX;
      const deltaY = e.clientY - dragStartRef.current.mouseY;

      const maxLeft = Math.max(0, parentRect.width - container.offsetWidth);
      const maxTop = Math.max(0, parentRect.height - container.offsetHeight);
      const newLeft = clamp(dragStartRef.current.elemX + deltaX, 0, maxLeft);
      const newTop = clamp(dragStartRef.current.elemY + deltaY, 0, maxTop);

      setDragPosition({ top: newTop, left: newLeft });
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
      }
      if (isResizingRef.current) {
        isResizingRef.current = false;
      }
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

  const handleContainerClick = useCallback((e: ReactMouseEvent) => {
    e.stopPropagation();
  }, []);

  const currentPosition = dragPosition ?? position;
  const positionStyle = {
    top: `${currentPosition.top}px`,
    left: `${currentPosition.left}px`,
    width: panelSize ? `${panelSize.width}px` : undefined,
    height: panelSize ? `${panelSize.height}px` : undefined
  };

  return (
    <div
      ref={containerRef}
      className="image-preview-popup"
      style={positionStyle}
      onClick={handleContainerClick}
      onMouseDown={handleDragStart}
    >
      <div className="image-preview-drag-handle">
        <DragIcon />
      </div>
      {onDelete && (
        <button
          type="button"
          className="image-preview-delete"
          onClick={onDelete}
          aria-label="Delete image"
          title="Delete this saved image"
        >
          <TrashIcon />
        </button>
      )}
      <button
        type="button"
        className="image-preview-close"
        onClick={onClose}
        aria-label="Close preview"
      >
        <CloseIcon />
      </button>
      <div className="image-preview-content">
        <img src={dataUri} alt="Generated from text" />
      </div>
      <div className="image-preview-resize-handle" aria-hidden="true" />
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getPopupParentRect(element: HTMLElement): { width: number; height: number } {
  const parent = element.offsetParent;
  if (parent instanceof HTMLElement) {
    return {
      width: parent.clientWidth,
      height: parent.clientHeight
    };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight
  };
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

function TrashIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M5.5 2V1.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V2M2 4h12M4 4v9.5a1.5 1.5 0 0 0 1.5 1.5h5a1.5 1.5 0 0 0 1.5-1.5V4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6.5 7v4M9.5 7v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
