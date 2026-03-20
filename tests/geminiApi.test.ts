import { describe, expect, it, vi } from 'vitest';

import { GeminiAPI } from '../src/query/geminiApi';

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
});
