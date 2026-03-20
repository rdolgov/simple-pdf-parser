import { canUseLocalStorage } from './storage';

const PROVIDER_SETTINGS_MIGRATION_KEY = 'llm-provider-defaults-migration';
const PROVIDER_SETTINGS_MIGRATION_VERSION = 'gemini-default-v1';

const PROVIDER_STORAGE_KEYS = [
  'rewrite-provider',
  'structured-extract-provider',
  'semantic-search-provider'
] as const;

export function ensureGeminiProviderDefaults(): void {
  if (!canUseLocalStorage()) {
    return;
  }

  try {
    const completedVersion = window.localStorage.getItem(PROVIDER_SETTINGS_MIGRATION_KEY);
    if (completedVersion === PROVIDER_SETTINGS_MIGRATION_VERSION) {
      return;
    }

    for (const key of PROVIDER_STORAGE_KEYS) {
      window.localStorage.setItem(key, 'gemini');
    }

    window.localStorage.setItem(PROVIDER_SETTINGS_MIGRATION_KEY, PROVIDER_SETTINGS_MIGRATION_VERSION);
  } catch {
    // Ignore storage access issues.
  }
}
