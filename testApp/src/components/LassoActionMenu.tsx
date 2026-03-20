import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { ExploreIcon, LoadingIcon, WidgetIcon } from './OverlayIcons';

interface LassoActionMenuProps {
  previewDataUri: string;
  position: { top: number; left: number };
  activeAction: 'explain' | 'interactive' | null;
  error?: string | null;
  onExplain: () => void;
  onMakeInteractive: () => void;
  onReselect: () => void;
  onCancel: () => void;
}

export function LassoActionMenu({
  previewDataUri,
  position,
  activeAction,
  error = null,
  onExplain,
  onMakeInteractive,
  onReselect,
  onCancel
}: LassoActionMenuProps): JSX.Element {
  const [dragPosition, setDragPosition] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; elemX: number; elemY: number } | null>(null);

  useEffect(() => {
    setDragPosition(null);
  }, [position.top, position.left]);

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  const handlePointerStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.closest('.lasso-action-menu__drag-handle')) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    event.preventDefault();
    isDraggingRef.current = true;
    dragStartRef.current = {
      mouseX: event.clientX,
      mouseY: event.clientY,
      elemX: Number.parseFloat(container.style.left) || 0,
      elemY: Number.parseFloat(container.style.top) || 0
    };
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isDraggingRef.current || !dragStartRef.current) {
        return;
      }

      const nextLeft = dragStartRef.current.elemX + (event.clientX - dragStartRef.current.mouseX);
      const nextTop = dragStartRef.current.elemY + (event.clientY - dragStartRef.current.mouseY);
      setDragPosition({ top: nextTop, left: nextLeft });
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      dragStartRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const currentPosition = dragPosition ?? position;

  return (
    <div
      ref={containerRef}
      className="lasso-action-menu"
      style={{ top: `${currentPosition.top}px`, left: `${currentPosition.left}px` }}
      onClick={handleClick}
      onMouseDown={handlePointerStart}
    >
      <div className="lasso-action-menu__drag-handle" aria-hidden="true">
        <DragIcon />
      </div>
      <div className="lasso-action-menu__preview">
        <img src={previewDataUri} alt="Selected page region" />
      </div>
      <div className="lasso-action-menu__copy">
        <div className="lasso-action-menu__title">Selected region</div>
        <div className="lasso-action-menu__subtitle">Choose one action before anything is sent.</div>
      </div>
      <div className="lasso-action-menu__actions">
        <button
          type="button"
          className="lasso-action-menu__button lasso-action-menu__button--primary"
          onClick={onExplain}
          disabled={activeAction !== null}
        >
          {activeAction === 'explain' ? <LoadingIcon /> : <ExploreIcon />}
          <span>{activeAction === 'explain' ? 'Explaining...' : 'Explain'}</span>
        </button>
        <button
          type="button"
          className="lasso-action-menu__button"
          onClick={onMakeInteractive}
          disabled={activeAction !== null}
        >
          {activeAction === 'interactive' ? <LoadingIcon /> : <WidgetIcon />}
          <span>{activeAction === 'interactive' ? 'Building...' : 'Make Interactive'}</span>
        </button>
      </div>
      {error && <div className="lasso-action-menu__error">{error}</div>}
      <div className="lasso-action-menu__footer">
        <button type="button" className="lasso-action-menu__link" onClick={onReselect} disabled={activeAction !== null}>
          Select again
        </button>
        <button type="button" className="lasso-action-menu__link" onClick={onCancel} disabled={activeAction !== null}>
          Cancel
        </button>
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
