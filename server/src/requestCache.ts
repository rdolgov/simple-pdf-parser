import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export type CacheProvider = 'openai' | 'gemini' | 'codex' | 'task';

export interface FileResponseCacheConfig {
  enabled: boolean;
  cacheDir: string;
  ttlMs?: number;
  maxBodyBytes: number;
}

export interface CacheKeyInput {
  provider: CacheProvider;
  upstreamBaseUrl: string;
  upstreamPath: string;
  queryParams: URLSearchParams;
  method: string;
  accept?: string;
  contentType?: string;
  body: Buffer;
}

export interface CacheKeyResult {
  key: string;
  bodyHash: string;
}

export interface CachedProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  createdAt: number;
}

interface CacheRecord {
  version: 1;
  createdAt: number;
  status: number;
  headers: Record<string, string>;
  bodyBase64: string;
}

export class FileResponseCache {
  private readonly enabled: boolean;
  private readonly cacheDir: string;
  private readonly ttlMs?: number;
  private readonly maxBodyBytes: number;
  private dirReadyPromise: Promise<void> | null = null;

  constructor(config: FileResponseCacheConfig) {
    this.enabled = config.enabled;
    this.cacheDir = resolve(config.cacheDir);
    this.ttlMs = normalizeTtl(config.ttlMs);
    this.maxBodyBytes = Math.max(1, config.maxBodyBytes);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getCacheDir(): string {
    return this.cacheDir;
  }

  getTtlMs(): number | undefined {
    return this.ttlMs;
  }

  buildKey(input: CacheKeyInput): CacheKeyResult {
    const bodyHash = this.buildBodyHash(input.body);
    const hash = createHash('sha256');
    hash.update(
      JSON.stringify({
        provider: input.provider,
        upstreamBaseUrl: input.upstreamBaseUrl,
        upstreamPath: normalizePath(input.upstreamPath),
        query: normalizeQueryParams(input.queryParams),
        method: input.method.toUpperCase(),
        accept: normalizeHeader(input.accept),
        contentType: normalizeHeader(input.contentType),
        bodyHash
      })
    );
    return {
      key: hash.digest('hex'),
      bodyHash
    };
  }

  buildBodyHash(body: Buffer): string {
    const hash = createHash('sha256');
    hash.update(body);
    return hash.digest('hex');
  }

  async get(key: string): Promise<CachedProxyResponse | null> {
    if (!this.enabled) {
      return null;
    }

    const filePath = this.resolveEntryPath(key);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }

    let record: Partial<CacheRecord>;
    try {
      record = JSON.parse(raw) as Partial<CacheRecord>;
    } catch {
      await safeRemove(filePath);
      return null;
    }
    if (!isValidCacheRecord(record)) {
      await safeRemove(filePath);
      return null;
    }

    if (this.ttlMs && Date.now() - record.createdAt > this.ttlMs) {
      await safeRemove(filePath);
      return null;
    }

    return {
      status: record.status,
      headers: record.headers,
      body: Buffer.from(record.bodyBase64, 'base64'),
      createdAt: record.createdAt
    };
  }

  async set(key: string, response: Omit<CachedProxyResponse, 'createdAt'>): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    if (response.body.length > this.maxBodyBytes) {
      return false;
    }

    await this.ensureCacheDir();

    const filePath = this.resolveEntryPath(key);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const record: CacheRecord = {
      version: 1,
      createdAt: Date.now(),
      status: response.status,
      headers: response.headers,
      bodyBase64: response.body.toString('base64')
    };

    await writeFile(tempPath, JSON.stringify(record), 'utf8');
    await rename(tempPath, filePath);
    return true;
  }

  private resolveEntryPath(key: string): string {
    return join(this.cacheDir, `${key}.json`);
  }

  private async ensureCacheDir(): Promise<void> {
    if (!this.dirReadyPromise) {
      this.dirReadyPromise = mkdir(this.cacheDir, { recursive: true }).then(() => {});
    }
    await this.dirReadyPromise;
  }
}

function normalizePath(value: string): string {
  return value.replace(/^\/+/, '');
}

function normalizeHeader(value?: string): string {
  return value?.trim().toLowerCase() ?? '';
}

function normalizeQueryParams(params: URLSearchParams): Array<[string, string]> {
  return Array.from(params.entries())
    .filter(([key]) => key.toLowerCase() !== 'key' && key.toLowerCase() !== 'cache')
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey)
    );
}

function normalizeTtl(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function isValidCacheRecord(record: Partial<CacheRecord>): record is CacheRecord {
  return (
    record.version === 1 &&
    typeof record.createdAt === 'number' &&
    Number.isFinite(record.createdAt) &&
    typeof record.status === 'number' &&
    Number.isFinite(record.status) &&
    typeof record.bodyBase64 === 'string' &&
    isStringRecord(record.headers)
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === 'string');
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ENOENT';
}

async function safeRemove(path: string): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch {
    // Ignore cache cleanup failures.
  }
}
