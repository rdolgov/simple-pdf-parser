import { describe, expect, it, vi } from 'vitest';

import { EmbeddingAPI } from '../src/query/embeddingApi';

describe('EmbeddingAPI', () => {
  it('follows async proxy polling for OpenAI embedding requests', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/jobs/job-embed-1')) {
        return new Response(JSON.stringify({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
          model: 'text-embedding-3-small'
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }

      return new Response(JSON.stringify({
        jobId: 'job-embed-1',
        status: 'pending',
        pollUrl: '/proxy/api/llm/jobs/job-embed-1',
        retryAfterMs: 1
      }), {
        status: 202,
        headers: {
          'Content-Type': 'application/json',
          Location: '/proxy/api/llm/jobs/job-embed-1',
          'Retry-After': '0.001'
        }
      });
    });

    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', fetchMock);

    try {
      const api = new EmbeddingAPI({
        provider: 'openai',
        apiKey: 'proxy-token',
        endpoint: 'http://localhost:8787/proxy/api/llm/openai'
      });

      const result = await api.generateEmbedding({
        input: 'hello'
      });

      expect(result.embeddings).toEqual([[0.1, 0.2, 0.3]]);
      expect(result.model).toBe('text-embedding-3-small');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });
});
