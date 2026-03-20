import type {
  PDFDocument,
  HtmlDocumentLayout,
  HtmlHeadingBlock,
  HtmlParagraphBlock,
  HtmlTableBlock,
  BlockRelevanceAnnotation,
  RelevanceServiceConfig,
  OpenAiCompatibleProvider
} from 'pdf-layout-parser';
import type { StructuredDataDocument, TableModel } from '@viewer/htmlStructuredDataRenderer';

export type TableBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type ExtractedTable = {
  id: string;
  page: number;
  bounds: TableBounds;
  cells?: Array<{ row: number; col: number; text: string; kind: 'td' | 'th' }>;
  headers?: string[];
};

export type LoadState =
  | { status: 'idle' }
  | { status: 'ready'; document: PDFDocument }
  | { status: 'error'; message: string };

export type ViewMode =
  | 'canvas'
  | 'layout-json'
  | 'html-json'
  | 'html-render'
  | 'focus-render'
  | 'focus-pdf'
  | 'focus-debug'
  | 'structured-data'
  | 'structured-extract'
  | 'gemini'
  | 'lmstudio'
  | 'ai-studio';

export type FocusViewMode = Extract<ViewMode, 'focus-render' | 'focus-pdf'>;

export type FocusProvider = 'mock' | OpenAiCompatibleProvider;

export type FocusRecording = {
  id: string;
  provider: FocusProvider;
  query: string;
  createdAt: string;
  prompt?: string;
  requestPayload?: Record<string, unknown>;
  responsePayload?: unknown;
  responseModel?: string;
  responseCreatedAt?: string;
  querySummary?: string;
  annotations: BlockRelevanceAnnotation[];
  document: HtmlDocumentLayout;
};

export type FocusRenderState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'ready'; query: string; layout: any }
  | { status: 'empty'; query: string }
  | { status: 'error'; message: string };

export type RecordingParams = {
  provider: FocusProvider;
  query: string;
  response: any;
  layout: HtmlDocumentLayout;
  exchange: any;
};

export type WordBoundary = { start: number; end: number };

export type CanvasHighlightSelection =
  | {
      kind: 'text';
      pageNumber: number;
      blockIndex: number;
      block: HtmlParagraphBlock | HtmlHeadingBlock;
      selectionScope: 'block' | 'topic' | 'section';
      logicalUnitId?: string;
      sectionUnitId?: string;
    }
  | {
      kind: 'table';
      pageNumber: number;
      block: HtmlTableBlock;
      source: 'layout-bounds' | 'cell-bounds' | 'ai';
    };

export const SUPPORTED_TYPES = ['application/pdf'];
export const RECORDING_STORAGE_KEY = 'focus-recordings-v1';

export type StructuredDataState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; document: StructuredDataDocument }
  | { status: 'error'; message: string };

export type StructuredSelection =
  | {
      kind: 'text';
      page: number;
      path?: string;
      text?: string;
      rect: { left: number; top: number; width: number; height: number };
      elementId?: number | null;
      chapterBlocks?: Array<{ type: 'heading' | 'text'; text: string }>;
    }
  | {
      kind: 'table';
      page: number;
      path?: string;
      rect: { left: number; top: number; width: number; height: number };
      tableId?: string | null;
      table?: TableModel | null;
      elementId?: number | null;
    };

export type CanvasPageRenderState = 'preparing' | 'queued' | 'rendering' | 'ready';

export type BackgroundRenderProgress = {
  active: boolean;
  isPreparing: boolean;
  pendingPageCount: number;
  renderingPageCount: number;
  totalBackgroundPages: number;
};
