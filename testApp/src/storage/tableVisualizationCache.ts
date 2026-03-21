import type { ChartConfiguration } from 'chart.js';

const DB_NAME = 'table-visualization-cache-db';
const DB_VERSION = 1;
const STORE_NAME = 'table-visualization-cache';
const CACHE_KEY_VERSION = 'v2';

type CachedInteractiveChart = {
  key: string;
  kind: 'interactive-chart';
  config: ChartConfiguration;
  title?: string;
  note?: string;
  timestamp: number;
};

type CachedChartImage = {
  key: string;
  kind: 'chart-image';
  dataUri: string;
  mimeType?: string;
  prompt?: string;
  timestamp: number;
};

type CacheEntry = CachedInteractiveChart | CachedChartImage;

let dbPromise: Promise<IDBDatabase> | null = null;

export function generateTableVisualizationCacheKey(input: {
  tableId: string;
  provider: string;
  model?: string;
  variant: 'interactive-chart' | 'chart-image';
  cells: Array<{ row: number; col: number; text: string }>;
}): string {
  const cellsString = input.cells
    .map((cell) => `${cell.row}:${cell.col}:${cell.text}`)
    .sort()
    .join('|');
  return [
    CACHE_KEY_VERSION,
    input.variant,
    input.provider,
    input.model?.trim() || 'default-model',
    input.tableId,
    cellsString
  ].join('|');
}

export async function getCachedInteractiveChart(key: string): Promise<{
  config: ChartConfiguration;
  title?: string;
  note?: string;
} | null> {
  const entry = await getEntry(key);
  if (!entry || entry.kind !== 'interactive-chart') {
    return null;
  }
  return {
    config: entry.config,
    title: entry.title,
    note: entry.note
  };
}

export async function setCachedInteractiveChart(
  key: string,
  value: { config: ChartConfiguration; title?: string; note?: string }
): Promise<void> {
  await putEntry({
    key,
    kind: 'interactive-chart',
    config: value.config,
    title: value.title,
    note: value.note,
    timestamp: Date.now()
  });
}

export async function getCachedChartImage(key: string): Promise<{
  dataUri: string;
  mimeType?: string;
  prompt?: string;
} | null> {
  const entry = await getEntry(key);
  if (!entry || entry.kind !== 'chart-image') {
    return null;
  }
  return {
    dataUri: entry.dataUri,
    mimeType: entry.mimeType,
    prompt: entry.prompt
  };
}

export async function setCachedChartImage(
  key: string,
  value: { dataUri: string; mimeType?: string; prompt?: string }
): Promise<void> {
  await putEntry({
    key,
    kind: 'chart-image',
    dataUri: value.dataUri,
    mimeType: value.mimeType,
    prompt: value.prompt,
    timestamp: Date.now()
  });
}

export async function deleteCachedTableVisualization(key: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to delete cached table visualization'));
    });
  } catch {
    // Best-effort cleanup only.
  }
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      dbPromise = null;
      reject(new Error('Failed to open table visualization cache database'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onblocked = () => {
      dbPromise = null;
      reject(new Error('Table visualization cache database is blocked'));
    };
  });

  return dbPromise;
}

async function getEntry(key: string): Promise<CacheEntry | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        resolve((request.result as CacheEntry | undefined) ?? null);
      };

      request.onerror = () => {
        resolve(null);
      };
    });
  } catch {
    return null;
  }
}

async function putEntry(entry: CacheEntry): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(entry);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to cache table visualization'));
    });
  } catch {
    // Cache writes are best-effort.
  }
}
