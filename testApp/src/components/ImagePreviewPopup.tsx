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
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; elemX: number; elemY: number } | null>(null);

  // Reset drag position when click position changes (always open next to clicked button)
  useEffect(() => {
    setDragPosition(null);
  }, [position.top, position.left]);


  const handleDragStart = useCallback((e: ReactMouseEvent) => {
    // Only start drag from the drag handle
    const target = e.target as HTMLElement;
    if (!target.closest('.image-preview-drag-handle')) {
      return;
    }
    e.preventDefault();
    isDraggingRef.current = true;

    const container = containerRef.current;
    if (container) {
      const style = container.style;
      const currentTop = parseFloat(style.top) || 0;
      const currentLeft = parseFloat(style.left) || 0;

      dragStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        elemX: currentLeft,
        elemY: currentTop
      };
    }
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !dragStartRef.current) return;

      const deltaX = e.clientX - dragStartRef.current.mouseX;
      const deltaY = e.clientY - dragStartRef.current.mouseY;

      const newLeft = dragStartRef.current.elemX + deltaX;
      const newTop = dragStartRef.current.elemY + deltaY;

      setDragPosition({ top: newTop, left: newLeft });
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
      }
      dragStartRef.current = null;
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
    left: `${currentPosition.left}px`
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
