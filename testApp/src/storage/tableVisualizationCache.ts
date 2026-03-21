const DB_NAME = 'table-visualization-cache-db';
const DB_VERSION = 1;
const STORE_NAME = 'table-visualization-cache';
const CACHE_KEY_VERSION = 'v2';

type CachedChartImage = {
  key: string;
  kind: 'chart-image';
  dataUri: string;
  mimeType?: string;
  prompt?: string;
  timestamp: number;
  tableId?: string;
  provider?: string;
  model?: string;
};

type CacheEntry = CachedChartImage;

let dbPromise: Promise<IDBDatabase> | null = null;

export function generateTableVisualizationCacheKey(input: {
  tableId: string;
  provider: string;
  model?: string;
  variant: 'chart-image';
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

export async function hasCachedChartImageForTable(tableId: string): Promise<boolean> {
  const entry = await getLatestCachedChartImageForTable(tableId);
  return Boolean(entry);
}

export async function getLatestCachedChartImageForTable(tableId: string): Promise<{
  key: string;
  dataUri: string;
  mimeType?: string;
  prompt?: string;
  model?: string;
} | null> {
  const entries = await getAllEntries();
  let latest: CachedChartImage | null = null;

  for (const entry of entries) {
    if (entry.kind !== 'chart-image') {
      continue;
    }
    const entryTableId = entry.tableId ?? parseTableIdFromCacheKey(entry.key);
    if (entryTableId !== tableId) {
      continue;
    }
    if (!latest || entry.timestamp > latest.timestamp) {
      latest = entry;
    }
  }

  if (!latest) {
    return null;
  }

  return {
    key: latest.key,
    dataUri: latest.dataUri,
    mimeType: latest.mimeType,
    prompt: latest.prompt,
    model: latest.model ?? parseModelFromCacheKey(latest.key)
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
    timestamp: Date.now(),
    tableId: parseTableIdFromCacheKey(key) ?? undefined,
    provider: parseProviderFromCacheKey(key) ?? undefined,
    model: parseModelFromCacheKey(key) ?? undefined
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

async function getAllEntries(): Promise<CacheEntry[]> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve((request.result as CacheEntry[] | undefined) ?? []);
      };

      request.onerror = () => {
        resolve([]);
      };
    });
  } catch {
    return [];
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

function parseTableIdFromCacheKey(key: string): string | null {
  const parts = key.split('|');
  return parts.length >= 6 ? parts[4] : null;
}

function parseProviderFromCacheKey(key: string): string | null {
  const parts = key.split('|');
  return parts.length >= 6 ? parts[2] : null;
}

function parseModelFromCacheKey(key: string): string | null {
  const parts = key.split('|');
  return parts.length >= 6 ? parts[3] : null;
}
