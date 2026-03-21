import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { GeminiUsageMetadata } from './geminiUsageMetadata.js';

export interface GeminiAnalyticsConfig {
  dataDir: string;
  retentionDays: number;
  dailyMaxCalls: number;
  dailyMaxTotalTokens: number;
}

export interface GeminiAnalyticsCounters {
  calls: number;
  blockedRequests: number;
  errorCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface GeminiAnalyticsEvent {
  id: string;
  timestamp: string;
  actor: string;
  model: string;
  requestKind: string;
  status: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  blocked: boolean;
}

export interface GeminiAnalyticsDay {
  day: string;
  totals: GeminiAnalyticsCounters;
  actors: Record<string, GeminiAnalyticsCounters>;
  models: Record<string, GeminiAnalyticsCounters>;
  recentRequests: GeminiAnalyticsEvent[];
}

export interface GeminiAnalyticsOverview {
  limits: {
    dailyMaxCalls: number;
    dailyMaxTotalTokens: number;
  };
  today: GeminiAnalyticsDay;
  recentDays: GeminiAnalyticsDay[];
}

type GeminiAnalyticsState = {
  version: 1;
  updatedAt: string;
  days: Record<string, GeminiAnalyticsDay>;
};

type GeminiPendingRequest = {
  id: string;
  day: string;
  actor: string;
  model: string;
  requestKind: string;
  startedAt: number;
};

export type GeminiAnalyticsBeginResult =
  | {
      allowed: true;
      reservationId: string;
      day: string;
    }
  | {
      allowed: false;
      day: string;
      reason: string;
      snapshot: GeminiAnalyticsDay;
    };

export class GeminiAnalyticsStore {
  private readonly storagePath: string;
  private readonly pendingRequests = new Map<string, GeminiPendingRequest>();
  private loadPromise?: Promise<GeminiAnalyticsState>;
  private writeChain = Promise.resolve();

  constructor(private readonly config: GeminiAnalyticsConfig) {
    this.storagePath = path.join(config.dataDir, 'gemini-analytics.json');
  }

  async beginRequest(input: {
    actor: string;
    model: string;
    requestKind: string;
    now?: number;
  }): Promise<GeminiAnalyticsBeginResult> {
    const now = input.now ?? Date.now();
    const state = await this.loadState();
    this.pruneState(state, now);

    const day = toLocalDayKey(now);
    const dayState = ensureDay(state, day);
    const pendingCallsToday = countPendingCalls(this.pendingRequests, day);
    const totalCallsToday = dayState.totals.calls + pendingCallsToday;
    const totalTokensToday = dayState.totals.totalTokens;

    if (totalCallsToday >= this.config.dailyMaxCalls) {
      const snapshot = this.recordBlockedAttempt(state, {
        actor: input.actor,
        model: input.model,
        requestKind: input.requestKind,
        day,
        now,
        reason: `Daily Gemini call limit reached (${this.config.dailyMaxCalls}).`
      });
      await this.persistState(state);
      return {
        allowed: false,
        day,
        reason: `Daily Gemini call limit reached (${this.config.dailyMaxCalls}).`,
        snapshot
      };
    }

    if (totalTokensToday >= this.config.dailyMaxTotalTokens) {
      const snapshot = this.recordBlockedAttempt(state, {
        actor: input.actor,
        model: input.model,
        requestKind: input.requestKind,
        day,
        now,
        reason: `Daily Gemini token limit reached (${this.config.dailyMaxTotalTokens}).`
      });
      await this.persistState(state);
      return {
        allowed: false,
        day,
        reason: `Daily Gemini token limit reached (${this.config.dailyMaxTotalTokens}).`,
        snapshot
      };
    }

    const reservationId = randomUUID();
    this.pendingRequests.set(reservationId, {
      id: reservationId,
      day,
      actor: input.actor,
      model: input.model,
      requestKind: input.requestKind,
      startedAt: now
    });

    return {
      allowed: true,
      reservationId,
      day
    };
  }

  async finalizeRequest(input: {
    reservationId: string;
    status: number;
    durationMs: number;
    usage: GeminiUsageMetadata | null;
    now?: number;
  }): Promise<GeminiAnalyticsEvent | null> {
    const pending = this.pendingRequests.get(input.reservationId);
    if (!pending) {
      return null;
    }

    this.pendingRequests.delete(input.reservationId);

    const now = input.now ?? Date.now();
    const state = await this.loadState();
    this.pruneState(state, now);

    const dayState = ensureDay(state, pending.day);
    const usage = input.usage ?? {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0
    };

    const event: GeminiAnalyticsEvent = {
      id: input.reservationId,
      timestamp: new Date(now).toISOString(),
      actor: pending.actor,
      model: pending.model,
      requestKind: pending.requestKind,
      status: input.status,
      durationMs: input.durationMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      blocked: false
    };

    applyEventToCounters(dayState.totals, event);
    applyEventToCounters(getOrCreateCounters(dayState.actors, pending.actor), event);
    applyEventToCounters(getOrCreateCounters(dayState.models, pending.model), event);
    pushRecentEvent(dayState.recentRequests, event);

    await this.persistState(state);
    return event;
  }

  async getOverview(now = Date.now()): Promise<GeminiAnalyticsOverview> {
    const state = await this.loadState();
    this.pruneState(state, now);
    const today = toLocalDayKey(now);
    const todayState = ensureDay(state, today);

    const recentDays = Object.values(state.days)
      .sort((left, right) => right.day.localeCompare(left.day))
      .slice(0, Math.max(this.config.retentionDays, 1))
      .map(cloneDay);

    return {
      limits: {
        dailyMaxCalls: this.config.dailyMaxCalls,
        dailyMaxTotalTokens: this.config.dailyMaxTotalTokens
      },
      today: cloneDay(todayState),
      recentDays
    };
  }

  private async loadState(): Promise<GeminiAnalyticsState> {
    if (!this.loadPromise) {
      this.loadPromise = this.readStateFromDisk();
    }
    return this.loadPromise;
  }

  private async readStateFromDisk(): Promise<GeminiAnalyticsState> {
    try {
      const raw = await readFile(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw) as GeminiAnalyticsState;
      if (parsed && parsed.version === 1 && parsed.days && typeof parsed.days === 'object') {
        return parsed;
      }
    } catch {
      // Fall through to the empty-state path.
    }

    return {
      version: 1,
      updatedAt: new Date(0).toISOString(),
      days: {}
    };
  }

  private async persistState(state: GeminiAnalyticsState): Promise<void> {
    state.updatedAt = new Date().toISOString();
    const payload = JSON.stringify(state, null, 2);

    this.writeChain = this.writeChain.then(async () => {
      await mkdir(this.config.dataDir, { recursive: true });
      await writeFile(this.storagePath, payload, 'utf8');
    });

    await this.writeChain;
  }

  private pruneState(state: GeminiAnalyticsState, now: number): void {
    const cutoffDay = toLocalDayKey(now - Math.max(this.config.retentionDays - 1, 0) * DAY_MS);
    for (const day of Object.keys(state.days)) {
      if (day < cutoffDay) {
        delete state.days[day];
      }
    }
  }

  private recordBlockedAttempt(
    state: GeminiAnalyticsState,
    input: {
      actor: string;
      model: string;
      requestKind: string;
      day: string;
      now: number;
      reason: string;
    }
  ): GeminiAnalyticsDay {
    const dayState = ensureDay(state, input.day);
    const event: GeminiAnalyticsEvent = {
      id: randomUUID(),
      timestamp: new Date(input.now).toISOString(),
      actor: input.actor,
      model: input.model,
      requestKind: input.requestKind,
      status: 429,
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      blocked: true
    };

    applyEventToCounters(dayState.totals, event);
    applyEventToCounters(getOrCreateCounters(dayState.actors, input.actor), event);
    applyEventToCounters(getOrCreateCounters(dayState.models, input.model), event);
    pushRecentEvent(dayState.recentRequests, event);

    return cloneDay(dayState);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RECENT_REQUESTS_PER_DAY = 120;

function countPendingCalls(pendingRequests: Map<string, GeminiPendingRequest>, day: string): number {
  let count = 0;
  for (const pending of pendingRequests.values()) {
    if (pending.day === day) {
      count += 1;
    }
  }
  return count;
}

function ensureDay(state: GeminiAnalyticsState, day: string): GeminiAnalyticsDay {
  const existing = state.days[day];
  if (existing) {
    return existing;
  }

  const created: GeminiAnalyticsDay = {
    day,
    totals: createEmptyCounters(),
    actors: {},
    models: {},
    recentRequests: []
  };
  state.days[day] = created;
  return created;
}

function createEmptyCounters(): GeminiAnalyticsCounters {
  return {
    calls: 0,
    blockedRequests: 0,
    errorCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };
}

function getOrCreateCounters(
  collection: Record<string, GeminiAnalyticsCounters>,
  key: string
): GeminiAnalyticsCounters {
  const existing = collection[key];
  if (existing) {
    return existing;
  }

  const created = createEmptyCounters();
  collection[key] = created;
  return created;
}

function applyEventToCounters(counters: GeminiAnalyticsCounters, event: GeminiAnalyticsEvent): void {
  if (event.blocked) {
    counters.blockedRequests += 1;
    return;
  }

  counters.calls += 1;
  counters.inputTokens += event.inputTokens;
  counters.outputTokens += event.outputTokens;
  counters.totalTokens += event.totalTokens;
  if (event.status >= 400) {
    counters.errorCalls += 1;
  }
}

function pushRecentEvent(events: GeminiAnalyticsEvent[], event: GeminiAnalyticsEvent): void {
  events.unshift(event);
  if (events.length > MAX_RECENT_REQUESTS_PER_DAY) {
    events.length = MAX_RECENT_REQUESTS_PER_DAY;
  }
}

function cloneDay(day: GeminiAnalyticsDay): GeminiAnalyticsDay {
  return JSON.parse(JSON.stringify(day)) as GeminiAnalyticsDay;
}

function toLocalDayKey(timestamp: number): string {
  const value = new Date(timestamp);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
