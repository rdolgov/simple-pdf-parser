/**
 * Storage for Gemini PDF extraction results using IndexedDB
 * Caches structured extraction responses to avoid repeated API calls
 */

// ============================================================================
// Types
// ============================================================================

export type GeminiElementType =
  | 'title'
  | 'authors'
  | 'heading'
  | 'paragraph'
  | 'footnote'
  | 'reference'
  | 'image'
  | 'table'
  | 'formula'
  | 'caption'
  | 'list';

export interface GeminiElementBounds {
  /** [x, y, width, height] as ratios (0-1) of page dimensions */
  bounding_box: [number, number, number, number];
}

export interface GeminiElement extends GeminiElementBounds {
  type: GeminiElementType;
  content: string | Record<string, unknown>;
  description?: string;
}

export interface GeminiPageExtraction {
  page_number: number;
  elements: GeminiElement[];
}

export interface GeminiDocumentExtraction {
  document_title?: string;
  pages: GeminiPageExtraction[];
}

export interface GeminiExtractionRecord {
  documentHash: string;
  extraction: GeminiDocumentExtraction;
  createdAt: number;
  provider?: 'gemini' | 'openai';
  model?: string;
}

// ============================================================================
// IndexedDB Setup
// ============================================================================

const DB_NAME = 'pdf-gemini-extraction-db';
const DB_VERSION = 1;
const STORE_NAME = 'extractions';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'documentHash' });
      }
    };
  });

  return dbPromise;
}

// ============================================================================
// CRUD Operations
// ============================================================================

export async function saveGeminiExtraction(record: GeminiExtractionRecord): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(record);

    request.onerror = () => {
      reject(new Error(`Failed to save extraction: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve();
    };
  });
}

export async function getGeminiExtraction(documentHash: string): Promise<GeminiExtractionRecord | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(documentHash);

    request.onerror = () => {
      reject(new Error(`Failed to get extraction: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve(request.result ?? null);
    };
  });
}

export async function deleteGeminiExtraction(documentHash: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(documentHash);

    request.onerror = () => {
      reject(new Error(`Failed to delete extraction: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve();
    };
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert bounding box ratios to PDF coordinates
 * @param bbox [x, y, width, height] ratios (0-1)
 * @param pageWidth PDF page width in points
 * @param pageHeight PDF page height in points
 */
export function convertBoundsToCoordinates(
  bbox: [number, number, number, number],
  pageWidth: number,
  pageHeight: number
): { minX: number; minY: number; maxX: number; maxY: number } {
  const [x, y, width, height] = bbox;
  // PDF coordinates: origin at bottom-left, Y increases upward
  // Gemini bbox: origin at top-left, Y increases downward
  const minX = x * pageWidth;
  const maxX = (x + width) * pageWidth;
  // Convert from top-down to bottom-up Y coordinate
  const minY = (1 - y - height) * pageHeight;
  const maxY = (1 - y) * pageHeight;
  return { minX, minY, maxX, maxY };
}

/**
 * Check if a point is within a bounding box
 * @param tolerance Optional padding in PDF points to expand the hit area (default: 10)
 */
export function isPointInBounds(
  pdfX: number,
  pdfY: number,
  bbox: [number, number, number, number],
  pageWidth: number,
  pageHeight: number,
  tolerance: number = 10
): boolean {
  const coords = convertBoundsToCoordinates(bbox, pageWidth, pageHeight);
  return (
    pdfX >= coords.minX - tolerance &&
    pdfX <= coords.maxX + tolerance &&
    pdfY >= coords.minY - tolerance &&
    pdfY <= coords.maxY + tolerance
  );
}

/**
 * Get tolerance for hit detection based on element type
 * Formulas need larger tolerance because Gemini's bounding boxes are often inaccurate
 */
function getToleranceForElementType(elementType?: GeminiElementType): number {
  switch (elementType) {
    case 'formula':
      return 60; // Formulas often have very inaccurate bounding boxes
    case 'reference':
      return 20; // References are usually small, moderate tolerance
    case 'table':
      return 30; // Tables can have slightly off bounds
    default:
      return 10; // Default tolerance for other elements
  }
}

/**
 * Find element at a given point on a page
 * Uses element-type-specific tolerance to handle inaccurate bounding boxes
 */
export function findElementAtPoint(
  extraction: GeminiDocumentExtraction,
  pageNumber: number,
  pdfX: number,
  pdfY: number,
  pageWidth: number,
  pageHeight: number,
  elementType?: GeminiElementType
): GeminiElement | null {
  const page = extraction.pages.find((p) => p.page_number === pageNumber);
  if (!page) {
    return null;
  }

  const tolerance = getToleranceForElementType(elementType);

  // Try match with element-type-specific tolerance
  for (const element of page.elements) {
    if (elementType && element.type !== elementType) {
      continue;
    }
    if (isPointInBounds(pdfX, pdfY, element.bounding_box, pageWidth, pageHeight, tolerance)) {
      return element;
    }
  }

  return null;
}

/**
 * Find the nearest element of a specific type on a page
 * This is useful as a fallback when exact bounds matching fails due to inaccurate bounding boxes
 * Only use this when you're confident the user is clicking on "empty" space (not on another element)
 */
export function findNearestElementOfType(
  extraction: GeminiDocumentExtraction,
  pageNumber: number,
  pdfX: number,
  pdfY: number,
  pageWidth: number,
  pageHeight: number,
  elementType: GeminiElementType,
  maxDistance: number = 400
): GeminiElement | null {
  const page = extraction.pages.find((p) => p.page_number === pageNumber);
  if (!page) {
    return null;
  }

  const elementsOfType = page.elements.filter(el => el.type === elementType);
  if (elementsOfType.length === 0) {
    return null;
  }

  let nearestElement: GeminiElement | null = null;
  let nearestDistance = Infinity;

  for (const element of elementsOfType) {
    const bounds = convertBoundsToCoordinates(element.bounding_box, pageWidth, pageHeight);
    // Calculate distance from click point to the center of the element
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const distance = Math.sqrt(Math.pow(pdfX - centerX, 2) + Math.pow(pdfY - centerY, 2));

    if (distance < nearestDistance && distance < maxDistance) {
      nearestDistance = distance;
      nearestElement = element;
    }
  }

  if (nearestElement) {
    console.debug(`Found nearest ${elementType} at distance ${nearestDistance.toFixed(1)} points`);
  }
  return nearestElement;
}

/**
 * Check if any Gemini element exists at the given point
 * Used to determine if user clicked on "empty" space vs on a detected element
 */
export function hasAnyElementAtPoint(
  extraction: GeminiDocumentExtraction,
  pageNumber: number,
  pdfX: number,
  pdfY: number,
  pageWidth: number,
  pageHeight: number
): boolean {
  const page = extraction.pages.find((p) => p.page_number === pageNumber);
  if (!page) {
    return false;
  }

  for (const element of page.elements) {
    if (isPointInBounds(pdfX, pdfY, element.bounding_box, pageWidth, pageHeight)) {
      return true;
    }
  }
  return false;
}

/**
 * Find all reference elements on a page
 */
export function findReferenceElements(
  extraction: GeminiDocumentExtraction,
  pageNumber: number
): GeminiElement[] {
  const page = extraction.pages.find((p) => p.page_number === pageNumber);
  if (!page) {
    return [];
  }
  return page.elements.filter((el) => el.type === 'reference');
}

/**
 * Find a reference element by its citation number (e.g., "15" for [15])
 * Searches all pages in the document for matching references
 */
export function findReferenceByCitation(
  extraction: GeminiDocumentExtraction,
  citationNumber: string
): GeminiElement | null {
  // Search all pages for references
  for (const page of extraction.pages) {
    for (const element of page.elements) {
      if (element.type !== 'reference') {
        continue;
      }
      const content = element.content;
      // Check if content starts with the citation number
      // References can be like "15. Author Name, Title..." or "[15] Author Name..."
      if (typeof content === 'string') {
        // Match patterns like "15.", "15 ", "[15]", "(15)"
        const startsWithNumber = new RegExp(`^\\[?\\(?${citationNumber}[\\]\\)\\.]`).test(content.trim());
        if (startsWithNumber) {
          return element;
        }
        // Also check if it starts with just the number followed by space or punctuation
        const simpleStart = new RegExp(`^${citationNumber}[.\\s]`).test(content.trim());
        if (simpleStart) {
          return element;
        }
      } else if (typeof content === 'object' && content !== null) {
        // Handle structured reference content
        const refNum = (content as any).number ?? (content as any).id ?? (content as any).citation;
        if (String(refNum) === citationNumber) {
          return element;
        }
      }
    }
  }
  return null;
}

/**
 * Parse the Gemini response JSON, handling markdown code blocks
 */
export function parseGeminiExtractionResponse(text: string): GeminiDocumentExtraction {
  // Remove markdown code block wrappers if present
  let jsonText = text.trim();
  if (jsonText.startsWith('```json')) {
    jsonText = jsonText.slice(7);
  } else if (jsonText.startsWith('```')) {
    jsonText = jsonText.slice(3);
  }
  if (jsonText.endsWith('```')) {
    jsonText = jsonText.slice(0, -3);
  }
  jsonText = jsonText.trim();

  return JSON.parse(jsonText) as GeminiDocumentExtraction;
}
