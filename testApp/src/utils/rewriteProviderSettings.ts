import type { StructuredExtractProvider } from 'pdf-layout-parser';
import { DEFAULT_TEXT_PROVIDER, normalizeTextProvider } from './providerDefaults';
import { ensureGeminiProviderDefaults } from './providerSettingsMigration';
import { canUseLocalStorage } from './storage';

export type RewriteProvider = StructuredExtractProvider;

export const REWRITE_PROVIDER_STORAGE_KEY = 'rewrite-provider';

export const REWRITE_PROVIDER_MODEL_STORAGE_KEYS: Record<RewriteProvider, string> = {
  gemini: 'rewrite-gemini-model',
  openai: 'rewrite-openai-model',
  codex: 'rewrite-codex-model'
} as const;

export type RewriteProviderStoredSettings = {
  provider: RewriteProvider;
  geminiModel: string;
  openaiModel: string;
  codexModel: string;
};

export function loadRewriteProviderStoredSettings(): RewriteProviderStoredSettings {
  return {
    provider: getRewriteProvider(),
    geminiModel: getRewriteModel('gemini') ?? '',
    openaiModel: getRewriteModel('openai') ?? '',
    codexModel: getRewriteModel('codex') ?? ''
  };
}

export function getRewriteProvider(): RewriteProvider {
  ensureGeminiProviderDefaults();
  if (!canUseLocalStorage()) {
    return DEFAULT_TEXT_PROVIDER;
  }
  try {
    const raw = window.localStorage.getItem(REWRITE_PROVIDER_STORAGE_KEY)?.trim().toLowerCase();
    return normalizeTextProvider(raw);
  } catch {
    return DEFAULT_TEXT_PROVIDER;
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
