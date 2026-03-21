import { canUseLocalStorage } from './storage';

const APP_LOCAL_STORAGE_KEY_PREFIXES = [
  'rewrite-',
  'semantic-search-',
  'structured-extract-',
  'gemini-',
  'openai-',
  'lmstudio-'
] as const;

const APP_LOCAL_STORAGE_EXACT_KEYS = [
  'focus-recordings-v1'
] as const;

const APP_INDEXED_DB_NAMES = [
  'pdf-layout-file-cache',
  'pdf-task-document-cache-db',
  'pdf-gemini-extraction-db',
  'pdf-annotations-db',
  'semantic-search-db',
  'search-history-db',
  'math-cache-db',
  'image-explanation-cache-db',
  'table-visualization-cache-db'
] as const;

export interface ResetLocalAppDataResult {
  removedLocalStorageKeys: string[];
  clearedIndexedDbNames: string[];
  failedIndexedDbNames: Array<{ name: string; reason: string }>;
}

export async function resetLocalAppData(): Promise<ResetLocalAppDataResult> {
  const removedLocalStorageKeys = clearAppLocalStorageKeys();
  const { cleared, failed } = await clearIndexedDbCaches();

  return {
    removedLocalStorageKeys,
    clearedIndexedDbNames: cleared,
    failedIndexedDbNames: failed
  };
}

function clearAppLocalStorageKeys(): string[] {
  if (!canUseLocalStorage()) {
    return [];
  }

  const removed: string[] = [];
  const toRemove: string[] = [];

  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key) {
        continue;
      }
      if (isAppLocalStorageKey(key)) {
        toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      window.localStorage.removeItem(key);
      removed.push(key);
    }
  } catch (error) {
    console.warn('[ResetLocalAppData] Failed to clear localStorage keys', error);
  }

  return removed;
}

function isAppLocalStorageKey(key: string): boolean {
  if (APP_LOCAL_STORAGE_EXACT_KEYS.includes(key as (typeof APP_LOCAL_STORAGE_EXACT_KEYS)[number])) {
    return true;
  }
  return APP_LOCAL_STORAGE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

async function clearIndexedDbCaches(): Promise<{
  cleared: string[];
  failed: Array<{ name: string; reason: string }>;
}> {
  if (typeof indexedDB === 'undefined') {
    return { cleared: [], failed: [] };
  }

  const existingDbNames = await listIndexedDbNamesSafe();
  const targets = existingDbNames
    ? APP_INDEXED_DB_NAMES.filter((name) => existingDbNames.has(name))
    : [...APP_INDEXED_DB_NAMES];

  const cleared: string[] = [];
  const failed: Array<{ name: string; reason: string }> = [];

  for (const dbName of targets) {
    try {
      await clearIndexedDbStores(dbName);
      cleared.push(dbName);
    } catch (error) {
      failed.push({
        name: dbName,
        reason: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  return { cleared, failed };
}

async function listIndexedDbNamesSafe(): Promise<Set<string> | null> {
  const factory = indexedDB as IDBFactory & {
    databases?: () => Promise<Array<{ name?: string }>>;
  };

  if (typeof factory.databases !== 'function') {
    return null;
  }

  try {
    const dbs = await factory.databases();
    const names = new Set<string>();
    for (const db of dbs) {
      if (typeof db.name === 'string' && db.name.length > 0) {
        names.add(db.name);
      }
    }
    return names;
  } catch (error) {
    console.warn('[ResetLocalAppData] indexedDB.databases() failed', error);
    return null;
  }
}

function clearIndexedDbStores(dbName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(dbName);

    openRequest.onerror = () => {
      reject(new Error(openRequest.error?.message ?? `Failed to open database "${dbName}"`));
    };

    openRequest.onsuccess = () => {
      const db = openRequest.result;
      const storeNames = Array.from(db.objectStoreNames);

      if (storeNames.length === 0) {
        db.close();
        resolve();
        return;
      }

      let transaction: IDBTransaction;
      try {
        transaction = db.transaction(storeNames, 'readwrite');
      } catch (error) {
        db.close();
        reject(error instanceof Error ? error : new Error(`Failed to clear database "${dbName}"`));
        return;
      }

      transaction.onerror = () => {
        db.close();
        reject(new Error(transaction.error?.message ?? `Failed to clear database "${dbName}"`));
      };

      transaction.onabort = () => {
        db.close();
        reject(new Error(transaction.error?.message ?? `Clearing database "${dbName}" was aborted`));
      };

      transaction.oncomplete = () => {
        db.close();
        resolve();
      };

      for (const storeName of storeNames) {
        transaction.objectStore(storeName).clear();
      }
    };

    openRequest.onblocked = () => {
      reject(new Error(`Database "${dbName}" is blocked by another tab`));
    };
  });
}
