/**
 * IndexedDB storage for search history
 */

const DB_NAME = 'search-history-db';
const DB_VERSION = 1;
const STORE_NAME = 'searches';
const MAX_HISTORY_ITEMS = 20;

export interface SearchHistoryEntry {
  id: string;
  query: string;
  timestamp: number;
  documentId?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      dbPromise = null;
      reject(new Error('Failed to open search history database'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('query', 'query', { unique: false });
      }
    };
  });

  return dbPromise;
}

function generateId(): string {
  return `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export async function addSearchToHistory(query: string, documentId?: string): Promise<void> {
  const trimmed = query.trim();
  if (!trimmed) return;

  try {
    const db = await openDatabase();

    // Check if this query already exists
    const existing = await getSearchHistory();
    const existingIndex = existing.findIndex(
      (e) => e.query.toLowerCase() === trimmed.toLowerCase()
    );

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      // If query exists, delete the old one (we'll add it fresh with new timestamp)
      if (existingIndex >= 0) {
        store.delete(existing[existingIndex].id);
      }

      // Add new entry
      const entry: SearchHistoryEntry = {
        id: generateId(),
        query: trimmed,
        timestamp: Date.now(),
        documentId
      };

      const addRequest = store.add(entry);

      addRequest.onerror = () => {
        reject(new Error('Failed to add search to history'));
      };

      addRequest.onsuccess = () => {
        // Cleanup old entries if we have too many
        void cleanupOldEntries().then(resolve).catch(resolve);
      };
    });
  } catch (err) {
    console.error('Failed to add search to history:', err);
  }
}

export async function getSearchHistory(limit = MAX_HISTORY_ITEMS): Promise<SearchHistoryEntry[]> {
  try {
    const db = await openDatabase();

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const request = index.getAll();

      request.onsuccess = () => {
        const entries = (request.result as SearchHistoryEntry[]) ?? [];
        // Sort by timestamp descending (newest first) and limit
        const sorted = entries
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, limit);
        resolve(sorted);
      };

      request.onerror = () => {
        resolve([]);
      };
    });
  } catch {
    return [];
  }
}

export async function deleteSearchFromHistory(id: string): Promise<void> {
  try {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to delete search'));
    });
  } catch (err) {
    console.error('Failed to delete search from history:', err);
  }
}

export async function clearSearchHistory(): Promise<void> {
  try {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to clear search history'));
    });
  } catch (err) {
    console.error('Failed to clear search history:', err);
  }
}

async function cleanupOldEntries(): Promise<void> {
  try {
    const entries = await getSearchHistory(MAX_HISTORY_ITEMS + 10);
    if (entries.length <= MAX_HISTORY_ITEMS) return;

    const db = await openDatabase();
    const toDelete = entries.slice(MAX_HISTORY_ITEMS);

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      let completed = 0;
      for (const entry of toDelete) {
        const request = store.delete(entry.id);
        request.onsuccess = () => {
          completed++;
          if (completed === toDelete.length) {
            resolve();
          }
        };
        request.onerror = () => {
          completed++;
          if (completed === toDelete.length) {
            resolve();
          }
        };
      }

      if (toDelete.length === 0) {
        resolve();
      }
    });
  } catch {
    // Silently fail cleanup
  }
}
