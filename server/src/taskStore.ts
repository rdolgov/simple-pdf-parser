import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export type StoredDetectionState = 'idle' | 'pending' | 'ready' | 'error';

export interface StoredDetectionInfo {
  state: StoredDetectionState;
  jobId?: string;
  provider?: string;
  model?: string;
  totalPages?: number;
  completedPages?: number;
  publishedPages?: number;
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

export interface StoredLlmExchangeRecord {
  id: string;
  actor: string;
  documentId?: string;
  taskType: string;
  provider?: string;
  model?: string;
  stage?: string;
  status: 'succeeded' | 'failed';
  createdAt: string;
  artifactPath: string;
  requestSummary?: Record<string, unknown>;
  responseSummary?: Record<string, unknown>;
  errorSummary?: Record<string, unknown>;
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
      mkdir(this.evidenceIndexesDir(), { recursive: true }),
      mkdir(this.interactionsDir(), { recursive: true }),
      mkdir(this.semanticIndexesDir(), { recursive: true }),
      mkdir(this.llmExchangesDir(), { recursive: true })
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
    totalPages?: number;
    completedPages?: number;
    publishedPages?: number;
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
        ...(typeof input.totalPages === 'number' ? { totalPages: input.totalPages } : {}),
        ...(typeof input.completedPages === 'number' ? { completedPages: input.completedPages } : {}),
        ...(typeof input.publishedPages === 'number' ? { publishedPages: input.publishedPages } : {}),
        updatedAt: new Date().toISOString()
      }
    };
    await writeJson(this.documentMetadataPath(documentId), next);
    return next;
  }

  async setDetectionPartial(documentId: string, input: {
    provider: string;
    model?: string;
    result: Record<string, unknown>;
    totalPages: number;
    completedPages: number;
    publishedPages: number;
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
        state: 'pending',
        ...(current.detection.jobId ? { jobId: current.detection.jobId } : {}),
        provider: input.provider,
        ...(input.model ? { model: input.model } : {}),
        totalPages: input.totalPages,
        completedPages: input.completedPages,
        publishedPages: input.publishedPages,
        resultPath,
        updatedAt
      }
    };
    await writeJson(this.documentMetadataPath(documentId), next);
    return next;
  }

  async setDetectionReady(documentId: string, input: {
    provider: string;
    model?: string;
    result: Record<string, unknown>;
    totalPages?: number;
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
        ...(typeof input.totalPages === 'number' ? { totalPages: input.totalPages } : {}),
        ...(typeof input.totalPages === 'number' ? { completedPages: input.totalPages, publishedPages: input.totalPages } : {}),
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
        ...(current.detection.jobId ? { jobId: current.detection.jobId } : {}),
        provider: input.provider,
        ...(input.model ? { model: input.model } : {}),
        ...(typeof current.detection.totalPages === 'number' ? { totalPages: current.detection.totalPages } : {}),
        ...(typeof current.detection.completedPages === 'number' ? { completedPages: current.detection.completedPages } : {}),
        ...(typeof current.detection.publishedPages === 'number' ? { publishedPages: current.detection.publishedPages } : {}),
        ...(current.detection.resultPath ? { resultPath: current.detection.resultPath } : {}),
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

  async recordLlmExchange(input: {
    actor: string;
    documentId?: string;
    taskType: string;
    provider?: string;
    model?: string;
    stage?: string;
    status: 'succeeded' | 'failed';
    request?: Record<string, unknown>;
    response?: Record<string, unknown>;
    error?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<string> {
    await this.ensureReady();

    const id = createHash('sha1')
      .update(`${Date.now()}:${input.actor}:${input.documentId ?? 'global'}:${input.taskType}:${Math.random()}`)
      .digest('hex')
      .slice(0, 20);
    const createdAt = new Date().toISOString();
    const document = input.documentId ? await this.getDocument(input.documentId) : null;
    const artifactDir = this.llmExchangeArtifactDir(input.documentId);
    const artifactFileName = `${createdAt.replace(/[:.]/g, '-')}-${input.taskType}${input.stage ? `-${input.stage}` : ''}-${id}.json`;
    const artifactPath = join(artifactDir, artifactFileName);

    const record = {
      id,
      createdAt,
      actor: input.actor,
      documentId: input.documentId,
      documentFileName: document?.fileName,
      documentFilePath: document?.filePath,
      taskType: input.taskType,
      provider: input.provider,
      model: input.model,
      stage: input.stage,
      status: input.status,
      ...(input.metadata ? { metadata: sanitizeExchangeValue(input.metadata) } : {}),
      ...(input.request ? { request: sanitizeExchangeValue(input.request) } : {}),
      ...(input.response ? { response: sanitizeExchangeValue(input.response) } : {}),
      ...(input.error ? { error: sanitizeExchangeValue(input.error) } : {})
    };

    await writeJson(artifactPath, record);

    const indexRecord: StoredLlmExchangeRecord = {
      id,
      actor: input.actor,
      ...(input.documentId ? { documentId: input.documentId } : {}),
      taskType: input.taskType,
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.stage ? { stage: input.stage } : {}),
      status: input.status,
      createdAt,
      artifactPath,
      ...(input.request ? { requestSummary: summarizeExchangeValue(input.request) } : {}),
      ...(input.response ? { responseSummary: summarizeExchangeValue(input.response) } : {}),
      ...(input.error ? { errorSummary: summarizeExchangeValue(input.error) } : {})
    };
    await appendFile(this.llmExchangeIndexPath(input.documentId), `${JSON.stringify(indexRecord)}\n`, 'utf8');
    return artifactPath;
  }

  async getSemanticIndex<T>(documentId: string, fingerprint: string): Promise<T | null> {
    await this.ensureReady();
    return readJson<T>(this.semanticIndexPath(documentId, fingerprint));
  }

  async getEvidenceIndex<T>(documentId: string): Promise<T | null> {
    await this.ensureReady();
    return readJson<T>(this.evidenceIndexPath(documentId));
  }

  async setEvidenceIndex(documentId: string, value: unknown): Promise<void> {
    await this.ensureReady();
    await writeJson(this.evidenceIndexPath(documentId), value);
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

  private evidenceIndexesDir(): string {
    return join(this.dataDir, 'evidence-indexes');
  }

  private semanticIndexesDir(): string {
    return join(this.dataDir, 'semantic-indexes');
  }

  private llmExchangesDir(): string {
    return join(this.dataDir, 'llm-exchanges');
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

  private evidenceIndexPath(documentId: string): string {
    return join(this.evidenceIndexesDir(), `${documentId}.json`);
  }

  private semanticIndexPath(documentId: string, fingerprint: string): string {
    const safeFingerprint = createHash('sha1').update(fingerprint).digest('hex');
    return join(this.semanticIndexesDir(), `${documentId}-${safeFingerprint}.json`);
  }

  private llmExchangeArtifactDir(documentId?: string): string {
    return join(this.llmExchangesDir(), documentId ?? 'global');
  }

  private llmExchangeIndexPath(documentId?: string): string {
    return join(this.llmExchangesDir(), `${documentId ?? 'global'}.jsonl`);
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

function sanitizeExchangeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeExchangeValue(entry));
  }

  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      return redactStringIfNeeded('', value);
    }
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (shouldRedactExchangeKey(key)) {
      result[key] = summarizeBlobValue(entry);
      continue;
    }

    if (typeof entry === 'string') {
      result[key] = redactStringIfNeeded(key, entry);
      continue;
    }

    result[key] = sanitizeExchangeValue(entry);
  }
  return result;
}

function summarizeExchangeValue(value: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      summary[key] = summarizeString(entry);
      continue;
    }
    if (typeof entry === 'number' || typeof entry === 'boolean') {
      summary[key] = entry;
      continue;
    }
    if (Array.isArray(entry)) {
      summary[key] = `array(${entry.length})`;
      continue;
    }
    if (entry && typeof entry === 'object') {
      summary[key] = 'object';
    }
  }
  return summary;
}

function shouldRedactExchangeKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized === 'data' ||
    normalized === 'datauri' ||
    normalized === 'base64data' ||
    normalized === 'bytes' ||
    normalized === 'rawzip' ||
    normalized === 'inline_data' ||
    normalized === 'inlinedata' ||
    normalized === 'imagedata'
  );
}

function redactStringIfNeeded(key: string, value: string): string {
  if (shouldRedactExchangeKey(key)) {
    return summarizeBlobString(value);
  }
  if (looksLikeBinaryBlob(value)) {
    return summarizeBlobString(value);
  }
  return value;
}

function summarizeBlobValue(value: unknown): string {
  if (typeof value === 'string') {
    return summarizeBlobString(value);
  }
  if (Array.isArray(value)) {
    return `<redacted array length=${value.length}>`;
  }
  if (value && typeof value === 'object') {
    return '<redacted object>';
  }
  return '<redacted>';
}

function summarizeBlobString(value: string): string {
  return `<redacted binary-like string ${value.length} chars>`;
}

function looksLikeBinaryBlob(value: string): boolean {
  if (value.startsWith('data:')) {
    return true;
  }
  const compact = value.replace(/\s+/g, '');
  return compact.length > 2048 && /^[A-Za-z0-9+/=:_-]+$/.test(compact);
}

function summarizeString(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}
