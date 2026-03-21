import { describe, expect, it, vi } from 'vitest';

import { GeminiAPI } from '../src/query/geminiApi';
import { DEFAULT_GEMINI_BINARY_INPUT_MODEL } from '../src/query/geminiModelSelection';

describe('GeminiAPI', () => {
  it('does not send mediaResolution inside inlineData for REST image prompts', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null;
      return {
        ok: true,
        json: async () => ({
          text: 'ok',
          candidates: [
            {
              content: {
                parts: [{ text: 'ok' }]
              }
            }
          ],
          requestBody: body
        }),
        text: async () => 'ok'
      } as unknown as Response;
    });

    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', fetchMock);

    try {
      const client = new GeminiAPI({
        apiKey: 'test-key',
        endpoint: 'http://localhost:8787/proxy/api/llm/gemini'
      });

      await client.generateFromImage('aGVsbG8=', 'image/png', 'Explain this', {
        mediaResolution: 'high'
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const request = fetchMock.mock.calls[0]?.[1];
      const body = typeof request?.body === 'string' ? JSON.parse(request.body) as any : null;
      expect(body.contents[0].parts[1].inlineData).toEqual({
        mimeType: 'image/png',
        data: 'aGVsbG8='
      });
      expect(body.contents[0].parts[1].inlineData.mediaResolution).toBeUndefined();
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('uses the Gemini binary-input model by default for REST image prompts', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => {
      return {
        ok: true,
        json: async () => ({
          text: 'ok',
          candidates: [
            {
              content: {
                parts: [{ text: 'ok' }]
              }
            }
          ]
        }),
        text: async () => 'ok'
      } as unknown as Response;
    });

    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', fetchMock);

    try {
      const client = new GeminiAPI({
        apiKey: 'test-key',
        model: 'gemini-3-pro-preview',
        endpoint: 'http://localhost:8787/proxy/api/llm/gemini'
      });

      await client.generateFromImage('aGVsbG8=', 'image/png', 'Explain this');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
      expect(requestUrl).toContain(`/models/${encodeURIComponent(DEFAULT_GEMINI_BINARY_INPUT_MODEL)}:generateContent`);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('includes a compact response summary when Gemini returns no text content', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => {
      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              finishReason: 'SAFETY',
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'application/pdf',
                      data: 'cGRm'
                    }
                  }
                ]
              }
            }
          ],
          promptFeedback: {
            blockReason: 'SAFETY'
          }
        }),
        text: async () => 'ok'
      } as unknown as Response;
    });

    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', fetchMock);

    try {
      const client = new GeminiAPI({
        apiKey: 'test-key',
        endpoint: 'http://localhost:8787/proxy/api/llm/gemini',
        model: 'gemini-3-pro-image-preview'
      });

      await expect(client.generateText('extract this pdf')).rejects.toThrow(
        /Gemini response did not include text content \(model=gemini-3-pro-image-preview; .*candidateSummary=SAFETY:inline:application\/pdf.*promptFeedback=blockReason=SAFETY\)/
      );
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });
});
