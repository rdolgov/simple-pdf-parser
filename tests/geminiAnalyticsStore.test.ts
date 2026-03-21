import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { GeminiAnalyticsStore } from '../server/src/geminiAnalyticsStore.js';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe('GeminiAnalyticsStore', () => {
  it('records Gemini requests into daily totals and actor/model breakdowns', async () => {
    const store = await createStore();

    const started = await store.beginRequest({
      actor: 'vesperz',
      model: 'gemini-3-flash-preview',
      requestKind: 'generateContent',
      now: new Date('2026-03-20T10:00:00-07:00').getTime()
    });

    expect(started.allowed).toBe(true);
    if (!started.allowed) {
      return;
    }

    await store.finalizeRequest({
      reservationId: started.reservationId,
      status: 200,
      durationMs: 750,
      usage: {
        inputTokens: 120,
        outputTokens: 45,
        totalTokens: 165
      },
      now: new Date('2026-03-20T10:00:01-07:00').getTime()
    });

    const overview = await store.getOverview(new Date('2026-03-20T11:00:00-07:00').getTime());

    expect(overview.today.totals.calls).toBe(1);
    expect(overview.today.totals.totalTokens).toBe(165);
    expect(overview.today.actors.vesperz?.calls).toBe(1);
    expect(overview.today.models['gemini-3-flash-preview']?.totalTokens).toBe(165);
    expect(overview.today.recentRequests[0]?.status).toBe(200);
  });

  it('blocks new Gemini requests once the daily call limit has been reached', async () => {
    const store = await createStore({ dailyMaxCalls: 1, dailyMaxTotalTokens: 1_000_000 });
    const timestamp = new Date('2026-03-20T12:00:00-07:00').getTime();

    const first = await store.beginRequest({
      actor: 'vesperz',
      model: 'gemini-3-flash-preview',
      requestKind: 'generateContent',
      now: timestamp
    });
    expect(first.allowed).toBe(true);
    if (!first.allowed) {
      return;
    }

    await store.finalizeRequest({
      reservationId: first.reservationId,
      status: 200,
      durationMs: 400,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15
      },
      now: timestamp + 1_000
    });

    const blocked = await store.beginRequest({
      actor: 'vesperz',
      model: 'gemini-3-flash-preview',
      requestKind: 'generateContent',
      now: timestamp + 2_000
    });

    expect(blocked.allowed).toBe(false);
    if (blocked.allowed) {
      return;
    }

    expect(blocked.reason).toContain('Daily Gemini call limit reached');
    expect(blocked.snapshot.totals.blockedRequests).toBe(1);
    expect(blocked.snapshot.actors.vesperz?.blockedRequests).toBe(1);
  });

  it('persists state to disk so the server can restart without losing totals', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'gemini-analytics-store-'));
    tempDirs.push(dir);

    const timestamp = new Date('2026-03-20T13:00:00-07:00').getTime();
    const firstStore = new GeminiAnalyticsStore({
      dataDir: dir,
      retentionDays: 14,
      dailyMaxCalls: 1000,
      dailyMaxTotalTokens: 1_000_000
    });

    const started = await firstStore.beginRequest({
      actor: 'vesperz',
      model: 'gemini-3.1-pro-preview',
      requestKind: 'generateContent',
      now: timestamp
    });
    expect(started.allowed).toBe(true);
    if (!started.allowed) {
      return;
    }

    await firstStore.finalizeRequest({
      reservationId: started.reservationId,
      status: 200,
      durationMs: 900,
      usage: {
        inputTokens: 300,
        outputTokens: 100,
        totalTokens: 400
      },
      now: timestamp + 1_000
    });

    const secondStore = new GeminiAnalyticsStore({
      dataDir: dir,
      retentionDays: 14,
      dailyMaxCalls: 1000,
      dailyMaxTotalTokens: 1_000_000
    });
    const overview = await secondStore.getOverview(timestamp + 2_000);

    expect(overview.today.totals.calls).toBe(1);
    expect(overview.today.totals.totalTokens).toBe(400);
    expect(overview.today.models['gemini-3.1-pro-preview']?.calls).toBe(1);
  });
});

async function createStore(
  overrides: Partial<{
    dailyMaxCalls: number;
    dailyMaxTotalTokens: number;
  }> = {}
): Promise<GeminiAnalyticsStore> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gemini-analytics-store-'));
  tempDirs.push(dir);
  return new GeminiAnalyticsStore({
    dataDir: dir,
    retentionDays: 14,
    dailyMaxCalls: overrides.dailyMaxCalls ?? 1000,
    dailyMaxTotalTokens: overrides.dailyMaxTotalTokens ?? 1_000_000
  });
}
