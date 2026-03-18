import type { HtmlDocumentLogicalStructure } from 'pdf-layout-parser';

type CachedLogicalStructureRecord = {
  cacheKey: string;
  fileHash: string;
  structure: HtmlDocumentLogicalStructure;
  updatedAt: number;
};

const DB_NAME = 'pdf-logical-structure-cache';
const STORE_NAME = 'logical-structures-v2';
const DB_VERSION = 2;

export function createLogicalStructureCacheKey(fileHash: string, fingerprint: string): string {
  return `${fileHash}::${fingerprint}`;
}

export async function loadCachedLogicalStructure(cacheKey: string): Promise<HtmlDocumentLogicalStructure | null> {
  const db = await openDatabase();
  if (!db) {
    return null;
  }

  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(cacheKey);
    request.onsuccess = () => {
      const record = (request.result as CachedLogicalStructureRecord | undefined) ?? null;
      resolve(record?.structure ?? null);
    };
    request.onerror = () => resolve(null);
  });
}

export async function saveCachedLogicalStructure(
  cacheKey: string,
  fileHash: string,
  structure: HtmlDocumentLogicalStructure
): Promise<void> {
  const db = await openDatabase();
  if (!db) {
    return;
  }

  const record: CachedLogicalStructureRecord = {
    cacheKey,
    fileHash,
    structure,
    updatedAt: Date.now()
  };

  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return null;
  }

  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}
