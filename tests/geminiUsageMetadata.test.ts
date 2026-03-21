import { describe, expect, it } from 'vitest';

import { extractGeminiUsageMetadata } from '../server/src/geminiUsageMetadata.js';

describe('extractGeminiUsageMetadata', () => {
  it('extracts prompt and candidate token counts from a direct Gemini response payload', () => {
    const body = Buffer.from(JSON.stringify({
      usageMetadata: {
        promptTokenCount: 120,
        candidatesTokenCount: 45,
        totalTokenCount: 165
      }
    }), 'utf8');

    expect(extractGeminiUsageMetadata(body)).toEqual({
      inputTokens: 120,
      outputTokens: 45,
      totalTokens: 165
    });
  });

  it('extracts nested usage metadata and folds cached/thought tokens into input/output totals', () => {
    const body = Buffer.from(JSON.stringify({
      response: {
        usageMetadata: {
          promptTokenCount: 80,
          cachedContentTokenCount: 20,
          candidatesTokenCount: 30,
          thoughtsTokenCount: 10
        }
      }
    }), 'utf8');

    expect(extractGeminiUsageMetadata(body)).toEqual({
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140
    });
  });

  it('returns null when the response does not include Gemini usage metadata', () => {
    const body = Buffer.from(JSON.stringify({ text: 'ok' }), 'utf8');

    expect(extractGeminiUsageMetadata(body)).toBeNull();
  });
});
