import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GEMINI_BINARY_INPUT_MODEL,
  DEFAULT_GEMINI_TEXT_MODEL,
  resolveGeminiBinaryInputModel,
  resolveGeminiTextModel
} from '../src/query/geminiModelSelection';

describe('geminiModelSelection', () => {
  it('uses the text default for empty or OpenAI-like text settings', () => {
    expect(resolveGeminiTextModel()).toBe(DEFAULT_GEMINI_TEXT_MODEL);
    expect(resolveGeminiTextModel('')).toBe(DEFAULT_GEMINI_TEXT_MODEL);
    expect(resolveGeminiTextModel('gpt-5.2')).toBe(DEFAULT_GEMINI_TEXT_MODEL);
  });

  it('routes binary inputs to the binary Gemini model by default', () => {
    expect(resolveGeminiBinaryInputModel()).toBe(DEFAULT_GEMINI_BINARY_INPUT_MODEL);
    expect(resolveGeminiBinaryInputModel('')).toBe(DEFAULT_GEMINI_BINARY_INPUT_MODEL);
    expect(resolveGeminiBinaryInputModel('gemini-3-pro-preview')).toBe(DEFAULT_GEMINI_BINARY_INPUT_MODEL);
    expect(resolveGeminiBinaryInputModel('gpt-5.2')).toBe(DEFAULT_GEMINI_BINARY_INPUT_MODEL);
  });

  it('keeps explicit Gemini binary-capable model names', () => {
    expect(resolveGeminiBinaryInputModel('gemini-3-pro-image-preview')).toBe('gemini-3-pro-image-preview');
    expect(resolveGeminiBinaryInputModel('models/gemini-3-pro-image-preview')).toBe('models/gemini-3-pro-image-preview');
  });
});
