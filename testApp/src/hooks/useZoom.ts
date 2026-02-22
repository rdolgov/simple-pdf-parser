import { useState, useCallback, useMemo } from 'react';
import { CanvasRenderer } from 'pdf-layout-parser';

export interface UseZoomResult {
  zoom: number;
  setZoom: (value: number) => void;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleZoomReset: () => void;
  renderer: CanvasRenderer;
}

export interface UseZoomOptions {
  initialScale?: number;
  devicePixelRatio?: number;
}

export function useZoom(options: UseZoomOptions = {}): UseZoomResult {
  const { initialScale = 1.3, devicePixelRatio = window.devicePixelRatio || 1 } = options;

  const renderer = useMemo(
    () => new CanvasRenderer({ scale: initialScale, devicePixelRatio }),
    [initialScale, devicePixelRatio]
  );

  const [zoom, setZoom] = useState(() => renderer.getScale());

  const handleZoomIn = useCallback(() => {
    const newScale = renderer.zoomIn();
    setZoom(newScale);
  }, [renderer]);

  const handleZoomOut = useCallback(() => {
    const newScale = renderer.zoomOut();
    setZoom(newScale);
  }, [renderer]);

  const handleZoomReset = useCallback(() => {
    const newScale = renderer.resetZoom();
    setZoom(newScale);
  }, [renderer]);

  return {
    zoom,
    setZoom,
    handleZoomIn,
    handleZoomOut,
    handleZoomReset,
    renderer
  };
}
