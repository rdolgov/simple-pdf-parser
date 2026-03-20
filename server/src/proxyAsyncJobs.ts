import { randomUUID } from 'node:crypto';
import type { CacheProvider } from './requestCache.js';

export type ProxyAsyncJobProvider = CacheProvider;
export type ProxyAsyncJobState = 'pending' | 'running' | 'succeeded' | 'failed';
export type ProxyAsyncCacheStatus = 'MISS' | 'BYPASS';

export interface ProxyAsyncJobResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export interface ProxyAsyncJobStoreConfig {
  retentionMs: number;
  maxJobs: number;
  pollIntervalMs: number;
  maxEventsPerJob?: number;
}

export interface ProxyAsyncJobSnapshot {
  id: string;
  provider: ProxyAsyncJobProvider;
  requestKind: string;
  cacheKey: string;
  bodyHash: string;
  cacheStatus: ProxyAsyncCacheStatus;
  sequence: number;
  state: ProxyAsyncJobState;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  lastEvent?: string;
}

interface ProxyAsyncJobRecord extends ProxyAsyncJobSnapshot {
  dedupeKey: string;
  response?: ProxyAsyncJobResponse;
  events: string[];
}

export class ProxyAsyncJobStore {
  private readonly retentionMs: number;
  private readonly maxJobs: number;
  private readonly pollIntervalMs: number;
  private readonly maxEventsPerJob: number;
  private readonly jobs = new Map<string, ProxyAsyncJobRecord>();
  private readonly inflightByDedupeKey = new Map<string, string>();

  constructor(config: ProxyAsyncJobStoreConfig) {
    this.retentionMs = Math.max(60_000, Math.floor(config.retentionMs));
    this.maxJobs = Math.max(10, Math.floor(config.maxJobs));
    this.pollIntervalMs = Math.max(250, Math.floor(config.pollIntervalMs));
    this.maxEventsPerJob = Math.max(1, Math.floor(config.maxEventsPerJob ?? 16));
  }

  getPollIntervalMs(): number {
    return this.pollIntervalMs;
  }

  createOrReuse(input: {
    provider: ProxyAsyncJobProvider;
    requestKind: string;
    cacheKey: string;
    bodyHash: string;
    cacheStatus: ProxyAsyncCacheStatus;
    sequence: number;
  }): { job: ProxyAsyncJobSnapshot; reused: boolean } {
    this.cleanup();
    const dedupeKey = `${input.provider}:${input.requestKind}:${input.cacheKey}`;
    const existingId = this.inflightByDedupeKey.get(dedupeKey);
    if (existingId) {
      const existing = this.jobs.get(existingId);
      if (existing && (existing.state === 'pending' || existing.state === 'running')) {
        return {
          job: toSnapshot(existing),
          reused: true
        };
      }
      this.inflightByDedupeKey.delete(dedupeKey);
    }

    const now = Date.now();
    const record: ProxyAsyncJobRecord = {
      id: randomUUID(),
      provider: input.provider,
      requestKind: input.requestKind,
      cacheKey: input.cacheKey,
      bodyHash: input.bodyHash,
      cacheStatus: input.cacheStatus,
      sequence: input.sequence,
      state: 'pending',
      createdAt: now,
      updatedAt: now,
      dedupeKey,
      events: []
    };
    this.jobs.set(record.id, record);
    this.inflightByDedupeKey.set(dedupeKey, record.id);
    this.evictCompletedOverflow();
    return {
      job: toSnapshot(record),
      reused: false
    };
  }

  get(jobId: string): ProxyAsyncJobSnapshot | null {
    this.cleanup();
    const record = this.jobs.get(jobId);
    return record ? toSnapshot(record) : null;
  }

  getResponse(jobId: string): ProxyAsyncJobResponse | null {
    this.cleanup();
    return this.jobs.get(jobId)?.response ?? null;
  }

  markRunning(jobId: string, message?: string): void {
    const record = this.jobs.get(jobId);
    if (!record) {
      return;
    }
    record.state = 'running';
    record.updatedAt = Date.now();
    if (message) {
      this.appendEvent(jobId, message);
    }
  }

  appendEvent(jobId: string, message: string): void {
    const record = this.jobs.get(jobId);
    if (!record) {
      return;
    }
    const normalized = message.trim();
    if (!normalized) {
      return;
    }
    record.updatedAt = Date.now();
    record.lastEvent = normalized;
    record.events.push(normalized);
    if (record.events.length > this.maxEventsPerJob) {
      record.events.splice(0, record.events.length - this.maxEventsPerJob);
    }
  }

  complete(jobId: string, response: ProxyAsyncJobResponse): void {
    const record = this.jobs.get(jobId);
    if (!record) {
      return;
    }
    const now = Date.now();
    record.response = response;
    record.updatedAt = now;
    record.completedAt = now;
    record.state = response.status >= 400 ? 'failed' : 'succeeded';
    this.inflightByDedupeKey.delete(record.dedupeKey);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [jobId, record] of this.jobs.entries()) {
      if ((record.state === 'pending' || record.state === 'running')) {
        continue;
      }
      if (now - record.updatedAt > this.retentionMs) {
        this.jobs.delete(jobId);
        this.inflightByDedupeKey.delete(record.dedupeKey);
      }
    }
  }

  private evictCompletedOverflow(): void {
    if (this.jobs.size <= this.maxJobs) {
      return;
    }
    const completed = Array.from(this.jobs.values())
      .filter((job) => job.state === 'succeeded' || job.state === 'failed')
      .sort((left, right) => left.updatedAt - right.updatedAt);
    while (this.jobs.size > this.maxJobs && completed.length > 0) {
      const next = completed.shift();
      if (!next) {
        break;
      }
      this.jobs.delete(next.id);
      this.inflightByDedupeKey.delete(next.dedupeKey);
    }
  }
}

function toSnapshot(record: ProxyAsyncJobRecord): ProxyAsyncJobSnapshot {
  return {
    id: record.id,
    provider: record.provider,
    requestKind: record.requestKind,
    cacheKey: record.cacheKey,
    bodyHash: record.bodyHash,
    cacheStatus: record.cacheStatus,
    sequence: record.sequence,
    state: record.state,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
    ...(record.lastEvent ? { lastEvent: record.lastEvent } : {})
  };
}
