import { useState, useCallback, useEffect } from 'react';
import {
  PDFDocument,
  type PDFEmbeddedFontResource,
  type PDFLayout,
  type PDFPage,
  type StructuredDataDocument
} from 'pdf-layout-parser';
import type { LoadState, ExtractedTable, TableBounds } from '../types';
import { SUPPORTED_TYPES } from '../types';
import {
  computeBufferHash,
  loadCachedExtractPayload,
  saveCachedExtractPayload,
  saveCachedExtract,
  listCachedFiles,
  loadCachedFile,
  deleteCachedFile,
  type CachedFileSummary
} from '../utils/fileCache';
import { analyzeAiDetectionSupport, type AiDetectionSupport } from '../utils/aiDetectionSupport';
import type { PdfParseWorkerResponse } from '../workers/pdfParseProtocol';
import { deserializePdfPage } from '../workers/pdfPageTransfer';
import { uploadPdfAndStartDetection, waitForTaskDocumentDetection } from '../api/proxyTaskApi';
import {
  deleteCachedTaskDocument,
  loadCachedTaskDocument,
  saveCachedTaskDocument
} from '../storage/taskDocumentCache';
import { normalizeParsedTableRows } from '../utils/tableCellText';

const EXTRACT_CACHE_SCHEMA_VERSION = 6;

export interface ExtractState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  message?: string;
}

export interface UseDocumentLoaderResult {
  state: LoadState;
  setState: React.Dispatch<React.SetStateAction<LoadState>>;
  isOpeningFile: boolean;
  loadedFileName: string;
  loadedFileHash: string;
  taskDocumentId: string;
  loadedPdfData: ArrayBuffer | null;
  aiDetectionSupport: AiDetectionSupport;
  extractState: ExtractState;
  extractedTables: ExtractedTable[];
  extractDocument: StructuredDataDocument | null;
  extractParsedTables: any[] | undefined;
  extractAssetMap: Record<string, string> | null;
  cachedFiles: CachedFileSummary[];
  openFile: (file: File) => Promise<void>;
  triggerExtract: () => Promise<void>;
  handleFileChange: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleOpenCachedFile: (fileHash: string) => Promise<void>;
  handleDeleteCachedFile: (fileHash: string) => Promise<void>;
  refreshCachedFiles: () => Promise<void>;
}

export interface UseDocumentLoaderOptions {
  onDocumentLoad?: (document: PDFDocument) => void;
  autoExtract?: boolean;
}

export function useDocumentLoader(options: UseDocumentLoaderOptions = {}): UseDocumentLoaderResult {
  const { onDocumentLoad, autoExtract = false } = options;

  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const [isOpeningFile, setIsOpeningFile] = useState(false);
  const [loadedFileName, setLoadedFileName] = useState<string>('');
  const [loadedFileHash, setLoadedFileHash] = useState<string>('');
  const [taskDocumentId, setTaskDocumentId] = useState<string>('');
  const [loadedFile, setLoadedFile] = useState<File | null>(null);
  const [loadedPdfData, setLoadedPdfData] = useState<ArrayBuffer | null>(null);
  const [aiDetectionSupport, setAiDetectionSupport] = useState<AiDetectionSupport>({ supported: true });
  const [extractState, setExtractState] = useState<ExtractState>({ status: 'idle' });
  const [extractedTables, setExtractedTables] = useState<ExtractedTable[]>([]);
  const [extractDocument, setExtractDocument] = useState<StructuredDataDocument | null>(null);
  const [extractParsedTables, setExtractParsedTables] = useState<any[] | undefined>(undefined);
  const [extractAssetMap, setExtractAssetMap] = useState<Record<string, string> | null>(null);
  const [cachedFiles, setCachedFiles] = useState<CachedFileSummary[]>([]);

  const refreshCachedFiles = useCallback(async () => {
    try {
      const files = await listCachedFiles();
      setCachedFiles(files);
    } catch (error) {
      console.warn('Unable to load cached files', error);
    }
  }, []);

  useEffect(() => {
    void refreshCachedFiles();
  }, [refreshCachedFiles]);

  const resetExtractResults = useCallback(() => {
    setExtractState({ status: 'idle' });
    setExtractedTables([]);
    setExtractDocument(null);
    setExtractParsedTables(undefined);
    setExtractAssetMap(null);
    setTaskDocumentId('');
  }, []);

  const handleExtractResponse = useCallback((response: {
    document: any;
    parsedTables?: Array<{ name?: string; rows: any[] }>;
    assetMap?: Record<string, string> | null;
  }) => {
    setExtractDocument(response.document);
    setExtractParsedTables(response.parsedTables);
    setExtractAssetMap(response.assetMap ?? null);
    const tables: ExtractedTable[] = [];
    const parsedTables = response.parsedTables ?? [];
    const parsedTableMap = new Map<string, typeof parsedTables[number]>();
    const normalizeTableName = (name: string) => name.toLowerCase().replace(/^\.?\//, '');
    for (const parsed of parsedTables) {
      if (!parsed?.name) {
        continue;
      }
      parsedTableMap.set(normalizeTableName(parsed.name), parsed);
    }

    const tablePattern = /^\/\/Document\/Table(?:\[\d+\])?$/;
    const seenTables = new Set<string>();

    (response.document.elements ?? []).forEach((element: any) => {
      const path = element.Path ?? '';
      if (typeof path !== 'string' || !tablePattern.test(path)) {
        return;
      }
      const boundsTuple = element.attributes?.BBox ?? element.Bounds;
      const normalizedBounds = normalizeExtractTableBounds(boundsTuple);
      if (!normalizedBounds) {
        return;
      }
      const pageNumberZeroBased = typeof element.Page === 'number' ? element.Page : 0;
      const pageNumber = pageNumberZeroBased + 1;
      const tableFilePath = Array.isArray(element.filePaths)
        ? element.filePaths.find(
            (filePath: string) => typeof filePath === 'string' && filePath.toLowerCase().endsWith('.xlsx')
          )
        : undefined;
      const parsedForTable = tableFilePath ? parsedTableMap.get(normalizeTableName(tableFilePath)) : undefined;
      if (tableFilePath && parsedTableMap.has(normalizeTableName(tableFilePath))) {
        parsedTableMap.delete(normalizeTableName(tableFilePath));
      }

      const id = `${path}-${pageNumber}`;
      if (seenTables.has(id)) {
        return;
      }
      seenTables.add(id);
      const baseTable: ExtractedTable = {
        id,
        page: pageNumber,
        bounds: normalizedBounds,
        cells: []
      };

      if (parsedForTable && Array.isArray(parsedForTable.rows)) {
        const normalizedRows = normalizeParsedTableRows(parsedForTable.rows);
        const cells: ExtractedTable['cells'] = [];
        const headers = normalizedRows[0] ?? [];
        for (let rowIndex = 0; rowIndex < normalizedRows.length; rowIndex += 1) {
          const row = normalizedRows[rowIndex] ?? [];
          for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
            cells.push({
              row: rowIndex + 1,
              col: colIndex + 1,
              text: row[colIndex] ?? '',
              kind: rowIndex === 0 ? 'th' : 'td'
            });
          }
        }
        tables.push({ ...baseTable, cells, headers });
      } else {
        tables.push(baseTable);
      }
    });

    setExtractedTables(tables);
    console.debug('Extracted tables from structuredData', {
      count: tables.length,
      matchedParsedTables: parsedTables.length - parsedTableMap.size,
      source: 'extract'
    });
    setExtractState({ status: 'ready' });
  }, []);

  const loadCachedExtractForFile = useCallback(
    async (fileHash: string): Promise<boolean> => {
      const cachedExtract = await loadCachedExtractPayload(fileHash);
      const isCacheVersionValid = cachedExtract?.schemaVersion === EXTRACT_CACHE_SCHEMA_VERSION;
      if (!cachedExtract?.document || !isCacheVersionValid) {
        return false;
      }

      console.debug('Loaded extract data from cache');
      handleExtractResponse({
        document: cachedExtract.document,
        parsedTables: cachedExtract.parsedTables,
        assetMap: cachedExtract.assetMap ?? null
      });
      return true;
    },
    [handleExtractResponse]
  );

  const persistTaskDocumentState = useCallback(
    (fileHash: string, input: {
      documentId: string;
      interactionCount?: number;
      detection: {
        status: 'idle' | 'pending' | 'ready' | 'error';
        provider?: string;
        model?: string;
      };
      extractSchemaVersion?: number;
    }) => {
      setTaskDocumentId(input.documentId);
      void saveCachedTaskDocument({
        fileHash,
        documentId: input.documentId,
        detectionStatus: input.detection.status,
        provider: input.detection.provider,
        model: input.detection.model,
        extractSchemaVersion: input.extractSchemaVersion,
        interactionCount: input.interactionCount,
        updatedAt: Date.now()
      });
    },
    []
  );

  const persistExtractResult = useCallback(
    async (
      file: File,
      fileHash: string,
      result: {
        model?: string;
        document?: unknown;
        parsedTables?: unknown;
        assetMap?: unknown;
      }
    ) => {
      handleExtractResponse({
        document: (result.document ?? null) as any,
        parsedTables: (result.parsedTables ?? undefined) as any,
        assetMap: (result.assetMap ?? null) as Record<string, string> | null
      });

      const extractPayload = {
        schemaVersion: EXTRACT_CACHE_SCHEMA_VERSION,
        provider: 'task-proxy',
        model: (result.model as string | undefined) ?? null,
        document: result.document as StructuredDataDocument,
        parsedTables: (result.parsedTables as any[]) ?? [],
        assetMap: (result.assetMap as Record<string, string> | null | undefined) ?? null
      };
      await saveCachedExtractPayload({
        fileHash,
        extract: extractPayload
      });
      await saveCachedExtract({
        file,
        fileHash,
        extract: extractPayload
      });
      await refreshCachedFiles();
    },
    [handleExtractResponse, refreshCachedFiles]
  );

  const runRemoteExtract = useCallback(
    async (file: File, fileHash: string, refresh = false) => {
      setExtractState({ status: 'loading' });
      try {
        const response = await uploadPdfAndStartDetection({
          file,
          fileHash,
          refresh
        });
        persistTaskDocumentState(fileHash, {
          documentId: response.document.id,
          interactionCount: response.document.interactionCount,
          detection: {
            status: response.detection.status,
            provider: response.detection.provider ?? response.document.detection.provider,
            model: response.detection.model ?? response.document.detection.model
          }
        });

        if (response.detection.status === 'error') {
          throw new Error(response.detection.error ?? 'AI extraction failed.');
        }

        const resolved = response.detection.status === 'ready' && response.detection.result
          ? response
          : await waitForTaskDocumentDetection(response.document.id);

        persistTaskDocumentState(fileHash, {
          documentId: resolved.document.id,
          interactionCount: resolved.document.interactionCount,
          detection: {
            status: resolved.detection.status,
            provider: resolved.detection.provider ?? resolved.document.detection.provider,
            model: resolved.detection.model ?? resolved.document.detection.model
          },
          extractSchemaVersion: EXTRACT_CACHE_SCHEMA_VERSION
        });

        if (resolved.detection.status !== 'ready' || !resolved.detection.result) {
          throw new Error(resolved.detection.error ?? 'AI extraction did not return structured data.');
        }

        await persistExtractResult(file, fileHash, resolved.detection.result);
        return resolved.detection.result;
      } catch (error) {
        setExtractedTables([]);
        setExtractState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unable to extract table metadata.'
        });
        return null;
      }
    },
    [persistExtractResult, persistTaskDocumentState]
  );

  const runExistingTaskExtract = useCallback(
    async (file: File, fileHash: string, documentId: string) => {
      setExtractState({ status: 'loading' });
      try {
        const resolved = await waitForTaskDocumentDetection(documentId);
        persistTaskDocumentState(fileHash, {
          documentId: resolved.document.id,
          interactionCount: resolved.document.interactionCount,
          detection: {
            status: resolved.detection.status,
            provider: resolved.detection.provider ?? resolved.document.detection.provider,
            model: resolved.detection.model ?? resolved.document.detection.model
          },
          extractSchemaVersion: EXTRACT_CACHE_SCHEMA_VERSION
        });

        if (resolved.detection.status !== 'ready' || !resolved.detection.result) {
          throw new Error(resolved.detection.error ?? 'AI extraction did not return structured data.');
        }

        await persistExtractResult(file, fileHash, resolved.detection.result);
        return resolved.detection.result;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to restore prior AI extraction.';
        if (message.includes('Unknown task document')) {
          await deleteCachedTaskDocument(fileHash);
          return runRemoteExtract(file, fileHash, false);
        }
        setExtractedTables([]);
        setExtractState({
          status: 'error',
          message
        });
        return null;
      }
    },
    [persistExtractResult, persistTaskDocumentState, runRemoteExtract]
  );

  const runExtract = useCallback(
    async (file: File, fileHashOverride?: string, refresh = true) => {
      if (!aiDetectionSupport.supported) {
        setExtractState({ status: 'idle' });
        return;
      }

      try {
        const fileHash = fileHashOverride ?? await computeFileHash(file);
        setLoadedFileHash(fileHash);
        const result = await runRemoteExtract(file, fileHash, refresh);
        if (!result) {
          return;
        }
      } catch (error) {
        setExtractedTables([]);
        setExtractState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unable to extract table metadata.'
        });
      }
    },
    [aiDetectionSupport.supported, runRemoteExtract]
  );

  const openFile = useCallback(
    async (file: File) => {
      if (!SUPPORTED_TYPES.includes(file.type)) {
        setState({ status: 'error', message: 'Please choose a PDF file.' });
        return;
      }

      setIsOpeningFile(true);
      try {
        const bytes = await file.arrayBuffer();
        setLoadedFile(file);
        setLoadedFileName(file.name);
        setLoadedPdfData(bytes);
        resetExtractResults();
        setLoadedFileHash('');

        let didRevealPreview = false;
        const fileHashPromise = computeBufferHash(bytes);
        const document = await parsePdfDocument(bytes, {
          onBatch: (partialDocument) => {
            setState({ status: 'ready', document: partialDocument });
            setAiDetectionSupport(analyzeAiDetectionSupport(partialDocument));
            if (didRevealPreview || partialDocument.pages.length === 0) {
              return;
            }
            didRevealPreview = true;
            setIsOpeningFile(false);
            onDocumentLoad?.(partialDocument);
          }
        });

        const nextAiDetectionSupport = analyzeAiDetectionSupport(document);
        setState({ status: 'ready', document });
        setAiDetectionSupport(nextAiDetectionSupport);

        if (!didRevealPreview) {
          setIsOpeningFile(false);
          onDocumentLoad?.(document);
        }

        const fileHash = await fileHashPromise;
        setLoadedFileHash(fileHash);

        if (nextAiDetectionSupport.supported) {
          const cachedTaskDocument = await loadCachedTaskDocument(fileHash);
          if (cachedTaskDocument?.documentId) {
            setTaskDocumentId(cachedTaskDocument.documentId);
          }
          const loadedFromCache = await loadCachedExtractForFile(fileHash);
          if (loadedFromCache) {
            return;
          }

          if (!loadedFromCache) {
            setExtractState({ status: 'loading' });
          }

          if (
            cachedTaskDocument?.documentId &&
            cachedTaskDocument.extractSchemaVersion === EXTRACT_CACHE_SCHEMA_VERSION
          ) {
            void runExistingTaskExtract(file, fileHash, cachedTaskDocument.documentId);
            return;
          }

          if (autoExtract || !loadedFromCache) {
            void runExtract(file, fileHash, true);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to parse PDF.';
        setAiDetectionSupport({ supported: true });
        setState({ status: 'error', message });
      } finally {
        setIsOpeningFile(false);
      }
    },
    [autoExtract, loadCachedExtractForFile, onDocumentLoad, resetExtractResults, runExistingTaskExtract, runExtract]
  );

  const triggerExtract = useCallback(async () => {
    if (!loadedFile) {
      setExtractState({ status: 'error', message: 'No document loaded.' });
      return;
    }
    await runExtract(loadedFile, loadedFileHash || undefined, true);
  }, [loadedFile, loadedFileHash, runExtract]);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      void openFile(file);
    },
    [openFile]
  );

  const handleOpenCachedFile = useCallback(
    async (fileHash: string) => {
      const cached = await loadCachedFile(fileHash);
      if (!cached) {
        setState({ status: 'error', message: 'Cached file could not be loaded.' });
        return;
      }
      setLoadedFileName(cached.file.name);
      void openFile(cached.file);
    },
    [openFile]
  );

  const handleDeleteCachedFile = useCallback(
    async (fileHash: string) => {
      await deleteCachedFile(fileHash);
      await deleteCachedTaskDocument(fileHash);
      await refreshCachedFiles();
    },
    [refreshCachedFiles]
  );

  return {
    state,
    setState,
    isOpeningFile,
    loadedFileName,
    loadedFileHash,
    taskDocumentId,
    loadedPdfData,
    aiDetectionSupport,
    extractState,
    extractedTables,
    extractDocument,
    extractParsedTables,
    extractAssetMap,
    cachedFiles,
    openFile,
    triggerExtract,
    handleFileChange,
    handleOpenCachedFile,
    handleDeleteCachedFile,
    refreshCachedFiles
  };
}

async function parsePdfDocument(
  bytes: ArrayBuffer,
  options: {
    onBatch?: (document: PDFDocument) => void;
  } = {}
): Promise<PDFDocument> {
  if (typeof Worker === 'undefined') {
    return PDFDocument.from(bytes);
  }

  return parsePdfDocumentInWorker(bytes, options.onBatch);
}

async function parsePdfDocumentInWorker(
  pdfData: ArrayBuffer,
  onBatch?: (document: PDFDocument) => void
): Promise<PDFDocument> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/pdfParseWorker.ts', import.meta.url), {
      type: 'module'
    });
    const parsedPages: PDFPage[] = [];
    const parsedFontResources: Record<string, PDFEmbeddedFontResource> = {};

    const buildDocument = (): PDFDocument =>
      new PDFDocument({
        pages: parsedPages.slice(),
        fontResources:
          Object.keys(parsedFontResources).length > 0
            ? { ...parsedFontResources }
            : undefined
      } satisfies PDFLayout);

    worker.onmessage = (event: MessageEvent<PdfParseWorkerResponse>) => {
      const message = event.data;

      if (message.type === 'parsed-page-batch') {
        parsedPages.push(...message.pages.map((page) => deserializePdfPage(page)));
        if (message.fontResources) {
          Object.assign(parsedFontResources, message.fontResources);
        }

        const document = buildDocument();
        onBatch?.(document);

        if (message.complete) {
          worker.terminate();
          resolve(document);
        }
        return;
      }

      worker.terminate();
      reject(new Error(message.message));
    };

    worker.onerror = () => {
      worker.terminate();
      reject(new Error('Unable to parse PDF.'));
    };

    worker.postMessage({
      type: 'parse-document',
      pdfData
    });
  });
}

function normalizeExtractTableBounds(value: unknown): TableBounds | null {
  if (!Array.isArray(value) || value.length !== 4) {
    return null;
  }

  const raw = value.map((item) => (typeof item === 'number' ? item : Number(item)));
  if (raw.some((item) => !Number.isFinite(item))) {
    return null;
  }

  let [a, b, c, d] = raw as [number, number, number, number];

  // Some extractions occasionally return [x, y, width, height] instead of [minX, minY, maxX, maxY].
  if (c > 0 && d > 0 && (c <= a || d <= b)) {
    c = a + c;
    d = b + d;
  }

  const minX = Math.min(a, c);
  const maxX = Math.max(a, c);
  const minY = Math.min(b, d);
  const maxY = Math.max(b, d);

  if (maxX - minX <= 1 || maxY - minY <= 1) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}
