import { canUseLocalStorage } from './storage';
import { getDefaultProxyApiBaseUrl } from './proxyRoute';

export type LlmTransportStoredSettings = {
  proxyBaseUrl: string;
  proxyAuthToken: string;
};

export const LLM_PROXY_BASE_URL_STORAGE_KEY = 'llm-proxy-base-url';
export const LLM_PROXY_AUTH_TOKEN_STORAGE_KEY = 'llm-proxy-auth-token';
export const LLM_TRANSPORT_SETTINGS_CHANGED_EVENT = 'llm-transport-settings-changed';

export const DEFAULT_LLM_PROXY_BASE_URL = '/api/tasks';
export const DEFAULT_PROXY_RUNTIME_TOKEN = 'proxy-no-auth-required';

export function loadLlmTransportStoredSettings(): LlmTransportStoredSettings {
  return {
    proxyBaseUrl: getLlmProxyBaseUrl(),
    proxyAuthToken: getLlmProxyAuthToken() ?? ''
  };
}

export function getLlmProxyBaseUrl(): string {
  const envValue = normalizeNonEmpty(readEnvValue('VITE_LLM_PROXY_BASE_URL'));
  const storedValue = normalizeNonEmpty(readStorageValue(LLM_PROXY_BASE_URL_STORAGE_KEY));
  return storedValue ?? envValue ?? getDefaultProxyApiBaseUrl() ?? DEFAULT_LLM_PROXY_BASE_URL;
}

export function setLlmProxyBaseUrl(value: string): void {
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
    dispatchLlmTransportSettingsChanged();
  } catch {
    // Ignore storage access issues.
  }
}

function dispatchLlmTransportSettingsChanged(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(LLM_TRANSPORT_SETTINGS_CHANGED_EVENT));
}

function readEnvValue(key: string): string | undefined {
  const meta = import.meta as ImportMeta & {
    env?: Record<string, string | boolean | undefined>;
  };
  const candidate = meta.env?.[key];
  return typeof candidate === 'string' ? candidate : undefined;
}
