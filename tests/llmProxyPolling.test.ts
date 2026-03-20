import { describe, expect, it, vi } from 'vitest';

import { fetchWithLlmProxyPolling } from '../src/query/llmProxyPolling';

describe('fetchWithLlmProxyPolling', () => {
  it('follows async proxy polling until the final response is ready', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/jobs/job-1')) {
        if ((fetchMock.mock.calls.length ?? 0) === 2) {
          return new Response(JSON.stringify({
            jobId: 'job-1',
            status: 'running',
            pollUrl: '/proxy/api/llm/jobs/job-1',
            retryAfterMs: 1
          }), {
            status: 202,
            headers: {
              'Content-Type': 'application/json',
              Location: '/proxy/api/llm/jobs/job-1',
              'Retry-After': '0.001'
            }
          });
        }

        return new Response(JSON.stringify({ text: 'final answer' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }

      expect(new Headers(init?.headers).get('X-LLM-Proxy-Async')).toBe('poll');
      return new Response(JSON.stringify({
        jobId: 'job-1',
        status: 'pending',
        pollUrl: '/proxy/api/llm/jobs/job-1',
        retryAfterMs: 1
      }), {
        status: 202,
        headers: {
          'Content-Type': 'application/json',
          Location: '/proxy/api/llm/jobs/job-1',
          'Retry-After': '0.001'
        }
      });
    });

    const response = await fetchWithLlmProxyPolling(fetchMock as unknown as typeof fetch, 'http://localhost:8787/proxy/api/llm/gemini/v1beta/models/gemini-3-pro-preview:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer proxy-token'
      },
      body: JSON.stringify({ prompt: 'hello' })
    }, {
      timeoutMs: 1000
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ text: 'final answer' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'GET'
    });
  });

  it('passes through non-proxy requests without adding async polling', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    }));

    const response = await fetchWithLlmProxyPolling(fetchMock as unknown as typeof fetch, 'https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer real-token'
      }
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('X-LLM-Proxy-Async')).toBeNull();
  });
});
