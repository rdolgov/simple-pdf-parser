import type { StructuredExtractProvider } from 'pdf-layout-parser';
import { DEFAULT_TEXT_PROVIDER, normalizeTextProvider } from './providerDefaults';
import { ensureGeminiProviderDefaults } from './providerSettingsMigration';
import { canUseLocalStorage } from './storage';

export const STRUCTURED_EXTRACT_PROVIDER_STORAGE_KEY = 'structured-extract-provider';
export const STRUCTURED_EXTRACT_SETTINGS_CHANGED_EVENT = 'structured-extract-settings-changed';

export const STRUCTURED_EXTRACT_PROVIDER_MODEL_STORAGE_KEYS: Record<StructuredExtractProvider, string> = {
  gemini: 'structured-extract-gemini-model',
  openai: 'structured-extract-openai-model',
  codex: 'structured-extract-codex-model'
} as const;

export type StructuredExtractStoredSettings = {
  provider: StructuredExtractProvider;
  geminiModel: string;
  openaiModel: string;
  codexModel: string;
};

export function loadStructuredExtractStoredSettings(): StructuredExtractStoredSettings {
  return {
    provider: getStructuredExtractProvider(),
    geminiModel: getStructuredExtractModel('gemini') ?? '',
    openaiModel: getStructuredExtractModel('openai') ?? '',
    codexModel: getStructuredExtractModel('codex') ?? ''
  };
}

export function getStructuredExtractProvider(): StructuredExtractProvider {
  ensureGeminiProviderDefaults();
  if (!canUseLocalStorage()) {
    return DEFAULT_TEXT_PROVIDER;
  }
  try {
    const raw = window.localStorage.getItem(STRUCTURED_EXTRACT_PROVIDER_STORAGE_KEY)?.trim().toLowerCase();
    return normalizeTextProvider(raw);
  } catch {
    return DEFAULT_TEXT_PROVIDER;
  }
}

export function setStructuredExtractProvider(provider: StructuredExtractProvider): void {
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(STRUCTURED_EXTRACT_PROVIDER_STORAGE_KEY, provider);
    dispatchStructuredExtractSettingsChanged();
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
    dispatchStructuredExtractSettingsChanged();
  } catch {
    // Ignore storage access issues.
  }
}

function dispatchStructuredExtractSettingsChanged(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(STRUCTURED_EXTRACT_SETTINGS_CHANGED_EVENT));
}
