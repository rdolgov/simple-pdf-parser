/**
 * IndexedDB cache for AI-generated image explanations.
 * Stores explanations keyed by document ID, page number, and image bounds.
 */

const DB_NAME = 'image-explanation-cache-db';
const DB_VERSION = 1;
const STORE_NAME = 'explanations';

export interface ImageExplanationEntry {
  key: string;
  documentId: string;
  pageNumber: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  explanation: string;
  timestamp: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      dbPromise = null;
      reject(new Error('Failed to open image explanation cache database'));
    };

    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.close();
        dbPromise = null;
        const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
        deleteRequest.onsuccess = () => {
          dbPromise = null;
          openDB().then(resolve).catch(reject);
        };
        deleteRequest.onerror = () => {
          reject(new Error('Failed to reset image explanation cache database'));
        };
        return;
      }
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('documentId', 'documentId', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onblocked = () => {
      dbPromise = null;
      reject(new Error('Database blocked - please close other tabs'));
    };
  });

  return dbPromise;
}

/**
 * Generate a cache key from document ID, page number, and image bounds.
 */
export function generateImageExplanationKey(
  documentId: string,
  pageNumber: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
): string {
  // Round bounds to avoid floating point issues
  const roundedBounds = {
    minX: Math.round(bounds.minX * 100) / 100,
    minY: Math.round(bounds.minY * 100) / 100,
    maxX: Math.round(bounds.maxX * 100) / 100,
    maxY: Math.round(bounds.maxY * 100) / 100
  };
  return `${documentId}:${pageNumber}:${roundedBounds.minX},${roundedBounds.minY},${roundedBounds.maxX},${roundedBounds.maxY}`;
}

/**
 * Get cached explanation for the given image.
 */
export async function getCachedImageExplanation(
  documentId: string,
  pageNumber: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
): Promise<{ explanation: string; timestamp: number } | null> {
  try {
    const db = await openDB();
    const key = generateImageExplanationKey(documentId, pageNumber, bounds);

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        const entry = request.result as ImageExplanationEntry | undefined;
        if (entry?.explanation) {
          console.debug('[ImageExplanationCache] Cache hit');
          resolve({ explanation: entry.explanation, timestamp: entry.timestamp });
        } else {
          console.debug('[ImageExplanationCache] Cache miss');
          resolve(null);
        }
      };

      request.onerror = () => {
        console.debug('[ImageExplanationCache] Cache error');
        resolve(null);
      };
    });
  } catch (err) {
    console.debug('[ImageExplanationCache] Cache exception:', err);
    return null;
  }
}

/**
 * Store image explanation in cache.
 */
export async function setCachedImageExplanation(
  documentId: string,
  pageNumber: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  explanation: string
): Promise<void> {
  try {
    const db = await openDB();
    const key = generateImageExplanationKey(documentId, pageNumber, bounds);

    const entry: ImageExplanationEntry = {
      key,
      documentId,
      pageNumber,
      bounds,
      explanation,
      timestamp: Date.now()
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(entry);

      request.onsuccess = () => {
        console.debug('[ImageExplanationCache] Cached explanation');
        resolve();
      };

      request.onerror = () => {
        reject(new Error('Failed to cache image explanation'));
      };
    });
  } catch {
    // Silently fail cache writes
  }
}

/**
 * Delete a specific cached image explanation.
 */
export async function deleteCachedImageExplanation(
  documentId: string,
  pageNumber: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
): Promise<boolean> {
  try {
    const db = await openDB();
    const key = generateImageExplanationKey(documentId, pageNumber, bounds);

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);

      request.onsuccess = () => {
        console.debug('[ImageExplanationCache] Deleted explanation');
        resolve(true);
      };

      request.onerror = () => {
        resolve(false);
      };
    });
  } catch {
    return false;
  }
}

/**
 * Clear all cached explanations for a document.
 */
export async function clearDocumentImageExplanations(documentId: string): Promise<void> {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('documentId');
      const request = index.getAllKeys(documentId);

      request.onsuccess = () => {
        const keys = request.result;
        if (keys.length === 0) {
          resolve();
          return;
        }

        let completed = 0;
        for (const key of keys) {
          const deleteReq = store.delete(key);
          deleteReq.onsuccess = () => {
            completed++;
            if (completed === keys.length) {
              resolve();
            }
          };
          deleteReq.onerror = () => {
            reject(new Error('Failed to clear image explanations'));
          };
        }
      };

      request.onerror = () => {
        reject(new Error('Failed to clear image explanations'));
      };
    });
  } catch {
    // Silently fail
  }
}
