import { describe, expect, it, vi } from 'vitest';

vi.mock('pdf-layout-parser', async () => import('../src/index.js'));

import {
  getProviderDisplayName,
  resolveImageCapableProvider,
  usesGeminiImageFallback
} from '../testApp/src/utils/providerMetadata';

describe('providerMetadata', () => {
  it('maps codex image requests to gemini', () => {
    expect(resolveImageCapableProvider('codex')).toBe('gemini');
    expect(usesGeminiImageFallback('codex')).toBe(true);
  });

  it('keeps native image-capable providers unchanged', () => {
    expect(resolveImageCapableProvider('gemini')).toBe('gemini');
    expect(resolveImageCapableProvider('openai')).toBe('openai');
    expect(usesGeminiImageFallback('gemini')).toBe(false);
    expect(usesGeminiImageFallback('openai')).toBe(false);
  });

  it('returns user-facing provider names', () => {
    expect(getProviderDisplayName('codex')).toBe('Codex');
    expect(getProviderDisplayName('gemini')).toBe('Gemini');
  });
});
