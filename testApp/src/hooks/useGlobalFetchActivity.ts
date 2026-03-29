import { useEffect, useState } from 'react';
import { parseApiErrorMessage } from '../utils/apiErrorMessage';

export interface GlobalFetchError {
  id: number;
  timestamp: number;
  status?: number;
  method?: string;
  url?: string;
  message: string;
}

export interface GlobalFetchActivity {
  activeRequestCount: number;
  isNetworkBusy: boolean;
  lastError: GlobalFetchError | null;
  dismissLastError: () => void;
}

export function useGlobalFetchActivity(): GlobalFetchActivity {
  const [activeRequestCount, setActiveRequestCount] = useState(0);
  const [lastError, setLastError] = useState<GlobalFetchError | null>(null);

  useEffect(() => {
    if (typeof globalThis.fetch !== 'function') {
      return;
    }

    const originalFetch = globalThis.fetch;
    const wrappedFetch: typeof fetch = async (...args) => {
      const requestMeta = getRequestMeta(args);
      setActiveRequestCount((count) => count + 1);
      try {
        const response = await originalFetch(...args);
        if (!response.ok) {
          void captureHttpError(response, requestMeta)
            .then((message) => {
              setLastError({
                id: Date.now() + Math.floor(Math.random() * 1000),
                timestamp: Date.now(),
                status: response.status,
                method: requestMeta.method,
                url: requestMeta.url,
                message
              });
            })
            .catch(() => {
              setLastError({
                id: Date.now() + Math.floor(Math.random() * 1000),
                timestamp: Date.now(),
                status: response.status,
                method: requestMeta.method,
                url: requestMeta.url,
                message: response.statusText || `HTTP ${response.status}`
              });
            });
        }
        return response;
      } catch (error) {
        setLastError({
          id: Date.now() + Math.floor(Math.random() * 1000),
          timestamp: Date.now(),
          method: requestMeta.method,
          url: requestMeta.url,
          message: error instanceof Error ? error.message : 'Network request failed'
        });
        throw error;
      } finally {
        setActiveRequestCount((count) => Math.max(0, count - 1));
      }
    };

    globalThis.fetch = wrappedFetch;
    return () => {
      globalThis.fetch = originalFetch;
    };
  }, []);

  return {
    activeRequestCount,
    isNetworkBusy: activeRequestCount > 0,
    lastError,
    dismissLastError: () => setLastError(null)
  };
}

type RequestMeta = {
  method?: string;
  url?: string;
};

function getRequestMeta(args: Parameters<typeof fetch>): RequestMeta {
  const [input, init] = args;
  const method = (init?.method ?? (isRequestLike(input) ? input.method : undefined) ?? 'GET').toUpperCase();
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
    ? input.toString()
    : isRequestLike(input)
    ? input.url
    : undefined;

  return { method, url };
}

async function captureHttpError(response: Response, meta: RequestMeta): Promise<string> {
  const bodyText = await safeReadCloneText(response);
  const parsedMessage = parseApiErrorMessage(bodyText);
  const urlLabel = meta.url ? simplifyUrl(meta.url) : null;
  const statusPrefix = `HTTP ${response.status}`;
  const message = parsedMessage ?? (response.statusText || statusPrefix);
  const pieces = [statusPrefix, message];
  if (urlLabel) {
    pieces.push(urlLabel);
  }
  return pieces.join(' - ');
}

async function safeReadCloneText(response: Response): Promise<string | null> {
  try {
    const clone = response.clone();
    const text = await clone.text();
    return text.trim().length > 0 ? text : null;
  } catch {
    return null;
  }
}

function simplifyUrl(value: string): string {
  try {
    const url = new URL(value, window.location.origin);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return value;
  }
}

function isRequestLike(value: unknown): value is Request {
  return typeof Request !== 'undefined' && value instanceof Request;
}
