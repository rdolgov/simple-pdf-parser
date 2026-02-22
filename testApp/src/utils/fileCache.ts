import type { StructuredDataDocument, StructuredExtractProvider } from 'pdf-layout-parser';

export type CachedExtractPayload = {
  schemaVersion?: number;
  provider?: StructuredExtractProvider;
  model?: string | null;
  document: StructuredDataDocument;
  parsedTables?: Array<{ name?: string; rows: unknown[][] }>;
  assetMap?: Record<string, string> | null;
};

export type CachedFileRecord = {
  fileHash: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  lastModified?: number;
  fileBlob: Blob;
  extract?: CachedExtractPayload;
  createdAt: number;
};

export type CachedFileSummary = {
  fileHash: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  lastModified?: number;
  createdAt: number;
};

const DB_NAME = 'pdf-layout-file-cache';
const FILE_STORE_NAME = 'files';
const EXTRACT_STORE_NAME = 'extracts';
const DB_VERSION = 2;

type CachedExtractRecord = {
  fileHash: string;
  extract: CachedExtractPayload;
  updatedAt: number;
};

export async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  return computeBufferHash(buffer);
}

export async function loadCachedExtract(fileHash: string): Promise<CachedFileRecord | null> {
  const db = await openDb();
  if (!db) {
    return null;
  }
  return new Promise((resolve) => {
    const tx = db.transaction(FILE_STORE_NAME, 'readonly');
    const store = tx.objectStore(FILE_STORE_NAME);
    const request = store.get(fileHash);
    request.onsuccess = () => {
      resolve(request.result ?? null);
    };
    request.onerror = () => {
      resolve(null);
    };
  });
}

export async function loadCachedExtractPayload(fileHash: string): Promise<CachedExtractPayload | null> {
  const db = await openDb();
  if (!db) {
    return null;
  }

  const directRecord = await new Promise<CachedExtractRecord | null>((resolve) => {
    const tx = db.transaction(EXTRACT_STORE_NAME, 'readonly');
    const store = tx.objectStore(EXTRACT_STORE_NAME);
    const request = store.get(fileHash);
    request.onsuccess = () => resolve((request.result as CachedExtractRecord | undefined) ?? null);
    request.onerror = () => resolve(null);
  });
  if (directRecord?.extract) {
    return directRecord.extract;
  }

  const legacy = await loadCachedExtract(fileHash);
  return legacy?.extract ?? null;
}

export async function saveCachedExtractPayload(params: {
  fileHash: string;
  extract: CachedExtractPayload;
}): Promise<void> {
  const db = await openDb();
  if (!db) {
    return;
  }

  const extractRecord: CachedExtractRecord = {
    fileHash: params.fileHash,
    extract: params.extract,
    updatedAt: Date.now()
  };

  await new Promise<void>((resolve) => {
    const tx = db.transaction(EXTRACT_STORE_NAME, 'readwrite');
    const store = tx.objectStore(EXTRACT_STORE_NAME);
    store.put(extractRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      console.warn('Failed to save extract payload cache');
      resolve();
    };
  });
}

export async function saveCachedExtract(params: {
  file: File;
  fileHash: string;
  extract: CachedExtractPayload;
}): Promise<void> {
  const db = await openDb();
  if (!db) {
    return;
  }
  const buffer = await params.file.arrayBuffer();
  const record: CachedFileRecord = {
    fileHash: params.fileHash,
    fileName: params.file.name,
    fileType: params.file.type,
    fileSize: params.file.size,
    lastModified: params.file.lastModified,
    fileBlob: new Blob([buffer], { type: params.file.type || 'application/octet-stream' }),
    extract: params.extract,
    createdAt: Date.now()
  };
  const extractRecord: CachedExtractRecord = {
    fileHash: params.fileHash,
    extract: params.extract,
    updatedAt: Date.now()
  };

  await new Promise<void>((resolve) => {
    const tx = db.transaction([FILE_STORE_NAME, EXTRACT_STORE_NAME], 'readwrite');
    tx.objectStore(FILE_STORE_NAME).put(record);
    tx.objectStore(EXTRACT_STORE_NAME).put(extractRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      console.warn('Failed to save full file cache record');
      resolve();
    };
  });
}

export async function listCachedFiles(): Promise<CachedFileSummary[]> {
  const db = await openDb();
  if (!db) {
    return [];
  }
  return new Promise((resolve) => {
    const tx = db.transaction(FILE_STORE_NAME, 'readonly');
    const store = tx.objectStore(FILE_STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const records = (request.result as CachedFileRecord[] | undefined) ?? [];
      const summaries = records
        .map((record) => ({
          fileHash: record.fileHash,
          fileName: record.fileName,
          fileType: record.fileType,
          fileSize: record.fileSize,
          lastModified: record.lastModified,
          createdAt: record.createdAt
        }))
        .sort((a, b) => b.createdAt - a.createdAt);
      resolve(summaries);
    };
    request.onerror = () => resolve([]);
  });
}

export async function deleteCachedFile(fileHash: string): Promise<boolean> {
  const db = await openDb();
  if (!db) {
    return false;
  }
  return new Promise((resolve) => {
    const tx = db.transaction([FILE_STORE_NAME, EXTRACT_STORE_NAME], 'readwrite');
    const request = tx.objectStore(FILE_STORE_NAME).delete(fileHash);
    tx.objectStore(EXTRACT_STORE_NAME).delete(fileHash);
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
  });
}

export async function loadCachedFile(fileHash: string): Promise<{ file: File; record: CachedFileRecord } | null> {
  const record = await loadCachedExtract(fileHash);
  if (!record) {
    return null;
  }
  try {
    const file = new File([record.fileBlob], record.fileName, {
      type: record.fileType,
      lastModified: record.lastModified ?? Date.now()
    });
    return { file, record };
  } catch (error) {
    console.warn('Unable to reconstruct cached file', error);
    return null;
  }
}

async function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return null;
  }
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILE_STORE_NAME)) {
        db.createObjectStore(FILE_STORE_NAME, { keyPath: 'fileHash' });
      }
      if (!db.objectStoreNames.contains(EXTRACT_STORE_NAME)) {
        db.createObjectStore(EXTRACT_STORE_NAME, { keyPath: 'fileHash' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function computeBufferHash(buffer: ArrayBuffer): Promise<string> {
  if (crypto?.subtle?.digest) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      return toHex(digest);
    } catch (error) {
      console.warn('Failed to compute SHA-256 hash, falling back to ad-hoc hash', error);
    }
  }
  return fallbackHash(buffer);
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fallbackHash(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hash = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    hash = (hash * 31 + bytes[i]) >>> 0;
  }
  return `fh-${hash.toString(16)}`;
}
