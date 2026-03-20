import { beforeEach, describe, expect, it } from 'vitest';

import { getRewriteProvider } from '../testApp/src/utils/rewriteProviderSettings';
import { getStructuredExtractProvider } from '../testApp/src/utils/structuredExtractSettings';
import { getSemanticSearchProvider } from '../testApp/src/utils/semanticSearchSettings';

function installWindow(): void {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        }
      }
    }
  });
}

describe('provider settings migration', () => {
  beforeEach(() => {
    installWindow();
  });

  it('migrates legacy provider preferences to Gemini defaults once', () => {
    window.localStorage.setItem('rewrite-provider', 'codex');
    window.localStorage.setItem('structured-extract-provider', 'openai');
    window.localStorage.setItem('semantic-search-provider', 'openai');

    expect(getRewriteProvider()).toBe('gemini');
    expect(getStructuredExtractProvider()).toBe('gemini');
    expect(getSemanticSearchProvider()).toBe('gemini');
  });

  it('keeps the migrated values stable on later reads', () => {
    expect(getRewriteProvider()).toBe('gemini');

    window.localStorage.setItem('rewrite-provider', 'openai');

    expect(getRewriteProvider()).toBe('openai');
  });
});
