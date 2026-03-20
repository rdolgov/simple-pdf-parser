import { beforeEach, describe, expect, it } from 'vitest';

import { loadAiLayoutRuntimeSettings } from '../testApp/src/utils/aiLayoutSettings';

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

describe('ai layout runtime settings', () => {
  beforeEach(() => {
    installWindow();
  });

  it('reads provider, key, and model from structured extract settings instead of rewrite settings', () => {
    window.localStorage.setItem('rewrite-provider', 'codex');
    window.localStorage.setItem('codex-api-key', 'proxy-token');
    window.localStorage.setItem('rewrite-codex-model', 'gpt-5-codex');
    window.localStorage.setItem('structured-extract-provider', 'gemini');
    window.localStorage.setItem('gemini-overlay-api-key', 'gemini-key');
    window.localStorage.setItem('structured-extract-gemini-model', 'gemini-3-pro-preview');

    const settings = loadAiLayoutRuntimeSettings();

    expect(settings).toEqual({
      provider: 'gemini',
      apiKey: 'gemini-key',
      model: 'gemini-3-pro-preview'
    });
  });
});
