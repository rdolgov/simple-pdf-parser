import { describe, expect, it, vi } from 'vitest';

import { OpenAiAPI } from '../src/query/openAiApi';

describe('OpenAiAPI', () => {
  it('follows async proxy polling for proxy responses endpoints', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/jobs/job-openai-1')) {
        return new Response(JSON.stringify({
          output_text: 'proxy result',
          model: 'gpt-5.2'
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }

      return new Response(JSON.stringify({
        jobId: 'job-openai-1',
        status: 'pending',
        pollUrl: '/proxy/api/llm/jobs/job-openai-1',
        retryAfterMs: 1
      }), {
        status: 202,
        headers: {
          'Content-Type': 'application/json',
          Location: '/proxy/api/llm/jobs/job-openai-1',
          'Retry-After': '0.001'
        }
      });
    });

    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', fetchMock);

    try {
      const client = new OpenAiAPI({
        apiKey: 'proxy-token',
        endpoint: 'http://localhost:8787/proxy/api/llm/openai'
      });

      const result = await client.generateText('Hello');
      expect(result.text).toBe('proxy result');
      expect(result.model).toBe('gpt-5.2');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });
});
