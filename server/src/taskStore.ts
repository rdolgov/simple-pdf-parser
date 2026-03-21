import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export type StoredDetectionState = 'idle' | 'pending' | 'ready' | 'error';

export interface StoredDetectionInfo {
  state: StoredDetectionState;
  jobId?: string;
  provider?: string;
  model?: string;
  updatedAt: string;
  error?: string;
  resultPath?: string;
}

export interface StoredDocumentRecord {
  id: string;
  actor: string;
  fileHash: string;
  fileName: string;
  mimeType: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
  detection: StoredDetectionInfo;
  interactionCount: number;
}

export interface StoredInteractionRecord {
  id: string;
  actor: string;
  documentId?: string;
  taskType: string;
  provider?: string;
  model?: string;
  status: 'started' | 'succeeded' | 'failed';
  createdAt: string;
  inputSummary?: Record<string, unknown>;
  outputSummary?: Record<string, unknown>;
}

export class TaskStore {
  readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = resolve(dataDir);
  }

  async ensureReady(): Promise<void> {
    await Promise.all([
      mkdir(this.documentsDir(), { recursive: true }),
      mkdir(this.filesDir(), { recursive: true }),
      mkdir(this.detectionsDir(), { recursive: true }),
      mkdir(this.interactionsDir(), { recursive: true }),
      mkdir(this.semanticIndexesDir(), { recursive: true })
    ]);
  }

  async createOrUpdateDocument(input: {
    actor: string;
    fileHash: string;
    fileName: string;
    mimeType: string;
    bytes: Buffer;
  }): Promise<StoredDocumentRecord> {
    await this.ensureReady();
    const id = createStableDocumentId(input.actor, input.fileHash);
    const documentPath = this.documentMetadataPath(id);
    const existing = await this.getDocument(id);
    const now = new Date().toISOString();
    const fileExt = inferDocumentExtension(input.fileName, input.mimeType);
    const filePath = this.documentFilePath(id, fileExt);

    if (!(await fileExistsWithSize(filePath, input.bytes.length))) {
      await writeFile(filePath, input.bytes);
    }

    const next: StoredDocumentRecord = {
      id,
      actor: input.actor,
      fileHash: input.fileHash,
      fileName: input.fileName,
      mimeType: input.mimeType,
      filePath,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      detection: existing?.detection ?? {
        state: 'idle',
        updatedAt: now
      },
      interactionCount: existing?.interactionCount ?? 0
    };
    await writeJson(documentPath, next);
    return next;
  }

  async getDocument(documentId: string): Promise<StoredDocumentRecord | null> {
    await this.ensureReady();
    return readJson<StoredDocumentRecord>(this.documentMetadataPath(documentId));
  }

  async setDetectionPending(documentId: string, input: {
    jobId: string;
    provider: string;
    model?: string;
  }): Promise<StoredDocumentRecord | null> {
    const current = await this.getDocument(documentId);
    if (!current) {
      return null;
    }
    const next: StoredDocumentRecord = {
      ...current,
      updatedAt: new Date().toISOString(),
      detection: {
        state: 'pending',
        jobId: input.jobId,
        provider: input.provider,
        ...(input.model ? { model: input.model } : {}),
        updatedAt: new Date().toISOString()
      }
    };
    await writeJson(this.documentMetadataPath(documentId), next);
    return next;
  }

  async setDetectionReady(documentId: string, input: {
    provider: string;
    model?: string;
    result: Record<string, unknown>;
  }): Promise<StoredDocumentRecord | null> {
    const current = await this.getDocument(documentId);
    if (!current) {
      return null;
    }
    const resultPath = this.detectionResultPath(documentId);
    await writeJson(resultPath, input.result);
    const updatedAt = new Date().toISOString();
    const next: StoredDocumentRecord = {
      ...current,
      updatedAt,
      detection: {
        state: 'ready',
        provider: input.provider,
        ...(input.model ? { model: input.model } : {}),
        resultPath,
        updatedAt
      }
    };
    await writeJson(this.documentMetadataPath(documentId), next);
    return next;
  }

  async setDetectionError(documentId: string, input: {
    provider: string;
    model?: string;
    error: string;
  }): Promise<StoredDocumentRecord | null> {
    const current = await this.getDocument(documentId);
    if (!current) {
      return null;
    }
    const updatedAt = new Date().toISOString();
    const next: StoredDocumentRecord = {
      ...current,
      updatedAt,
      detection: {
        state: 'error',
        provider: input.provider,
        ...(input.model ? { model: input.model } : {}),
        error: input.error,
        updatedAt
      }
    };
    await writeJson(this.documentMetadataPath(documentId), next);
    return next;
  }

  async getDetectionResult(documentId: string): Promise<Record<string, unknown> | null> {
    const current = await this.getDocument(documentId);
    if (!current?.detection.resultPath) {
      return null;
    }
    return readJson<Record<string, unknown>>(current.detection.resultPath);
  }

  async recordInteraction(input: Omit<StoredInteractionRecord, 'id' | 'createdAt'>): Promise<void> {
    await this.ensureReady();
    const id = createHash('sha1')
      .update(`${Date.now()}:${input.actor}:${input.taskType}:${Math.random()}`)
      .digest('hex')
      .slice(0, 16);
    const createdAt = new Date().toISOString();
    const record: StoredInteractionRecord = {
      id,
      createdAt,
      ...input
    };
    const interactionPath = this.interactionLogPath(input.documentId);
    await appendFile(interactionPath, `${JSON.stringify(record)}\n`, 'utf8');

    if (input.documentId) {
      const current = await this.getDocument(input.documentId);
      if (current) {
        await writeJson(this.documentMetadataPath(input.documentId), {
          ...current,
          updatedAt: createdAt,
          interactionCount: current.interactionCount + 1
        });
      }
    }
  }

  async getSemanticIndex<T>(documentId: string, fingerprint: string): Promise<T | null> {
    await this.ensureReady();
    return readJson<T>(this.semanticIndexPath(documentId, fingerprint));
  }

  async setSemanticIndex(documentId: string, fingerprint: string, value: unknown): Promise<void> {
    await this.ensureReady();
    await writeJson(this.semanticIndexPath(documentId, fingerprint), value);
  }

  private documentsDir(): string {
    return join(this.dataDir, 'documents');
  }

  private filesDir(): string {
    return join(this.dataDir, 'files');
  }

  private detectionsDir(): string {
    return join(this.dataDir, 'detections');
  }

  private interactionsDir(): string {
    return join(this.dataDir, 'interactions');
  }

  private semanticIndexesDir(): string {
    return join(this.dataDir, 'semantic-indexes');
  }

  private documentMetadataPath(documentId: string): string {
    return join(this.documentsDir(), `${documentId}.json`);
  }

  private documentFilePath(documentId: string, extension: string): string {
    return join(this.filesDir(), `${documentId}${extension}`);
  }

  private detectionResultPath(documentId: string): string {
    return join(this.detectionsDir(), `${documentId}.json`);
  }

  private interactionLogPath(documentId?: string): string {
    return join(this.interactionsDir(), `${documentId ?? 'global'}.jsonl`);
  }

  private semanticIndexPath(documentId: string, fingerprint: string): string {
    const safeFingerprint = createHash('sha1').update(fingerprint).digest('hex');
    return join(this.semanticIndexesDir(), `${documentId}-${safeFingerprint}.json`);
  }
}

function createStableDocumentId(actor: string, fileHash: string): string {
  return createHash('sha256')
    .update(`${actor}:${fileHash}`)
    .digest('hex')
    .slice(0, 24);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
}

async function fileExistsWithSize(path: string, expectedSize: number): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && info.size === expectedSize;
  } catch {
    return false;
  }
}

function inferDocumentExtension(fileName: string, mimeType: string): string {
  const normalizedName = fileName.trim().toLowerCase();
  if (normalizedName.endsWith('.pdf') || mimeType === 'application/pdf') {
    return '.pdf';
  }
  return '.bin';
}
