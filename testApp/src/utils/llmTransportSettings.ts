import { canUseLocalStorage } from './storage';
import { getDefaultProxyApiBaseUrl, getForcedLlmTransportMode } from './proxyRoute';

export type LlmTransportMode = 'direct' | 'proxy';

export type LlmTransportStoredSettings = {
  mode: LlmTransportMode;
  proxyBaseUrl: string;
  proxyAuthToken: string;
};

export const LLM_TRANSPORT_MODE_STORAGE_KEY = 'llm-transport-mode';
export const LLM_PROXY_BASE_URL_STORAGE_KEY = 'llm-proxy-base-url';
export const LLM_PROXY_AUTH_TOKEN_STORAGE_KEY = 'llm-proxy-auth-token';

export const DEFAULT_LLM_PROXY_BASE_URL = '/api/llm';
export const DEFAULT_PROXY_RUNTIME_TOKEN = 'proxy-no-auth-required';

export function loadLlmTransportStoredSettings(): LlmTransportStoredSettings {
  return {
    mode: getLlmTransportMode(),
    proxyBaseUrl: getLlmProxyBaseUrl(),
    proxyAuthToken: getLlmProxyAuthToken() ?? ''
  };
}

export function getLlmTransportMode(): LlmTransportMode {
  const forcedMode = getForcedLlmTransportMode();
  if (forcedMode) {
    return forcedMode;
  }
  const envValue = normalizeMode(readEnvValue('VITE_LLM_TRANSPORT_MODE'));
  const storedValue = normalizeMode(readStorageValue(LLM_TRANSPORT_MODE_STORAGE_KEY));
  return storedValue ?? envValue ?? 'direct';
}

export function setLlmTransportMode(mode: LlmTransportMode): void {
  if (getForcedLlmTransportMode()) {
    return;
  }
  writeStorageValue(LLM_TRANSPORT_MODE_STORAGE_KEY, mode);
}

export function isProxyTransportEnabled(): boolean {
  return getLlmTransportMode() === 'proxy';
}

export function getLlmProxyBaseUrl(): string {
  if (getForcedLlmTransportMode() === 'proxy') {
    const envValue = normalizeNonEmpty(readEnvValue('VITE_LLM_PROXY_BASE_URL'));
    return envValue ?? getDefaultProxyApiBaseUrl();
  }
  const envValue = normalizeNonEmpty(readEnvValue('VITE_LLM_PROXY_BASE_URL'));
  const storedValue = normalizeNonEmpty(readStorageValue(LLM_PROXY_BASE_URL_STORAGE_KEY));
  return storedValue ?? envValue ?? getDefaultProxyApiBaseUrl() ?? DEFAULT_LLM_PROXY_BASE_URL;
}

export function setLlmProxyBaseUrl(value: string): void {
  if (getForcedLlmTransportMode()) {
    return;
  }
  writeStorageValue(LLM_PROXY_BASE_URL_STORAGE_KEY, value);
}

export function getLlmProxyAuthToken(): string | null {
  const envValue = normalizeNonEmpty(readEnvValue('VITE_LLM_PROXY_AUTH_TOKEN'));
  const storedValue = normalizeNonEmpty(readStorageValue(LLM_PROXY_AUTH_TOKEN_STORAGE_KEY));
  return storedValue ?? envValue ?? null;
}

export function setLlmProxyAuthToken(value: string): void {
  writeStorageValue(LLM_PROXY_AUTH_TOKEN_STORAGE_KEY, value);
}

function normalizeMode(value: string | null | undefined): LlmTransportMode | undefined {
  const normalized = normalizeNonEmpty(value)?.toLowerCase();
  if (normalized === 'proxy') {
    return 'proxy';
  }
  if (normalized === 'direct') {
    return 'direct';
  }
  return undefined;
}

function normalizeNonEmpty(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readStorageValue(key: string): string | null {
  if (!canUseLocalStorage()) {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: string): void {
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    const normalized = value.trim();
    if (normalized.length > 0) {
      window.localStorage.setItem(key, normalized);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage access issues.
  }
}

function readEnvValue(key: string): string | undefined {
  const meta = import.meta as ImportMeta & {
    env?: Record<string, string | boolean | undefined>;
  };
  const candidate = meta.env?.[key];
  return typeof candidate === 'string' ? candidate : undefined;
}
