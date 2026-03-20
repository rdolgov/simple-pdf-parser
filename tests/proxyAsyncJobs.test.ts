import { describe, expect, it } from 'vitest';

import { ProxyAsyncJobStore } from '../server/src/proxyAsyncJobs';

describe('ProxyAsyncJobStore', () => {
  it('reuses inflight jobs for identical dedupe keys', () => {
    const store = new ProxyAsyncJobStore({
      retentionMs: 60_000,
      maxJobs: 100,
      pollIntervalMs: 1_500
    });

    const first = store.createOrReuse({
      provider: 'gemini',
      requestKind: 'generateContent',
      cacheKey: 'cache-1',
      bodyHash: 'body-1',
      cacheStatus: 'MISS',
      sequence: 1
    });
    const second = store.createOrReuse({
      provider: 'gemini',
      requestKind: 'generateContent',
      cacheKey: 'cache-1',
      bodyHash: 'body-1',
      cacheStatus: 'MISS',
      sequence: 2
    });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.job.id).toBe(first.job.id);
  });

  it('stores the final response and marks failures when status is non-2xx', () => {
    const store = new ProxyAsyncJobStore({
      retentionMs: 60_000,
      maxJobs: 100,
      pollIntervalMs: 1_500
    });

    const created = store.createOrReuse({
      provider: 'codex',
      requestKind: 'responses',
      cacheKey: 'cache-2',
      bodyHash: 'body-2',
      cacheStatus: 'BYPASS',
      sequence: 9
    });

    store.markRunning(created.job.id, 'starting');
    store.appendEvent(created.job.id, 'processing');
    store.complete(created.job.id, {
      status: 502,
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: Buffer.from(JSON.stringify({ error: 'upstream failed' }), 'utf8')
    });

    const snapshot = store.get(created.job.id);
    const response = store.getResponse(created.job.id);
    expect(snapshot?.state).toBe('failed');
    expect(snapshot?.lastEvent).toBe('processing');
    expect(response?.status).toBe(502);
    expect(response?.body.toString('utf8')).toContain('upstream failed');
  });
});
