import type { StructuredExtractProvider } from 'pdf-layout-parser';
import { canUseLocalStorage } from './storage';

export const STRUCTURED_EXTRACT_PROVIDER_STORAGE_KEY = 'structured-extract-provider';

export const STRUCTURED_EXTRACT_PROVIDER_API_KEY_STORAGE_KEYS: Record<StructuredExtractProvider, readonly string[]> = {
  gemini: ['gemini-overlay-api-key', 'gemini-api-key'],
  openai: ['openai-api-key', 'openai-overlay-api-key']
} as const;

export const STRUCTURED_EXTRACT_PROVIDER_MODEL_STORAGE_KEYS: Record<StructuredExtractProvider, string> = {
  gemini: 'structured-extract-gemini-model',
  openai: 'structured-extract-openai-model'
} as const;

export type StructuredExtractStoredSettings = {
  provider: StructuredExtractProvider;
  geminiApiKey: string;
  openaiApiKey: string;
  geminiModel: string;
  openaiModel: string;
};

export function loadStructuredExtractStoredSettings(): StructuredExtractStoredSettings {
  return {
    provider: getStructuredExtractProvider(),
    geminiApiKey: getStructuredExtractApiKey('gemini') ?? '',
    openaiApiKey: getStructuredExtractApiKey('openai') ?? '',
    geminiModel: getStructuredExtractModel('gemini') ?? '',
    openaiModel: getStructuredExtractModel('openai') ?? ''
  };
}

export function getStructuredExtractProvider(): StructuredExtractProvider {
  if (!canUseLocalStorage()) {
    return 'gemini';
  }
  try {
    const raw = window.localStorage.getItem(STRUCTURED_EXTRACT_PROVIDER_STORAGE_KEY)?.trim().toLowerCase();
    return raw === 'openai' ? 'openai' : 'gemini';
  } catch {
    return 'gemini';
  }
}

export function setStructuredExtractProvider(provider: StructuredExtractProvider): void {
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(STRUCTURED_EXTRACT_PROVIDER_STORAGE_KEY, provider);
  } catch {
    // Ignore storage access issues.
  }
}

export function getStructuredExtractApiKey(provider: StructuredExtractProvider): string | null {
  if (!canUseLocalStorage()) {
    return null;
  }
  for (const key of STRUCTURED_EXTRACT_PROVIDER_API_KEY_STORAGE_KEYS[provider]) {
    try {
      const value = window.localStorage.getItem(key)?.trim();
      if (value) {
        return value;
      }
    } catch {
      // Ignore storage access issues.
    }
  }
  return null;
}

export function setStructuredExtractApiKey(provider: StructuredExtractProvider, value: string): void {
  if (!canUseLocalStorage()) {
    return;
  }
  const normalized = value.trim();
  try {
    const primaryKey = STRUCTURED_EXTRACT_PROVIDER_API_KEY_STORAGE_KEYS[provider][0];
    if (normalized.length > 0) {
      window.localStorage.setItem(primaryKey, normalized);
    } else {
      window.localStorage.removeItem(primaryKey);
    }
  } catch {
    // Ignore storage access issues.
  }
}

export function getStructuredExtractModel(provider: StructuredExtractProvider): string | null {
  if (!canUseLocalStorage()) {
    return null;
  }
  try {
    const value = window.localStorage.getItem(STRUCTURED_EXTRACT_PROVIDER_MODEL_STORAGE_KEYS[provider])?.trim();
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function setStructuredExtractModel(provider: StructuredExtractProvider, value: string): void {
  if (!canUseLocalStorage()) {
    return;
  }
  const normalized = value.trim();
  try {
    const key = STRUCTURED_EXTRACT_PROVIDER_MODEL_STORAGE_KEYS[provider];
    if (normalized.length > 0) {
      window.localStorage.setItem(key, normalized);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage access issues.
  }
}
