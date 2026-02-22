/**
 * IndexedDB cache for math/LaTeX detection results and explanations.
 * Stores the LaTeX output and explanations keyed by the original text/latex input.
 */

const DB_NAME = 'math-cache-db';
const DB_VERSION = 2;
const LATEX_STORE_NAME = 'latex-cache';
const EXPLANATION_STORE_NAME = 'explanation-cache';

interface LatexCacheEntry {
  input: string;
  latex: string;
  timestamp: number;
}

export interface FormulaExplanation {
  summary: string;
  parameters: Array<{ symbol: string; meaning: string }>;
  behavior?: string;
  example?: string;
}

interface ExplanationCacheEntry {
  latex: string;
  explanation: FormulaExplanation;
  timestamp: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      dbPromise = null; // Reset so we can retry
      reject(new Error('Failed to open math cache database'));
    };

    request.onsuccess = () => {
      const db = request.result;
      // Verify both stores exist, otherwise reset and reject
      if (!db.objectStoreNames.contains(LATEX_STORE_NAME) ||
          !db.objectStoreNames.contains(EXPLANATION_STORE_NAME)) {
        db.close();
        dbPromise = null;
        // Delete and recreate the database
        const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
        deleteRequest.onsuccess = () => {
          // Retry opening
          dbPromise = null;
          openDB().then(resolve).catch(reject);
        };
        deleteRequest.onerror = () => {
          reject(new Error('Failed to reset math cache database'));
        };
        return;
      }
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create latex cache store
      if (!db.objectStoreNames.contains(LATEX_STORE_NAME)) {
        const store = db.createObjectStore(LATEX_STORE_NAME, { keyPath: 'input' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Create explanation cache store
      if (!db.objectStoreNames.contains(EXPLANATION_STORE_NAME)) {
        const store = db.createObjectStore(EXPLANATION_STORE_NAME, { keyPath: 'latex' });
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
 * Generate a cache key from input text.
 * Normalizes whitespace to improve cache hit rate.
 */
function normalizeInput(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * Get cached LaTeX result for the given input text.
 * Returns null if not found in cache.
 */
export async function getCachedLatex(inputText: string): Promise<string | null> {
  try {
    const db = await openDB();
    const key = normalizeInput(inputText);

    return new Promise((resolve) => {
      const transaction = db.transaction(LATEX_STORE_NAME, 'readonly');
      const store = transaction.objectStore(LATEX_STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        const entry = request.result as LatexCacheEntry | undefined;
        if (entry && typeof entry.latex === 'string') {
          console.debug('[MathCache] LaTeX cache hit for:', key.slice(0, 50));
          resolve(entry.latex);
        } else {
          console.debug('[MathCache] LaTeX cache miss for:', key.slice(0, 50));
          resolve(null);
        }
      };

      request.onerror = () => {
        console.debug('[MathCache] LaTeX cache error');
        resolve(null);
      };
    });
  } catch (err) {
    console.debug('[MathCache] LaTeX cache exception:', err);
    return null;
  }
}

/**
 * Store LaTeX result in cache for the given input text.
 */
export async function setCachedLatex(inputText: string, latex: string): Promise<void> {
  try {
    const db = await openDB();
    const key = normalizeInput(inputText);

    const entry: LatexCacheEntry = {
      input: key,
      latex,
      timestamp: Date.now()
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(LATEX_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(LATEX_STORE_NAME);
      const request = store.put(entry);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error('Failed to cache LaTeX result'));
      };
    });
  } catch {
    // Silently fail cache writes
  }
}

/**
 * Get cached explanation for the given LaTeX.
 * Returns null if not found in cache.
 */
export async function getCachedExplanation(latex: string): Promise<FormulaExplanation | null> {
  try {
    const db = await openDB();
    const key = normalizeInput(latex);

    return new Promise((resolve) => {
      const transaction = db.transaction(EXPLANATION_STORE_NAME, 'readonly');
      const store = transaction.objectStore(EXPLANATION_STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        const entry = request.result as ExplanationCacheEntry | undefined;
        if (entry?.explanation) {
          console.debug('[MathCache] Explanation cache hit');
          resolve(entry.explanation);
        } else {
          console.debug('[MathCache] Explanation cache miss');
          resolve(null);
        }
      };

      request.onerror = () => {
        console.debug('[MathCache] Explanation cache error');
        resolve(null);
      };
    });
  } catch (err) {
    console.debug('[MathCache] Explanation cache exception:', err);
    return null;
  }
}

/**
 * Store explanation in cache for the given LaTeX.
 */
export async function setCachedExplanation(latex: string, explanation: FormulaExplanation): Promise<void> {
  try {
    const db = await openDB();
    const key = normalizeInput(latex);

    const entry: ExplanationCacheEntry = {
      latex: key,
      explanation,
      timestamp: Date.now()
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(EXPLANATION_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(EXPLANATION_STORE_NAME);
      const request = store.put(entry);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error('Failed to cache explanation'));
      };
    });
  } catch {
    // Silently fail cache writes
  }
}

/**
 * Clear all cached LaTeX results and explanations.
 */
export async function clearMathCache(): Promise<void> {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([LATEX_STORE_NAME, EXPLANATION_STORE_NAME], 'readwrite');

      const latexStore = transaction.objectStore(LATEX_STORE_NAME);
      const explanationStore = transaction.objectStore(EXPLANATION_STORE_NAME);

      latexStore.clear();
      explanationStore.clear();

      transaction.oncomplete = () => {
        resolve();
      };

      transaction.onerror = () => {
        reject(new Error('Failed to clear math cache'));
      };
    });
  } catch {
    // Silently fail
  }
}

/**
 * Get the number of cached entries.
 */
export async function getMathCacheSize(): Promise<number> {
  try {
    const db = await openDB();

    return new Promise((resolve) => {
      const transaction = db.transaction(LATEX_STORE_NAME, 'readonly');
      const store = transaction.objectStore(LATEX_STORE_NAME);
      const request = store.count();

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        resolve(0);
      };
    });
  } catch {
    return 0;
  }
}
