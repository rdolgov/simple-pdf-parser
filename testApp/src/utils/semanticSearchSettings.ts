import type { EmbeddingProvider } from 'pdf-layout-parser';
import { DEFAULT_SEMANTIC_SEARCH_PROVIDER, normalizeSemanticSearchProvider } from './providerDefaults';
import { ensureGeminiProviderDefaults } from './providerSettingsMigration';
import { canUseLocalStorage } from './storage';

export type SemanticSearchProvider = Extract<EmbeddingProvider, 'gemini' | 'openai'>;

export const SEMANTIC_SEARCH_PROVIDER_STORAGE_KEY = 'semantic-search-provider';

export const SEMANTIC_SEARCH_PROVIDER_API_KEY_STORAGE_KEYS: Record<SemanticSearchProvider, readonly string[]> = {
  gemini: ['semantic-search-gemini-api-key', 'gemini-overlay-api-key', 'gemini-api-key'],
  openai: ['semantic-search-openai-api-key', 'openai-api-key', 'openai-overlay-api-key']
} as const;

export const SEMANTIC_SEARCH_PROVIDER_MODEL_STORAGE_KEYS: Record<SemanticSearchProvider, string> = {
  gemini: 'semantic-search-gemini-model',
  openai: 'semantic-search-openai-model'
} as const;

export type SemanticSearchStoredSettings = {
  provider: SemanticSearchProvider;
  geminiApiKey: string;
  openaiApiKey: string;
  geminiModel: string;
  openaiModel: string;
};

export function loadSemanticSearchStoredSettings(): SemanticSearchStoredSettings {
  return {
    provider: getSemanticSearchProvider(),
    geminiApiKey: getSemanticSearchApiKey('gemini') ?? '',
    openaiApiKey: getSemanticSearchApiKey('openai') ?? '',
    geminiModel: getSemanticSearchModel('gemini') ?? '',
    openaiModel: getSemanticSearchModel('openai') ?? ''
  };
}

export function getSemanticSearchProvider(): SemanticSearchProvider {
  ensureGeminiProviderDefaults();
  if (!canUseLocalStorage()) {
    return DEFAULT_SEMANTIC_SEARCH_PROVIDER;
  }
  try {
    const raw = window.localStorage.getItem(SEMANTIC_SEARCH_PROVIDER_STORAGE_KEY)?.trim().toLowerCase();
    return normalizeSemanticSearchProvider(raw);
  } catch {
    return DEFAULT_SEMANTIC_SEARCH_PROVIDER;
  }
}

export function setSemanticSearchProvider(provider: SemanticSearchProvider): void {
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(SEMANTIC_SEARCH_PROVIDER_STORAGE_KEY, provider);
  } catch {
    // Ignore storage access issues.
  }
}

export function getSemanticSearchApiKey(provider: SemanticSearchProvider): string | null {
  if (!canUseLocalStorage()) {
    return null;
  }
  for (const key of SEMANTIC_SEARCH_PROVIDER_API_KEY_STORAGE_KEYS[provider]) {
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

export function setSemanticSearchApiKey(provider: SemanticSearchProvider, value: string): void {
  if (!canUseLocalStorage()) {
    return;
  }
  const normalized = value.trim();
  try {
    const primaryKey = SEMANTIC_SEARCH_PROVIDER_API_KEY_STORAGE_KEYS[provider][0];
    if (normalized.length > 0) {
      window.localStorage.setItem(primaryKey, normalized);
    } else {
      window.localStorage.removeItem(primaryKey);
    }
  } catch {
    // Ignore storage access issues.
  }
}

export function getSemanticSearchModel(provider: SemanticSearchProvider): string | null {
  if (!canUseLocalStorage()) {
    return null;
  }
  try {
    const value = window.localStorage.getItem(SEMANTIC_SEARCH_PROVIDER_MODEL_STORAGE_KEYS[provider])?.trim();
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function setSemanticSearchModel(provider: SemanticSearchProvider, value: string): void {
  if (!canUseLocalStorage()) {
    return;
  }
  const normalized = value.trim();
  try {
    const key = SEMANTIC_SEARCH_PROVIDER_MODEL_STORAGE_KEYS[provider];
    if (normalized.length > 0) {
      window.localStorage.setItem(key, normalized);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage access issues.
  }
}
