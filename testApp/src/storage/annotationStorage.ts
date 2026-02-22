/**
 * Generic annotation storage using IndexedDB
 * Stores annotations tied to specific positions in PDF documents
 */

// ============================================================================
// Types
// ============================================================================

export type AnnotationType = 'chat' | 'image' | 'note' | 'highlight';

export interface AnnotationBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ChatAnnotationContent {
  messages: ChatMessage[];
  contextText: string;
}

export interface ImageAnnotationContent {
  dataUri: string;
  mimeType?: string;
  prompt?: string;
}

export interface NoteAnnotationContent {
  text: string;
}

export interface HighlightAnnotationContent {
  color: string;
  text?: string;
}

export type AnnotationContent =
  | ChatAnnotationContent
  | ImageAnnotationContent
  | NoteAnnotationContent
  | HighlightAnnotationContent;

export interface Annotation {
  id: string;
  documentId: string;
  type: AnnotationType;
  pageNumber: number;
  bounds: AnnotationBounds;
  content: AnnotationContent;
  createdAt: number;
  updatedAt: number;
}

export interface AnnotationSummary {
  id: string;
  type: AnnotationType;
  pageNumber: number;
  bounds: AnnotationBounds;
  createdAt: number;
  updatedAt: number;
  preview?: string;
}

// ============================================================================
// IndexedDB Setup
// ============================================================================

const DB_NAME = 'pdf-annotations-db';
const DB_VERSION = 1;
const STORE_NAME = 'annotations';

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
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('documentId', 'documentId', { unique: false });
        store.createIndex('documentPage', ['documentId', 'pageNumber'], { unique: false });
        store.createIndex('type', 'type', { unique: false });
      }
    };
  });

  return dbPromise;
}

// ============================================================================
// Helper Functions
// ============================================================================

export function generateAnnotationId(): string {
  return `ann_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function boundsMatch(a: AnnotationBounds, b: AnnotationBounds, tolerance = 5): boolean {
  return (
    Math.abs(a.minX - b.minX) <= tolerance &&
    Math.abs(a.minY - b.minY) <= tolerance &&
    Math.abs(a.maxX - b.maxX) <= tolerance &&
    Math.abs(a.maxY - b.maxY) <= tolerance
  );
}

export function getAnnotationPreview(annotation: Annotation): string {
  switch (annotation.type) {
    case 'chat': {
      const chat = annotation.content as ChatAnnotationContent;
      const lastMessage = chat.messages[chat.messages.length - 1];
      return lastMessage?.content.slice(0, 50) + (lastMessage?.content.length > 50 ? '...' : '') || 'Empty chat';
    }
    case 'image': {
      const image = annotation.content as ImageAnnotationContent;
      return image.prompt?.slice(0, 50) || 'Generated image';
    }
    case 'note': {
      const note = annotation.content as NoteAnnotationContent;
      return note.text.slice(0, 50) + (note.text.length > 50 ? '...' : '');
    }
    case 'highlight': {
      const highlight = annotation.content as HighlightAnnotationContent;
      return highlight.text?.slice(0, 50) || 'Highlight';
    }
    default:
      return 'Annotation';
  }
}

// ============================================================================
// CRUD Operations
// ============================================================================

export async function saveAnnotation(annotation: Annotation): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(annotation);

    request.onerror = () => {
      reject(new Error(`Failed to save annotation: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve();
    };
  });
}

export async function getAnnotation(id: string): Promise<Annotation | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onerror = () => {
      reject(new Error(`Failed to get annotation: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve(request.result ?? null);
    };
  });
}

export async function deleteAnnotation(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onerror = () => {
      reject(new Error(`Failed to delete annotation: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve();
    };
  });
}

export async function getAnnotationsByDocument(documentId: string): Promise<Annotation[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('documentId');
    const request = index.getAll(documentId);

    request.onerror = () => {
      reject(new Error(`Failed to get annotations: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve(request.result ?? []);
    };
  });
}

export async function getAnnotationsByPage(
  documentId: string,
  pageNumber: number
): Promise<Annotation[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('documentPage');
    const request = index.getAll([documentId, pageNumber]);

    request.onerror = () => {
      reject(new Error(`Failed to get annotations: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      resolve(request.result ?? []);
    };
  });
}

export async function findAnnotationAtBounds(
  documentId: string,
  pageNumber: number,
  bounds: AnnotationBounds,
  type?: AnnotationType
): Promise<Annotation | null> {
  const annotations = await getAnnotationsByPage(documentId, pageNumber);

  for (const annotation of annotations) {
    if (type && annotation.type !== type) {
      continue;
    }
    if (boundsMatch(annotation.bounds, bounds)) {
      return annotation;
    }
  }

  return null;
}

export async function getAnnotationSummaries(documentId: string): Promise<AnnotationSummary[]> {
  const annotations = await getAnnotationsByDocument(documentId);
  return annotations.map((ann) => ({
    id: ann.id,
    type: ann.type,
    pageNumber: ann.pageNumber,
    bounds: ann.bounds,
    createdAt: ann.createdAt,
    updatedAt: ann.updatedAt,
    preview: getAnnotationPreview(ann)
  }));
}

export async function clearDocumentAnnotations(documentId: string): Promise<void> {
  const annotations = await getAnnotationsByDocument(documentId);
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    let completed = 0;
    let hasError = false;

    if (annotations.length === 0) {
      resolve();
      return;
    }

    for (const annotation of annotations) {
      const request = store.delete(annotation.id);

      request.onerror = () => {
        if (!hasError) {
          hasError = true;
          reject(new Error(`Failed to delete annotation: ${request.error?.message}`));
        }
      };

      request.onsuccess = () => {
        completed++;
        if (completed === annotations.length && !hasError) {
          resolve();
        }
      };
    }
  });
}

// ============================================================================
// Chat-specific helpers
// ============================================================================

export async function saveOrUpdateChatAnnotation(
  documentId: string,
  pageNumber: number,
  bounds: AnnotationBounds,
  contextText: string,
  messages: ChatMessage[]
): Promise<Annotation> {
  const existing = await findAnnotationAtBounds(documentId, pageNumber, bounds, 'chat');
  const now = Date.now();

  if (existing) {
    const updated: Annotation = {
      ...existing,
      content: { messages, contextText } as ChatAnnotationContent,
      updatedAt: now
    };
    await saveAnnotation(updated);
    return updated;
  }

  const newAnnotation: Annotation = {
    id: generateAnnotationId(),
    documentId,
    type: 'chat',
    pageNumber,
    bounds,
    content: { messages, contextText } as ChatAnnotationContent,
    createdAt: now,
    updatedAt: now
  };

  await saveAnnotation(newAnnotation);
  return newAnnotation;
}

export async function getChatAnnotation(
  documentId: string,
  pageNumber: number,
  bounds: AnnotationBounds
): Promise<Annotation | null> {
  return findAnnotationAtBounds(documentId, pageNumber, bounds, 'chat');
}

// ============================================================================
// Image-specific helpers
// ============================================================================

export async function saveOrUpdateImageAnnotation(
  documentId: string,
  pageNumber: number,
  bounds: AnnotationBounds,
  dataUri: string,
  mimeType?: string,
  prompt?: string
): Promise<Annotation> {
  const existing = await findAnnotationAtBounds(documentId, pageNumber, bounds, 'image');
  const now = Date.now();

  if (existing) {
    const updated: Annotation = {
      ...existing,
      content: { dataUri, mimeType, prompt } as ImageAnnotationContent,
      updatedAt: now
    };
    await saveAnnotation(updated);
    return updated;
  }

  const newAnnotation: Annotation = {
    id: generateAnnotationId(),
    documentId,
    type: 'image',
    pageNumber,
    bounds,
    content: { dataUri, mimeType, prompt } as ImageAnnotationContent,
    createdAt: now,
    updatedAt: now
  };

  await saveAnnotation(newAnnotation);
  return newAnnotation;
}

export async function getImageAnnotation(
  documentId: string,
  pageNumber: number,
  bounds: AnnotationBounds
): Promise<Annotation | null> {
  return findAnnotationAtBounds(documentId, pageNumber, bounds, 'image');
}
