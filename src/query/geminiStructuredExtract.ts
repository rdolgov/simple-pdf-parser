import { PDFDocument } from '../pdfDocument.js';
import { GeminiAPI, type GeminiApiConfig, type GeminiContentParts } from './geminiApi.js';
import { resolveGeminiBinaryInputModel } from './geminiModelSelection.js';
import {
  detectStructuredExtractPageYBand,
  normalizeStructuredExtractRatioBounds,
  readStructuredExtractRawBounds,
  toPdfBoundsFromNormalizedRatioBounds
} from './structuredExtractBounds.js';
import { normalizeParsedTableRows } from './tableCellText.js';

export type StructuredExtractFileInput = Blob | File | ArrayBuffer | Uint8Array;

export type StructuredBoundsTuple = [number, number, number, number];

export interface StructuredDataElement {
  Bounds?: StructuredBoundsTuple;
  attributes?: {
    BBox?: StructuredBoundsTuple;
    TextAlign?: string;
    LineHeight?: number;
    [key: string]: unknown;
  };
  Text?: string;
  SemanticType?: string;
  StructuredContent?: string | Record<string, unknown>;
  Description?: string;
  TextSize?: number;
  Font?: {
    family_name?: string;
    alt_family_name?: string;
    weight?: number;
    italic?: boolean;
  };
  Page?: number;
  Path?: string;
  filePaths?: string[];
  elementId?: number;
  [key: string]: unknown;
}

export interface StructuredDataPage {
  page_number?: number;
  width?: number;
  height?: number;
  rotation?: number;
  boxes?: {
    MediaBox?: StructuredBoundsTuple;
    CropBox?: StructuredBoundsTuple;
  };
  [key: string]: unknown;
}

export interface StructuredDataDocument {
  version?: Record<string, unknown>;
  extended_metadata?: Record<string, unknown>;
  elements: StructuredDataElement[];
  pages: StructuredDataPage[];
  [key: string]: unknown;
}

export interface ParsedTable {
  name: string;
  rows: string[][];
}

export interface GeminiStructuredExtractOptions {
  fileName?: string;
}

export interface GeminiStructuredExtractConfig {
  apiKey: string;
  model?: string;
  endpoint?: string;
  apiVersion?: string;
  generationConfig?: GeminiApiConfig['generationConfig'];
  safetySettings?: GeminiApiConfig['safetySettings'];
  prompt?: string;
}

export interface StructuredExtractGenerateRequest {
  model?: string;
  contents: GeminiContentParts;
  generationConfig?: Record<string, unknown>;
  safetySettings?: Array<Record<string, unknown>>;
}

export interface StructuredExtractGenerateResult {
  text: string;
  model: string;
}

export interface StructuredExtractClient {
  generateContent(request: StructuredExtractGenerateRequest): Promise<StructuredExtractGenerateResult>;
}

export interface GeminiStructuredExtractDependencies {
  client?: StructuredExtractClient;
  providerName?: string;
}

export interface GeminiStructuredExtractResult {
  document: StructuredDataDocument;
  parsedTables: ParsedTable[];
  assetMap: Record<string, string>;
  model: string;
  prompt: string;
  rawText: string;
}

type LlmResponse = {
  pages?: Array<{
    page_number?: unknown;
    elements?: LlmElement[];
  }>;
  elements?: LlmElement[];
};

type LlmElement = {
  type?: unknown;
  path?: unknown;
  page_number?: unknown;
  page?: unknown;
  text?: unknown;
  content?: unknown;
  description?: unknown;
  bbox?: unknown;
  bounding_box?: unknown;
  table_rows?: unknown;
  rows?: unknown;
};

type PageInfo = {
  pageIndex: number;
  width: number;
  height: number;
};

type PageNumberMode = 'zero-based' | 'one-based';

type ImageAsset = {
  path: string;
  pageIndex: number;
  bounds: StructuredBoundsTuple;
};

const DEFAULT_PROMPT = [
  'Extract this PDF into structured JSON.',
  'Return only JSON with this exact schema:',
  '{',
  '  "pages": [',
  '    {',
  '      "page_number": 1,',
  '      "elements": [',
  '        {',
  '          "type": "title|authors|heading|paragraph|reference|image|table|formula|caption|list|footnote|other",',
  '          "text": "string",',
  '          "bbox": [x, y, width, height],',
  '          "table_rows": [["cell"]]',
  '        }',
  '      ]',
  '    }',
  '  ]',
  '}',
  'Rules:',
  '- page_number is 1-based.',
  '- bbox uses ratios (0..1) relative to page, with top-left origin.',
  '- Include all readable text blocks.',
  '- Include every table with table_rows when possible.',
  '- Include every figure/image/diagram as type=image.',
  '- Mark displayed equations and inline mathematical expressions that should be interactive as type=formula.',
  '- Mark bibliography entries and citation-style references as type=reference.',
  '- Mark author lines as type=authors when identifiable.',
  '- For non-table elements, omit table_rows.',
  '- Do not wrap JSON in markdown fences.'
].join('\n');

export class GeminiStructuredExtract {
  private readonly client: StructuredExtractClient;
  private readonly model: string;
  private readonly prompt: string;
  private readonly generationConfig?: GeminiApiConfig['generationConfig'];
  private readonly safetySettings?: GeminiApiConfig['safetySettings'];
  private readonly providerName: string;

  constructor(config: GeminiStructuredExtractConfig, dependencies: GeminiStructuredExtractDependencies = {}) {
    if (!config.apiKey) {
      throw new Error('GeminiStructuredExtract requires an apiKey');
    }
    this.client =
      dependencies.client ??
      new GeminiAPI({
        apiKey: config.apiKey,
        model: resolveGeminiBinaryInputModel(config.model),
        endpoint: config.endpoint,
        apiVersion: config.apiVersion,
        generationConfig: config.generationConfig,
        safetySettings: config.safetySettings
      });
    this.model = resolveGeminiBinaryInputModel(config.model);
    this.prompt = config.prompt ?? DEFAULT_PROMPT;
    this.generationConfig = config.generationConfig;
    this.safetySettings = config.safetySettings;
    this.providerName = dependencies.providerName ?? 'gemini';
  }

  async extract(
    file: StructuredExtractFileInput,
    options: GeminiStructuredExtractOptions = {}
  ): Promise<GeminiStructuredExtractResult> {
    const { buffer, fileName } = await toArrayBuffer(file, options.fileName);
    const pdf = PDFDocument.from(buffer);
    const pages = buildPages(pdf);
    const { assetMap, assets } = buildImageAssets(pdf);

    const contents: GeminiContentParts = {
      parts: [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: arrayBufferToBase64(buffer)
          }
        },
        {
          text: this.prompt
        }
      ]
    };

    const result = await this.client.generateContent({
      model: this.model,
      generationConfig: this.generationConfig,
      safetySettings: this.safetySettings,
      contents
    });

    const parsed = parseLlmResponse(result.text);
    const elements = normalizeElements(parsed, pages);
    const parsedTables = attachTableData(elements);
    attachFigureAssets(elements, assets);
    ensureFigureElements(elements, assets);

    const document: StructuredDataDocument = {
      version: {
        provider: this.providerName,
        model: result.model,
        file_name: fileName ?? null
      },
      pages,
      elements: elements.map((element, index) => ({
        ...element,
        elementId: typeof element.elementId === 'number' ? element.elementId : index
      }))
    };

    return {
      document,
      parsedTables,
      assetMap,
      model: result.model,
      prompt: this.prompt,
      rawText: result.text
    };
  }
}

function buildPages(pdf: PDFDocument): StructuredDataPage[] {
  return pdf.pages.map((page) => ({
    page_number: page.number - 1,
    width: page.size.width,
    height: page.size.height,
    rotation: 0,
    boxes: {
      MediaBox: [0, 0, page.size.width, page.size.height],
      CropBox: [0, 0, page.size.width, page.size.height]
    }
  }));
}

function buildImageAssets(pdf: PDFDocument): { assetMap: Record<string, string>; assets: ImageAsset[] } {
  const assetMap: Record<string, string> = {};
  const assets: ImageAsset[] = [];

  for (const page of pdf.pages) {
    const pageIndex = page.number - 1;
    let imageIndex = 0;
    for (const image of page.imageItems) {
      if (!image.dataUri) {
        continue;
      }
      imageIndex += 1;
      const path = `figures/page-${page.number}-image-${imageIndex}.png`.toLowerCase();
      assetMap[path] = image.dataUri;
      assets.push({
        path,
        pageIndex,
        bounds: [image.bounds.minX, image.bounds.minY, image.bounds.maxX, image.bounds.maxY]
      });
    }
  }

  return { assetMap, assets };
}

function parseLlmResponse(text: string): LlmResponse {
  const trimmed = text.trim();
  const withoutFences = stripCodeFences(trimmed);
  const jsonCandidate = extractJsonObject(withoutFences);
  const parsed = JSON.parse(jsonCandidate) as LlmResponse;
  if (!parsed || (typeof parsed !== 'object')) {
    throw new Error('Gemini structured extraction returned invalid JSON');
  }
  return parsed;
}

function stripCodeFences(value: string): string {
  let result = value;
  if (result.startsWith('```json')) {
    result = result.slice(7);
  } else if (result.startsWith('```')) {
    result = result.slice(3);
  }
  if (result.endsWith('```')) {
    result = result.slice(0, -3);
  }
  return result.trim();
}

function extractJsonObject(value: string): string {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Gemini structured extraction did not return a JSON object');
  }
  return value.slice(start, end + 1);
}

function normalizeElements(parsed: LlmResponse, pages: StructuredDataPage[]): StructuredDataElement[] {
  const pageInfo = buildPageInfo(pages);
  const pageNumberMode = detectPageNumberMode(parsed, pages.length);
  const pageYBands = detectPageYBands(parsed, pages.length, pageNumberMode);
  const counters = new Map<string, number>();
  const elements: StructuredDataElement[] = [];

  const pageEntries = parsed.pages ?? [];
  for (const page of pageEntries) {
    const pageIndex = normalizePageIndex(page.page_number, pages.length, pageNumberMode);
    for (const rawElement of page.elements ?? []) {
      const element = toStructuredElement(rawElement, pageIndex, pageInfo, counters, pageYBands.get(pageIndex) ?? 0);
      if (element) {
        elements.push(element);
      }
    }
  }

  for (const rawElement of parsed.elements ?? []) {
    const pageIndex = normalizePageIndex(rawElement.page ?? rawElement.page_number, pages.length, pageNumberMode);
    const element = toStructuredElement(rawElement, pageIndex, pageInfo, counters, pageYBands.get(pageIndex) ?? 0);
    if (element) {
      elements.push(element);
    }
  }

  return elements;
}

function buildPageInfo(pages: StructuredDataPage[]): PageInfo[] {
  return pages.map((page, index) => ({
    pageIndex: page.page_number ?? index,
    width: page.width ?? 612,
    height: page.height ?? 792
  }));
}

function detectPageYBands(parsed: LlmResponse, pageCount: number, mode: PageNumberMode): Map<number, number> {
  const grouped = new Map<number, LlmElement[]>();

  const append = (pageIndex: number, element: LlmElement) => {
    if (!grouped.has(pageIndex)) {
      grouped.set(pageIndex, []);
    }
    grouped.get(pageIndex)!.push(element);
  };

  for (const page of parsed.pages ?? []) {
    const pageIndex = normalizePageIndex(page.page_number, pageCount, mode);
    for (const element of page.elements ?? []) {
      append(pageIndex, element);
    }
  }

  for (const element of parsed.elements ?? []) {
    const pageIndex = normalizePageIndex(element.page ?? element.page_number, pageCount, mode);
    append(pageIndex, element);
  }

  const bands = new Map<number, number>();
  for (const [pageIndex, elements] of grouped.entries()) {
    bands.set(pageIndex, detectStructuredExtractPageYBand(elements));
  }
  return bands;
}

function detectPageNumberMode(parsed: LlmResponse, pageCount: number): PageNumberMode {
  if (pageCount <= 0) {
    return 'zero-based';
  }

  const values: number[] = [];
  for (const page of parsed.pages ?? []) {
    const value = toFiniteNumber(page.page_number);
    if (value !== null) {
      values.push(Math.round(value));
    }
  }
  for (const element of parsed.elements ?? []) {
    const value = toFiniteNumber(element.page ?? element.page_number);
    if (value !== null) {
      values.push(Math.round(value));
    }
  }

  if (values.length === 0) {
    return 'zero-based';
  }

  const hasZero = values.some((value) => value === 0);
  const hasPageCount = values.some((value) => value === pageCount);
  if (hasZero && !hasPageCount) {
    return 'zero-based';
  }
  if (!hasZero && hasPageCount) {
    return 'one-based';
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min >= 1 && max <= pageCount) {
    return 'one-based';
  }
  if (min >= 0 && max <= pageCount - 1) {
    return 'zero-based';
  }
  return hasZero ? 'zero-based' : 'one-based';
}

function normalizePageIndex(value: unknown, pageCount: number, mode: PageNumberMode): number {
  if (pageCount <= 0) {
    return 0;
  }
  const numberValue = toFiniteNumber(value);
  if (numberValue === null) {
    return 0;
  }
  const rounded = Math.round(numberValue);
  if (mode === 'one-based') {
    if (rounded >= 1 && rounded <= pageCount) {
      return rounded - 1;
    }
    if (rounded >= 0 && rounded < pageCount) {
      return rounded;
    }
    return Math.max(0, Math.min(pageCount - 1, rounded - 1));
  }

  if (rounded >= 0 && rounded < pageCount) {
    return rounded;
  }
  if (rounded >= 1 && rounded <= pageCount) {
    return rounded - 1;
  }
  return Math.max(0, Math.min(pageCount - 1, rounded));
}

function toStructuredElement(
  raw: LlmElement,
  pageIndex: number,
  pages: PageInfo[],
  counters: Map<string, number>,
  pageYBand: number
): StructuredDataElement | null {
  const page = pages[pageIndex] ?? pages[0];
  if (!page) {
    return null;
  }

  const rawBounds = readStructuredExtractRawBounds(raw.bbox ?? raw.bounding_box);
  if (!rawBounds) {
    return null;
  }

  const box = normalizeStructuredExtractRatioBounds(rawBounds, pageYBand);
  if (!box) {
    return null;
  }

  const bounds = toPdfBoundsFromNormalizedRatioBounds(box, page.width, page.height);
  const rows = readTableRows(raw);
  const type = rows.length > 0 ? 'table' : normalizeType(raw.type);
  const pathBase = readPathBase(raw.path, type);
  const path = nextPath(pathBase, counters);
  const text = readText(raw.text, raw.content);

  const element: StructuredDataElement = {
    Path: path,
    Page: page.pageIndex,
    Bounds: bounds,
    attributes: {
      BBox: bounds
    },
    SemanticType: type
  };

  if (text) {
    element.Text = text;
  }

  if (raw.content && typeof raw.content === 'object') {
    element.StructuredContent = raw.content as Record<string, unknown>;
  }

  const description = normalizeTextValue(raw.content === raw.description ? undefined : raw.description);
  if (description) {
    element.Description = description;
  }

  if (pathBase === '//Document/Table') {
    if (rows.length > 0) {
      const fileName = `tables/${pathToName(path)}.xlsx`.toLowerCase();
      element.filePaths = [fileName];
      (element as StructuredDataElement & { __rows?: string[][] }).__rows = rows;
    }
  }

  return element;
}

function normalizeType(value: unknown): string {
  if (typeof value !== 'string') {
    return 'paragraph';
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return 'paragraph';
  }
  if (normalized === 'table' || normalized.includes('tabular') || normalized.includes('spreadsheet')) {
    return 'table';
  }
  if (normalized.includes('figure') || normalized.includes('image') || normalized.includes('diagram')) {
    return 'figure';
  }
  if (normalized === 'header') {
    return 'heading';
  }
  if (normalized === 'subheading' || normalized === 'sub-header') {
    return 'h2';
  }
  return normalized;
}

function readPathBase(path: unknown, type: string): string {
  if (typeof path === 'string' && path.startsWith('//Document/')) {
    const withoutIndex = path.replace(/\[\d+\]/g, '');
    const segments = withoutIndex.split('/').filter(Boolean);
    return segments.length >= 2 ? `//${segments[0]}/${segments[1]}` : '//Document/P';
  }

  switch (type) {
    case 'title':
      return '//Document/Title';
    case 'h1':
    case 'heading':
      return '//Document/H1';
    case 'h2':
      return '//Document/H2';
    case 'h3':
      return '//Document/H3';
    case 'table':
      return '//Document/Table';
    case 'figure':
    case 'image':
      return '//Document/Figure';
    case 'formula':
      return '//Document/Formula';
    case 'reference':
      return '//Document/Reference';
    case 'caption':
      return '//Document/Caption';
    case 'footnote':
      return '//Document/Footnote';
    case 'authors':
      return '//Document/Authors';
    case 'list':
      return '//Document/L';
    default:
      return '//Document/P';
  }
}

function nextPath(pathBase: string, counters: Map<string, number>): string {
  const next = (counters.get(pathBase) ?? 0) + 1;
  counters.set(pathBase, next);
  return next === 1 ? pathBase : `${pathBase}[${next}]`;
}

function readText(text: unknown, content: unknown): string | undefined {
  const direct = normalizeTextValue(text);
  if (direct) {
    return direct;
  }
  if (typeof content === 'string') {
    return normalizeTextValue(content);
  }
  if (content && typeof content === 'object') {
    try {
      return normalizeTextValue(JSON.stringify(content));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function normalizeTextValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readTableRows(raw: LlmElement): string[][] {
  const value = raw.table_rows ?? raw.rows;
  return normalizeParsedTableRows(value);
}

function attachTableData(elements: StructuredDataElement[]): ParsedTable[] {
  const parsedTables: ParsedTable[] = [];
  for (const element of elements) {
    const rows = (element as StructuredDataElement & { __rows?: string[][] }).__rows;
    if (!rows || rows.length === 0) {
      continue;
    }
    const name =
      Array.isArray(element.filePaths) && element.filePaths.length > 0
        ? element.filePaths[0]
        : `tables/${pathToName(element.Path ?? 'table')}.xlsx`.toLowerCase();
    parsedTables.push({ name, rows });
    delete (element as StructuredDataElement & { __rows?: string[][] }).__rows;
  }
  return parsedTables;
}

function attachFigureAssets(elements: StructuredDataElement[], assets: ImageAsset[]): void {
  if (assets.length === 0) {
    return;
  }

  const used = new Set<string>();
  const figureElements = elements.filter((element) => isFigurePath(element.Path));

  for (const element of figureElements) {
    const pageIndex = typeof element.Page === 'number' ? element.Page : 0;
    const bounds = element.attributes?.BBox ?? element.Bounds;
    if (!bounds) {
      continue;
    }

    const candidate = pickBestAsset(bounds, pageIndex, assets, used);
    if (!candidate) {
      continue;
    }

    element.filePaths = [candidate.path];
    element.Bounds = candidate.bounds;
    element.attributes = {
      ...(element.attributes ?? {}),
      BBox: candidate.bounds
    };
    used.add(candidate.path);
  }
}

function pickBestAsset(
  bounds: StructuredBoundsTuple,
  pageIndex: number,
  assets: ImageAsset[],
  used: Set<string>
): ImageAsset | null {
  let best: ImageAsset | null = null;
  let bestScore = -1;

  for (const asset of assets) {
    if (used.has(asset.path) || asset.pageIndex !== pageIndex) {
      continue;
    }
    const score = intersectionOverUnion(bounds, asset.bounds);
    if (score > bestScore) {
      bestScore = score;
      best = asset;
    }
  }

  if (best) {
    return best;
  }

  let fallback: ImageAsset | null = null;
  let fallbackDistance = Number.POSITIVE_INFINITY;
  for (const asset of assets) {
    if (used.has(asset.path) || asset.pageIndex !== pageIndex) {
      continue;
    }
    const distance = centerDistance(bounds, asset.bounds);
    if (distance < fallbackDistance) {
      fallbackDistance = distance;
      fallback = asset;
    }
  }

  return fallback;
}

function ensureFigureElements(elements: StructuredDataElement[], assets: ImageAsset[]): void {
  const known = new Set<string>();
  let figureCount = 0;

  for (const element of elements) {
    if (!isFigurePath(element.Path)) {
      continue;
    }
    figureCount += 1;
    for (const path of element.filePaths ?? []) {
      known.add(path);
    }
  }

  for (const asset of assets) {
    if (known.has(asset.path)) {
      continue;
    }
    figureCount += 1;
    const path = figureCount === 1 ? '//Document/Figure' : `//Document/Figure[${figureCount}]`;
    elements.push({
      Path: path,
      Page: asset.pageIndex,
      Bounds: asset.bounds,
      attributes: {
        BBox: asset.bounds
      },
      filePaths: [asset.path]
    });
  }
}

function isFigurePath(path?: string): boolean {
  return typeof path === 'string' && path.startsWith('//Document/Figure');
}

function intersectionOverUnion(a: StructuredBoundsTuple, b: StructuredBoundsTuple): number {
  const minX = Math.max(a[0], b[0]);
  const minY = Math.max(a[1], b[1]);
  const maxX = Math.min(a[2], b[2]);
  const maxY = Math.min(a[3], b[3]);

  const width = Math.max(0, maxX - minX);
  const height = Math.max(0, maxY - minY);
  const intersection = width * height;
  if (intersection <= 0) {
    return 0;
  }

  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const union = areaA + areaB - intersection;
  if (union <= 0) {
    return 0;
  }

  return intersection / union;
}

function centerDistance(a: StructuredBoundsTuple, b: StructuredBoundsTuple): number {
  const aX = (a[0] + a[2]) / 2;
  const aY = (a[1] + a[3]) / 2;
  const bX = (b[0] + b[2]) / 2;
  const bY = (b[1] + b[3]) / 2;
  const dX = aX - bX;
  const dY = aY - bY;
  return Math.sqrt(dX * dX + dY * dY);
}

function pathToName(path: string): string {
  return path
    .replace(/^\/\//, '')
    .replace(/\//g, '_')
    .replace(/\[(\d+)\]/g, '_$1')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase();
}

function toFiniteNumber(value: unknown): number | null {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(numberValue) ? numberValue : null;
}

async function toArrayBuffer(
  file: StructuredExtractFileInput,
  fileName?: string
): Promise<{ buffer: ArrayBuffer; fileName?: string }> {
  if (typeof Blob !== 'undefined' && file instanceof Blob) {
    const resolvedFileName = fileName ?? (isFileWithName(file) ? file.name : undefined);
    return { buffer: await file.arrayBuffer(), fileName: resolvedFileName };
  }
  if (file instanceof ArrayBuffer) {
    return { buffer: file, fileName };
  }
  if (file instanceof Uint8Array) {
    return {
      buffer: file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
      fileName
    };
  }
  throw new Error('Unsupported input type for structured extraction');
}

function isFileWithName(value: Blob): value is File {
  return typeof (value as File).name === 'string';
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const maybeBuffer = (globalThis as { Buffer?: { from(value: Uint8Array): { toString(format: string): string } } }).Buffer;
  if (maybeBuffer) {
    return maybeBuffer.from(new Uint8Array(buffer)).toString('base64');
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
