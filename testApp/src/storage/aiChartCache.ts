/**
 * IndexedDB cache for AI-generated chart configurations.
 * Stores the ChartConfiguration keyed by a hash of the table data.
 */

import type { ChartConfiguration } from 'chart.js';

const DB_NAME = 'ai-chart-cache-db';
const DB_VERSION = 1;
const STORE_NAME = 'chart-cache';

interface ChartCacheEntry {
  tableKey: string;
  config: ChartConfiguration;
  note?: string;
  timestamp: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      dbPromise = null;
      reject(new Error('Failed to open AI chart cache database'));
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
          reject(new Error('Failed to reset AI chart cache database'));
        };
        return;
      }
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'tableKey' });
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
 * Generate a cache key from table data.
 * Uses table ID and cell content to create a unique key.
 */
export function generateTableCacheKey(tableId: string, cells: Array<{ row: number; col: number; text: string }>): string {
  // Create a deterministic string from table data
  const cellsString = cells
    .map(c => `${c.row}:${c.col}:${c.text}`)
    .sort()
    .join('|');
  return `${tableId}:${cellsString}`;
}

/**
 * Get cached AI chart config for the given table key.
 * Returns null if not found in cache.
 */
export async function getCachedAiChart(tableKey: string): Promise<{ config: ChartConfiguration; note?: string } | null> {
  try {
    const db = await openDB();

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(tableKey);

      request.onsuccess = () => {
        const entry = request.result as ChartCacheEntry | undefined;
        if (entry?.config) {
          console.debug('[AiChartCache] Cache hit for table');
          resolve({ config: entry.config, note: entry.note });
        } else {
          console.debug('[AiChartCache] Cache miss');
          resolve(null);
        }
      };

      request.onerror = () => {
        console.debug('[AiChartCache] Cache error');
        resolve(null);
      };
    });
  } catch (err) {
    console.debug('[AiChartCache] Cache exception:', err);
    return null;
  }
}

/**
 * Store AI chart config in cache for the given table key.
 */
export async function setCachedAiChart(tableKey: string, config: ChartConfiguration, note?: string): Promise<void> {
  try {
    const db = await openDB();

    const entry: ChartCacheEntry = {
      tableKey,
      config,
      note,
      timestamp: Date.now()
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(entry);

      request.onsuccess = () => {
        console.debug('[AiChartCache] Cached chart config');
        resolve();
      };

      request.onerror = () => {
        reject(new Error('Failed to cache AI chart'));
      };
    });
  } catch {
    // Silently fail cache writes
  }
}

/**
 * Clear all cached AI charts.
 */
export async function clearAiChartCache(): Promise<void> {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.clear();

      transaction.oncomplete = () => {
        resolve();
      };

      transaction.onerror = () => {
        reject(new Error('Failed to clear AI chart cache'));
      };
    });
  } catch {
    // Silently fail
  }
}
