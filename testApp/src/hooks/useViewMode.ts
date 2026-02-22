import { useState, useCallback } from 'react';
import type { ViewMode, FocusViewMode } from '../types';

export interface UseViewModeResult {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  preferredFocusView: FocusViewMode;
  setPreferredFocusView: (mode: FocusViewMode) => void;
  showFocusView: (mode?: FocusViewMode) => void;
}

export function useViewMode(initialMode: ViewMode = 'canvas'): UseViewModeResult {
  const [viewMode, setViewMode] = useState<ViewMode>(initialMode);
  const [preferredFocusView, setPreferredFocusView] = useState<FocusViewMode>('focus-render');

  const showFocusView = useCallback(
    (mode?: FocusViewMode) => {
      if (mode) {
        setPreferredFocusView(mode);
        setViewMode(mode);
        return;
      }
      setViewMode((current) => {
        if (current === 'focus-render' || current === 'focus-pdf') {
          return current;
        }
        return preferredFocusView;
      });
    },
    [preferredFocusView]
  );

  return {
    viewMode,
    setViewMode,
    preferredFocusView,
    setPreferredFocusView,
    showFocusView
  };
}
