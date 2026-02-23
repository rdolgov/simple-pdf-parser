import type { StructuredExtractProvider } from 'pdf-layout-parser';
import { canUseLocalStorage } from './storage';

export type RewriteProvider = StructuredExtractProvider;

export const REWRITE_PROVIDER_STORAGE_KEY = 'rewrite-provider';

export const REWRITE_PROVIDER_API_KEY_STORAGE_KEYS: Record<RewriteProvider, readonly string[]> = {
  gemini: ['rewrite-gemini-api-key', 'gemini-overlay-api-key', 'gemini-api-key'],
  openai: ['rewrite-openai-api-key', 'openai-api-key', 'openai-overlay-api-key']
} as const;

export const REWRITE_PROVIDER_MODEL_STORAGE_KEYS: Record<RewriteProvider, string> = {
  gemini: 'rewrite-gemini-model',
  openai: 'rewrite-openai-model'
} as const;

export type RewriteProviderStoredSettings = {
  provider: RewriteProvider;
  geminiApiKey: string;
  openaiApiKey: string;
  geminiModel: string;
  openaiModel: string;
};

export function loadRewriteProviderStoredSettings(): RewriteProviderStoredSettings {
  return {
    provider: getRewriteProvider(),
    geminiApiKey: getRewriteApiKey('gemini') ?? '',
    openaiApiKey: getRewriteApiKey('openai') ?? '',
    geminiModel: getRewriteModel('gemini') ?? '',
    openaiModel: getRewriteModel('openai') ?? ''
  };
}

export function getRewriteProvider(): RewriteProvider {
  if (!canUseLocalStorage()) {
    return 'gemini';
  }
  try {
    const raw = window.localStorage.getItem(REWRITE_PROVIDER_STORAGE_KEY)?.trim().toLowerCase();
    return raw === 'openai' ? 'openai' : 'gemini';
  } catch {
    return 'gemini';
  }
}

export function setRewriteProvider(provider: RewriteProvider): void {
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(REWRITE_PROVIDER_STORAGE_KEY, provider);
  } catch {
    // Ignore storage issues.
  }
}

export function getRewriteApiKey(provider: RewriteProvider): string | null {
  if (!canUseLocalStorage()) {
    return null;
  }
  for (const key of REWRITE_PROVIDER_API_KEY_STORAGE_KEYS[provider]) {
    try {
      const value = window.localStorage.getItem(key)?.trim();
      if (value) {
        return value;
      }
    } catch {
      // Ignore storage issues.
    }
  }
  return null;
}

export function setRewriteApiKey(provider: RewriteProvider, value: string): void {
  if (!canUseLocalStorage()) {
    return;
  }
  const normalized = value.trim();
  try {
    const key = REWRITE_PROVIDER_API_KEY_STORAGE_KEYS[provider][0];
    if (normalized.length > 0) {
      window.localStorage.setItem(key, normalized);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage issues.
  }
}

export function getRewriteModel(provider: RewriteProvider): string | null {
  if (!canUseLocalStorage()) {
    return null;
  }
  try {
    const value = window.localStorage.getItem(REWRITE_PROVIDER_MODEL_STORAGE_KEYS[provider])?.trim();
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function setRewriteModel(provider: RewriteProvider, value: string): void {
  if (!canUseLocalStorage()) {
    return;
  }
  const normalized = value.trim();
  try {
    const key = REWRITE_PROVIDER_MODEL_STORAGE_KEYS[provider];
    if (normalized.length > 0) {
      window.localStorage.setItem(key, normalized);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage issues.
  }
}
