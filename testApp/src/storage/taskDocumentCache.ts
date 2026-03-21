export interface CachedTaskDocumentRecord {
  fileHash: string;
  documentId: string;
  detectionStatus: 'idle' | 'pending' | 'ready' | 'error';
  provider?: string;
  model?: string;
  interactionCount?: number;
  updatedAt: number;
}

const DB_NAME = 'pdf-task-document-cache-db';
const STORE_NAME = 'task-documents';
const DB_VERSION = 1;

export async function loadCachedTaskDocument(fileHash: string): Promise<CachedTaskDocumentRecord | null> {
  const db = await openDatabase();
  if (!db) {
    return null;
  }

  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(fileHash);
    request.onsuccess = () => {
      const record = (request.result as CachedTaskDocumentRecord | undefined) ?? null;
      resolve(record);
    };
    request.onerror = () => resolve(null);
  });
}

export async function saveCachedTaskDocument(record: CachedTaskDocumentRecord): Promise<void> {
  const db = await openDatabase();
  if (!db) {
    return;
  }

  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function deleteCachedTaskDocument(fileHash: string): Promise<void> {
  const db = await openDatabase();
  if (!db) {
    return;
  }

  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(fileHash);
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
        db.createObjectStore(STORE_NAME, { keyPath: 'fileHash' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}
