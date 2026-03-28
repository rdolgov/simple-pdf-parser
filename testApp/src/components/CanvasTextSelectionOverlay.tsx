import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MouseEvent } from 'react';

import type { AnnotationBounds } from '../storage/annotationStorage';
import type { HighlightLineData } from '../utils/highlightUtils';
import {
  buildTextSelectionLayout,
  hasSelectableText,
  mergeTextSelectionFragments,
  type TextSelectionLayout,
  type TextSelectionRange
} from '../utils/textRangeSelection';

interface CanvasTextSelectionOverlayProps {
  blockBounds: AnnotationBounds;
  lines: HighlightLineData[];
  scaleX: number;
  scaleY: number;
  padding: number;
  selection: TextSelectionRange | null;
  onSelectionChange: (selection: TextSelectionRange | null) => void;
  onSelectionDragStateChange?: (isDragging: boolean) => void;
}

export function CanvasTextSelectionOverlay({
  blockBounds,
  lines,
  scaleX,
  scaleY,
  padding,
  selection,
  onSelectionChange,
  onSelectionDragStateChange
}: CanvasTextSelectionOverlayProps): JSX.Element | null {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isDraggingSelectionRef = useRef(false);
  const publishSelectionFrameRef = useRef<number | null>(null);
  const layout = useMemo(
    () => buildTextSelectionLayout({ blockBounds, lines, scaleX, scaleY, padding }),
    [blockBounds, lines, padding, scaleX, scaleY]
  );

  const publishDomSelection = useCallback(() => {
    const root = rootRef.current;
    const selectionState = window.getSelection();
    if (!root || !selectionState || selectionState.rangeCount === 0 || selectionState.isCollapsed) {
      return false;
    }

    const anchorNode = selectionState.anchorNode;
    const focusNode = selectionState.focusNode;
    if (!(anchorNode && root.contains(anchorNode) && focusNode && root.contains(focusNode))) {
      return false;
    }

    const text = selectionState.toString();
    const normalizedText = text.replace(/\s+/g, ' ').trim();
    if (normalizedText.length === 0) {
      onSelectionChange(null);
      return false;
    }

    const rootRect = root.getBoundingClientRect();
    const range = selectionState.getRangeAt(0);
    const fragments = Array.from(range.getClientRects())
      .map((rect) => clipClientRectToRoot(rootRect, rect))
      .filter((rect): rect is NonNullable<typeof rect> => rect !== null)
      .map((rect) => ({
        left: rect.left - rootRect.left,
        top: rect.top - rootRect.top,
        width: rect.width,
        height: rect.height
      }));

    if (fragments.length === 0) {
      onSelectionChange(null);
      return false;
    }

    onSelectionChange({
      text,
      normalizedText,
      fragments: mergeTextSelectionFragments(fragments)
    });
    return true;
  }, [onSelectionChange]);

  const scheduleSelectionPublish = useCallback((clearWhenEmpty = false) => {
    if (publishSelectionFrameRef.current !== null) {
      return;
    }

    publishSelectionFrameRef.current = window.requestAnimationFrame(() => {
      publishSelectionFrameRef.current = null;
      const didPublish = publishDomSelection();
      if (!didPublish && clearWhenEmpty) {
        onSelectionChange(null);
      }
    });
  }, [onSelectionChange, publishDomSelection]);

  useEffect(() => {
    return () => {
      if (publishSelectionFrameRef.current !== null) {
        window.cancelAnimationFrame(publishSelectionFrameRef.current);
      }
      onSelectionDragStateChange?.(false);
    };
  }, [onSelectionDragStateChange]);

  useEffect(() => {
    const handleSelectionChange = () => {
      if (isDraggingSelectionRef.current) {
        scheduleSelectionPublish();
        return;
      }

      const didPublish = publishDomSelection();
      if (!didPublish) {
        onSelectionChange(null);
      }
    };

    const handleMouseMove = () => {
      if (!isDraggingSelectionRef.current) {
        return;
      }
      scheduleSelectionPublish();
    };

    const handleMouseUp = () => {
      if (!isDraggingSelectionRef.current) {
        return;
      }
      isDraggingSelectionRef.current = false;
      onSelectionDragStateChange?.(false);
      scheduleSelectionPublish(true);
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onSelectionChange, onSelectionDragStateChange, publishDomSelection, scheduleSelectionPublish]);

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    isDraggingSelectionRef.current = true;
    onSelectionDragStateChange?.(true);
  };

  const handleMouseUp = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    isDraggingSelectionRef.current = false;
    onSelectionDragStateChange?.(false);
    scheduleSelectionPublish(true);
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  if (!hasSelectableText(layout)) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      className="canvas-text-selection-overlay"
      aria-label="Selectable text"
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
    >
      <div className="canvas-text-selection-text-layer">
        {layout.lines.map((line, lineIndex) => (
          <SelectionLine key={lineIndex} layout={layout} lineIndex={lineIndex} />
        ))}
      </div>
      {selection?.fragments.map((fragment, index) => (
        <div
          key={index}
          className="canvas-text-selection-fragment"
          style={{
            left: `${fragment.left}px`,
            top: `${fragment.top}px`,
            width: `${fragment.width}px`,
            height: `${fragment.height}px`
          }}
        />
      ))}
    </div>
  );
}

function SelectionLine({ layout, lineIndex }: { layout: TextSelectionLayout; lineIndex: number }) {
  const line = layout.lines[lineIndex];
  if (!line || line.characters.length === 0 || line.text.length === 0) {
    return null;
  }

  const left = line.characters[0]?.left ?? line.bounds.minX;
  const top = line.bounds.minY;
  const height = Math.max(line.bounds.maxY - line.bounds.minY, 1);

  return (
    <div
      className="canvas-text-selection-line"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        height: `${height}px`
      }}
    >
      {Array.from(line.text).map((character, charIndex) => {
        const box = line.characters[charIndex];
        if (!box) {
          return null;
        }

        const width = Math.max(box.right - box.left, 1);
        return (
          <span
            key={charIndex}
            className="canvas-text-selection-char"
            data-line-index={lineIndex}
            data-char-index={charIndex}
            style={{
              width: `${width}px`,
              height: `${height}px`,
              lineHeight: `${height}px`,
              fontSize: `${Math.max(height * 0.8, 8)}px`
            }}
          >
            {character === ' ' ? '\u00A0' : character}
          </span>
        );
      })}
    </div>
  );
}

function clipClientRectToRoot(rootRect: DOMRect, rect: DOMRect): DOMRect | null {
  const left = Math.max(rootRect.left, rect.left);
  const top = Math.max(rootRect.top, rect.top);
  const right = Math.min(rootRect.right, rect.right);
  const bottom = Math.min(rootRect.bottom, rect.bottom);

  if (!(right > left) || !(bottom > top)) {
    return null;
  }

  return new DOMRect(left, top, right - left, bottom - top);
}
