import { useCallback, useEffect, useRef, useState } from 'react';
import type { TopTaskStatusView } from '../utils/topTaskStatus';

export function useTaskStatusNotice(): {
  notice: TopTaskStatusView | null;
  showNotice: (status: TopTaskStatusView, durationMs?: number) => void;
  clearNotice: () => void;
} {
  const [notice, setNotice] = useState<TopTaskStatusView | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const clearNotice = useCallback(() => {
    if (timeoutRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setNotice(null);
  }, []);

  const showNotice = useCallback((status: TopTaskStatusView, durationMs = 4000) => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setNotice(status);
    if (typeof window !== 'undefined') {
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        setNotice(null);
      }, Math.max(500, durationMs));
    }
  }, []);

  useEffect(() => clearNotice, [clearNotice]);

  return {
    notice,
    showNotice,
    clearNotice
  };
}
