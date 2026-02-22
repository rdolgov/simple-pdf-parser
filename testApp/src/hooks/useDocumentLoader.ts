import { useState, useCallback, useEffect } from 'react';
import {
  PDFDocument,
  StructuredExtractAPI,
  type StructuredDataDocument
} from 'pdf-layout-parser';
import type { LoadState, ExtractedTable, TableBounds } from '../types';
import { SUPPORTED_TYPES } from '../types';
import {
  computeFileHash,
  loadCachedExtractPayload,
  saveCachedExtractPayload,
  saveCachedExtract,
  listCachedFiles,
  loadCachedFile,
  deleteCachedFile,
  type CachedFileSummary
} from '../utils/fileCache';
import {
  getStructuredExtractApiKey,
  getStructuredExtractModel,
  getStructuredExtractProvider,
  setStructuredExtractApiKey
} from '../utils/structuredExtractSettings';

const EXTRACT_CACHE_SCHEMA_VERSION = 3;

export interface ExtractState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  message?: string;
}

export interface UseDocumentLoaderResult {
  state: LoadState;
  setState: React.Dispatch<React.SetStateAction<LoadState>>;
  loadedFileName: string;
  loadedFileHash: string;
  loadedPdfData: ArrayBuffer | null;
  extractState: ExtractState;
  extractedTables: ExtractedTable[];
  extractDocument: StructuredDataDocument | null;
  extractParsedTables: any[] | undefined;
  extractAssetMap: Record<string, string> | null;
  cachedFiles: CachedFileSummary[];
  openFile: (file: File) => Promise<void>;
  handleFileChange: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleOpenCachedFile: (fileHash: string) => Promise<void>;
  handleDeleteCachedFile: (fileHash: string) => Promise<void>;
  refreshCachedFiles: () => Promise<void>;
}

export interface UseDocumentLoaderOptions {
  onDocumentLoad?: (document: PDFDocument) => void;
}

export function useDocumentLoader(options: UseDocumentLoaderOptions = {}): UseDocumentLoaderResult {
  const { onDocumentLoad } = options;

  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const [loadedFileName, setLoadedFileName] = useState<string>('');
  const [loadedFileHash, setLoadedFileHash] = useState<string>('');
  const [loadedPdfData, setLoadedPdfData] = useState<ArrayBuffer | null>(null);
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

  const runExtract = useCallback(
    async (file: File) => {
      setExtractState({ status: 'loading' });
      setExtractedTables([]);
      try {
        const fileHash = await computeFileHash(file);
        setLoadedFileHash(fileHash);
        const handleExtractResponse = (response: {
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

          (response.document.elements ?? []).forEach((element: any, index: number) => {
            const path = element.Path ?? '';
            if (typeof path !== 'string' || !tablePattern.test(path)) {
              return;
            }
            const boundsTuple = element.attributes?.BBox ?? element.Bounds;
            if (!Array.isArray(boundsTuple) || boundsTuple.length !== 4) {
              return;
            }
            const pageNumberZeroBased = typeof element.Page === 'number' ? element.Page : 0;
            const pageNumber = pageNumberZeroBased + 1; // PDF pages are 1-based in renderer
            const [minX, minY, maxX, maxY] = boundsTuple;
            const tableFilePath = Array.isArray(element.filePaths)
              ? element.filePaths.find(
                  (filePath: string) => typeof filePath === 'string' && filePath.toLowerCase().endsWith('.xlsx')
                )
              : undefined;
            const parsedForTable = tableFilePath ? parsedTableMap.get(normalizeTableName(tableFilePath)) : undefined;
            if (tableFilePath && parsedTableMap.has(normalizeTableName(tableFilePath))) {
              parsedTableMap.delete(normalizeTableName(tableFilePath));
            }

            const normalizedBounds: TableBounds = {
              minX,
              minY,
              maxX,
              maxY
            };
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
              const cells: ExtractedTable['cells'] = [];
              const headers = parsedForTable.rows[0]?.map((value: any) => String(value ?? '')) ?? [];
              for (let rowIndex = 0; rowIndex < parsedForTable.rows.length; rowIndex += 1) {
                const row = parsedForTable.rows[rowIndex];
                for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
                  cells.push({
                    row: rowIndex + 1,
                    col: colIndex + 1,
                    text: String(row[colIndex] ?? ''),
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
        };

        const provider = getStructuredExtractProvider();
        const model = getStructuredExtractModel(provider);

        const cachedExtract = await loadCachedExtractPayload(fileHash);
        const isCacheVersionValid = cachedExtract?.schemaVersion === EXTRACT_CACHE_SCHEMA_VERSION;
        const isCacheProviderMatch = (cachedExtract?.provider ?? 'gemini') === provider;
        const isCacheModelMatch = (cachedExtract?.model ?? null) === (model ?? null);
        if (cachedExtract?.document && isCacheVersionValid && isCacheProviderMatch && isCacheModelMatch) {
          console.debug('Loaded extract data from cache');
          handleExtractResponse({
            document: cachedExtract.document,
            parsedTables: cachedExtract.parsedTables,
            assetMap: cachedExtract.assetMap ?? null
          });
          return;
        }

        const apiKey = resolveApiKeyForExtract(provider);
        if (!apiKey) {
          throw new Error(
            `${provider === 'openai' ? 'OpenAI' : 'Gemini'} API key is required to extract structured table and image metadata.`
          );
        }

        const client = new StructuredExtractAPI({ provider, apiKey, model: model ?? undefined });
        const response = await client.extractStructuredData(file, { fileName: file.name });
        handleExtractResponse({ document: response.document, parsedTables: response.parsedTables, assetMap: response.assetMap });
        const extractPayload = {
          schemaVersion: EXTRACT_CACHE_SCHEMA_VERSION,
          provider,
          model: model ?? null,
          document: response.document,
          parsedTables: response.parsedTables ?? [],
          assetMap: response.assetMap ?? null
        };
        void saveCachedExtractPayload({
          fileHash,
          extract: extractPayload
        });
        void saveCachedExtract({
          file,
          fileHash,
          extract: extractPayload
        });
        void refreshCachedFiles();
      } catch (error) {
        setExtractedTables([]);
        setExtractState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unable to extract table metadata.'
        });
      }
    },
    [refreshCachedFiles]
  );

  const openFile = useCallback(
    async (file: File) => {
      if (!SUPPORTED_TYPES.includes(file.type)) {
        setState({ status: 'error', message: 'Please choose a PDF file.' });
        return;
      }

      try {
        const bytes = await file.arrayBuffer();
        const document = PDFDocument.from(bytes);
        setState({ status: 'ready', document });
        setLoadedFileName(file.name);
        setLoadedPdfData(bytes);
        onDocumentLoad?.(document);
        runExtract(file);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to parse PDF.';
        setState({ status: 'error', message });
      }
    },
    [onDocumentLoad, runExtract]
  );

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
      await refreshCachedFiles();
    },
    [refreshCachedFiles]
  );

  return {
    state,
    setState,
    loadedFileName,
    loadedFileHash,
    loadedPdfData,
    extractState,
    extractedTables,
    extractDocument,
    extractParsedTables,
    extractAssetMap,
    cachedFiles,
    openFile,
    handleFileChange,
    handleOpenCachedFile,
    handleDeleteCachedFile,
    refreshCachedFiles
  };
}

function resolveApiKeyForExtract(provider: 'gemini' | 'openai'): string | null {
  const existing = getStructuredExtractApiKey(provider);
  if (existing) {
    return existing;
  }
  const providerName = provider === 'openai' ? 'OpenAI' : 'Gemini';
  const prompted = window.prompt(`Enter your ${providerName} API key to extract tables and images from this PDF:`);
  const normalized = prompted?.trim();
  if (!normalized) {
    return null;
  }
  setStructuredExtractApiKey(provider, normalized);
  return normalized;
}
