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
}

export interface StructuredPage {
  page_number?: number;
  width?: number;
  height?: number;
  rotation?: number;
  boxes?: {
    MediaBox?: StructuredBoundsTuple;
    CropBox?: StructuredBoundsTuple;
  };
}

export interface StructuredDataDocument {
  version?: Record<string, unknown>;
  extended_metadata?: Record<string, unknown>;
  elements: StructuredDataElement[];
  pages: StructuredPage[];
}

export interface StructuredRenderOptions {
  assetsBaseUrl?: string;
  scale?: number;
  assetMap?: Record<string, string>;
  tables?: TableModel[];
}

const SAMPLE_STRUCTURED_ROOT = '../../../data/NIPS-2017-attention-is-all-you-need-Paper/output/';
import sampleStructuredData from '../../../data/NIPS-2017-attention-is-all-you-need-Paper/output/structuredData.json';
import { TABLE_DATA } from './tableData';

export const SAMPLE_STRUCTURED_DATA_URL = new URL(`${SAMPLE_STRUCTURED_ROOT}structuredData.json`, import.meta.url).href;

export const SAMPLE_STRUCTURED_ASSETS_BASE = new URL(SAMPLE_STRUCTURED_ROOT, import.meta.url).href;

const SAMPLE_ASSET_MANIFEST = import.meta.glob<string>(
  '../../../data/NIPS-2017-attention-is-all-you-need-Paper/output/**/*',
  {
    eager: true,
    import: 'default'
  }
) as Record<string, string>;
const SAMPLE_ASSET_MAP = buildAssetManifest(SAMPLE_ASSET_MANIFEST, SAMPLE_STRUCTURED_ROOT);
const SAMPLE_STRUCTURED_DATA: StructuredDataDocument = sampleStructuredData as StructuredDataDocument;

type NormalizedBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type TableCell = {
  row: number;
  col: number;
  text: string;
  kind: 'td' | 'th';
};

export type TableModel = {
  id: string;
  page: number;
  bounds: NormalizedBounds | null;
  cells: TableCell[];
  sourceFile?: string | null;
};

const DEFAULT_PAGE_WIDTH = 612;
const DEFAULT_PAGE_HEIGHT = 792;

export async function loadStructuredData(url?: string): Promise<StructuredDataDocument> {
  if (!url || url === SAMPLE_STRUCTURED_DATA_URL) {
    return SAMPLE_STRUCTURED_DATA;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load structured data (${response.status})`);
  }
  const parsed = (await response.json()) as StructuredDataDocument;
  if (!parsed || !Array.isArray(parsed.elements) || !Array.isArray(parsed.pages)) {
    throw new Error('Structured data payload is missing required fields.');
  }
  return parsed;
}

export function renderStructuredData(
  container: HTMLElement,
  structuredDoc: StructuredDataDocument,
  options: StructuredRenderOptions = {},
  onElementClick?: (payload: {
    event: MouseEvent;
    element: HTMLElement;
  pageNumber: number;
  path?: string;
  text?: string;
  rect: NormalizedBounds;
  tableId?: string | null;
  elementId?: number | null;
}) => void
): void {
  const scale = Number.isFinite(options.scale) && options.scale ? options.scale : 1;
  const assetsBaseUrl = options.assetsBaseUrl ?? SAMPLE_STRUCTURED_ASSETS_BASE;
  const assetMap =
    options.assetMap ?? (assetsBaseUrl === SAMPLE_STRUCTURED_ASSETS_BASE ? SAMPLE_ASSET_MAP : null);

  container.innerHTML = '';

  const viewer = document.createElement('div');
  viewer.className = 'structured-viewer';

  const tables = options.tables ?? buildStructuredTables(structuredDoc.elements);

  let pages = normalizePages(structuredDoc.pages);
  const elementsByPage = groupElementsByPage(structuredDoc.elements);
  if (pages.length === 0 && elementsByPage.size > 0) {
    pages = Array.from(elementsByPage.keys()).map((pageNumber) => ({
      index: pageNumber,
      page_number: pageNumber,
      width: DEFAULT_PAGE_WIDTH,
      height: DEFAULT_PAGE_HEIGHT
    }));
  }

  for (const page of pages) {
    const pageNumber = page.page_number ?? page.index;
    const { width, height } = resolvePageSize(page);

    const pageElement = document.createElement('section');
    pageElement.className = 'structured-page';
    pageElement.style.width = `${width * scale}px`;
    pageElement.style.height = `${height * scale}px`;
    pageElement.dataset.pageNumber = String(pageNumber);

    const badge = document.createElement('div');
    badge.className = 'structured-page-badge';
    badge.textContent = `Page ${pageNumber + 1}`;

    const layer = document.createElement('div');
    layer.className = 'structured-page-layer';

    const tablesForPage = tables.filter((table) => table.page === pageNumber);
    for (const table of tablesForPage) {
      const tableBlock = renderTable(table, scale, pageNumber, onElementClick);
      if (tableBlock) {
        layer.appendChild(tableBlock);
      }
    }

    const pageElements = elementsByPage.get(pageNumber) ?? [];
    for (const element of pageElements) {
      if (isTableRelated(element.Path)) {
        continue;
      }
      const bounds = normalizeBounds(element, height);
      if (!bounds) {
        continue;
      }
      const block = renderElement(element, bounds, scale, assetsBaseUrl, assetMap, pageNumber, onElementClick);
      if (block) {
        layer.appendChild(block);
      }
    }

    pageElement.appendChild(layer);
    pageElement.appendChild(badge);
    viewer.appendChild(pageElement);
  }

  container.appendChild(viewer);
}

function renderElement(
  element: StructuredDataElement,
  bounds: NormalizedBounds,
  scale: number,
  assetsBaseUrl: string,
  assetMap: Record<string, string> | null,
  pageNumber: number,
  onElementClick?: (payload: {
    event: MouseEvent;
    element: HTMLElement;
    pageNumber: number;
    path?: string;
    text?: string;
    rect: NormalizedBounds;
    tableId?: string | null;
    elementId?: number | null;
  }) => void
): HTMLElement | null {
  const padding = 2;
  const paddedLeft = Math.max(0, bounds.left - padding);
  const paddedTop = Math.max(0, bounds.top - padding);
  const paddedWidth = bounds.width + padding * 2;
  const paddedHeight = bounds.height + padding * 2;

  const isTable = isTablePath(element.Path);
  const isAsset = Array.isArray(element.filePaths) && element.filePaths.length > 0;
  if (isAsset && isTableAsset(element)) {
    return null;
  }

  const tagName = pickTagName(element, isAsset, isTable);
  const block = document.createElement(tagName);
  block.className = 'structured-block';
  if (isTable) {
    block.classList.add('structured-block--table');
  }
  block.dataset.pageNumber = String(pageNumber);
  if (element.Path) {
    block.dataset.path = element.Path;
  }
  if (typeof element.elementId === 'number') {
    block.dataset.elementId = String(element.elementId);
  }
  if (element.Path) {
    block.dataset.path = element.Path;
  }
  const tableId = isTable ? extractTableId(element.Path) : null;
  block.style.left = `${paddedLeft * scale}px`;
  block.style.top = `${paddedTop * scale}px`;
  block.style.width = `${paddedWidth * scale}px`;
  block.style.height = `${paddedHeight * scale}px`;
  block.style.boxSizing = 'border-box';
  block.style.padding = `${padding}px`;
  if (element.Path) {
    block.title = element.Path;
  }

  if (isAsset) {
    block.classList.add('structured-block--asset');
    renderAsset(block, element.filePaths, assetsBaseUrl, assetMap, element.Path);
  } else {
    block.classList.add('structured-block--text');
    renderText(block, element);
  }

  if (onElementClick) {
    block.addEventListener('click', (event) => {
      onElementClick({
        event,
        element: block,
        pageNumber,
        path: element.Path,
        text: element.Text ?? undefined,
        rect: {
          left: paddedLeft,
          top: paddedTop,
          width: paddedWidth,
          height: paddedHeight
        },
        tableId,
        elementId: element.elementId ?? null
      });
    });
  }

  return block;
}

function renderTable(
  table: TableModel,
  scale: number,
  pageNumber: number,
  onElementClick?: (payload: {
    event: MouseEvent;
    element: HTMLElement;
    pageNumber: number;
    path?: string;
    text?: string;
    rect: NormalizedBounds;
    tableId?: string | null;
  }) => void
): HTMLElement | null {
  if (!table.bounds || table.cells.length === 0) {
    return null;
  }
  const padding = 4;
  const block = document.createElement('div');
  block.className = 'structured-block structured-block--table';
  block.style.left = `${Math.max(0, table.bounds.left - padding) * scale}px`;
  block.style.top = `${Math.max(0, table.bounds.top - padding) * scale}px`;
  block.style.width = `${(table.bounds.width + padding * 2) * scale}px`;
  block.style.height = `${(table.bounds.height + padding * 2) * scale}px`;
  block.style.boxSizing = 'border-box';
  block.style.padding = `${padding}px`;
  block.dataset.pageNumber = String(pageNumber);
  block.dataset.tableId = table.id;

  const tableEl = document.createElement('table');
  tableEl.className = 'structured-table';

  const rows = new Map<number, TableCell[]>();
  for (const cell of table.cells) {
    if (!rows.has(cell.row)) {
      rows.set(cell.row, []);
    }
    rows.get(cell.row)!.push(cell);
  }

  const sortedRows = Array.from(rows.entries()).sort((a, b) => a[0] - b[0]);
  for (const [, cells] of sortedRows) {
    const tr = document.createElement('tr');
    cells.sort((a, b) => a.col - b.col);
    for (const cell of cells) {
      const cellEl = document.createElement(cell.kind);
      cellEl.textContent = cell.text.trim();
      tr.appendChild(cellEl);
    }
    tableEl.appendChild(tr);
  }

  block.appendChild(tableEl);
  if (onElementClick) {
    block.addEventListener('click', (event) => {
      onElementClick({
        event,
        element: block,
        pageNumber,
        path: table.id,
        text: undefined,
        rect: {
          left: Math.max(0, table.bounds!.left - padding),
          top: Math.max(0, table.bounds!.top - padding),
          width: table.bounds!.width + padding * 2,
          height: table.bounds!.height + padding * 2
        },
        tableId: table.id
      });
    });
  }
  return block;
}

function renderText(block: HTMLElement, element: StructuredDataElement): void {
  block.style.display = 'block';
  block.textContent = element.Text ?? '';
  const fontFamily = element.Font?.family_name ?? element.Font?.alt_family_name;
  if (fontFamily) {
    block.style.fontFamily = `${fontFamily}, 'Times New Roman', serif`;
  }
  if (element.Font?.italic) {
    block.style.fontStyle = 'italic';
  }
  if (typeof element.Font?.weight === 'number') {
    block.style.fontWeight = String(element.Font.weight);
  }
  if (typeof element.TextSize === 'number' && Number.isFinite(element.TextSize)) {
    block.style.fontSize = `${element.TextSize}px`;
  }
  const lineHeightRaw =
    typeof element.attributes?.LineHeight === 'number' && Number.isFinite(element.attributes.LineHeight)
      ? element.attributes.LineHeight
      : typeof element.TextSize === 'number' && Number.isFinite(element.TextSize)
        ? element.TextSize
        : null;
  if (lineHeightRaw) {
    const lineHeight = Math.max(1, lineHeightRaw * 0.97);
    block.style.lineHeight = `${lineHeight}px`;
  }
  if (typeof element.attributes?.TextAlign === 'string') {
    block.style.textAlign = element.attributes.TextAlign.toLowerCase();
  }
}

function renderAsset(
  block: HTMLElement,
  filePaths: string[],
  assetsBaseUrl: string,
  assetMap: Record<string, string> | null,
  label?: string
): void {
  const assetPath = pickAssetPath(filePaths);
  if (!assetPath) {
    block.textContent = 'Asset not available';
    return;
  }
  const assetUrl = resolveAssetUrl(assetPath, assetsBaseUrl, assetMap);
  if (isImagePath(assetPath)) {
    const img = document.createElement('img');
    img.src = assetUrl;
    img.alt = label ?? 'Embedded asset';
    block.appendChild(img);
  } else {
    const link = document.createElement('a');
    link.href = assetUrl;
    link.textContent = label ?? 'Open attachment';
    link.target = '_blank';
    link.rel = 'noreferrer';
    block.appendChild(link);
  }
}

function normalizeBounds(element: StructuredDataElement, pageHeight: number): NormalizedBounds | null {
  const sourceBounds = element.Bounds ?? element.attributes?.BBox;
  if (!Array.isArray(sourceBounds) || sourceBounds.length !== 4) {
    return null;
  }
  const [minX, minY, maxX, maxY] = sourceBounds;
  const width = maxX - minX;
  const height = maxY - minY;
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  return {
    left: minX,
    top: Math.max(0, pageHeight - maxY),
    width: Math.max(1, width),
    height: Math.max(1, height)
  };
}

function resolvePageSize(page: StructuredPage): { width: number; height: number } {
  const width = page.width ?? page.boxes?.MediaBox?.[2] ?? DEFAULT_PAGE_WIDTH;
  const height = page.height ?? page.boxes?.MediaBox?.[3] ?? DEFAULT_PAGE_HEIGHT;
  return {
    width: Number.isFinite(width) && width > 0 ? width : DEFAULT_PAGE_WIDTH,
    height: Number.isFinite(height) && height > 0 ? height : DEFAULT_PAGE_HEIGHT
  };
}

function normalizePages(pages: StructuredPage[]): Array<StructuredPage & { index: number }> {
  return pages
    .map((page, index) => ({ ...page, index }))
    .sort((left, right) => (left.page_number ?? left.index) - (right.page_number ?? right.index));
}

function groupElementsByPage(elements: StructuredDataElement[]): Map<number, StructuredDataElement[]> {
  const grouped = new Map<number, StructuredDataElement[]>();
  for (const element of elements) {
    const page = typeof element.Page === 'number' ? element.Page : 0;
    if (!grouped.has(page)) {
      grouped.set(page, []);
    }
    grouped.get(page)!.push(element);
  }

  for (const [page, items] of grouped.entries()) {
    items.sort((left, right) => (left.elementId ?? 0) - (right.elementId ?? 0));
    grouped.set(page, items);
  }

  return grouped;
}

function buildAssetManifest(rawManifest: Record<string, string>, rootPath: string): Record<string, string> {
  const normalizedRoot = ensureTrailingSlash(rootPath);
  const manifest: Record<string, string> = {};
  for (const [key, url] of Object.entries(rawManifest)) {
    const offset = key.indexOf(normalizedRoot);
    const relativePath =
      offset >= 0
        ? key.slice(offset + normalizedRoot.length)
        : (() => {
            const marker = '/output/';
            const markerIndex = key.lastIndexOf(marker);
            return markerIndex >= 0 ? key.slice(markerIndex + marker.length) : key;
          })();
    const cleanedPath = trimLeadingSlash(relativePath);
    manifest[cleanedPath] = url;
  }
  return manifest;
}

function pickAssetPath(filePaths: string[]): string | null {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return null;
  }
  const imagePath = filePaths.find(isImagePath);
  return imagePath ?? filePaths[0];
}

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|bmp|webp)$/i.test(path);
}

function isTablePath(path?: string): boolean {
  return typeof path === 'string' && path.includes('/Table');
}

function isTableRelated(path?: string): boolean {
  return typeof path === 'string' && path.includes('/Table');
}

function isTableAsset(element: StructuredDataElement): boolean {
  const paths = element.filePaths ?? [];
  if (paths.some((p) => p.toLowerCase().includes('/tables/'))) {
    return true;
  }
  return isTablePath(element.Path) && paths.length > 0;
}

function pickTagName(element: StructuredDataElement, isAsset: boolean, isTable: boolean): keyof HTMLElementTagNameMap {
  if (isAsset) {
    return 'figure';
  }
  if (!isTable || !element.Path) {
    return 'div';
  }
  const segments = element.Path.split('/').filter(Boolean);
  const cleaned = segments
    .map((segment) => segment.replace(/\[.*?\]/g, ''))
    .map((segment) => segment.replace(/\[\d+\]/g, ''));
  const last = cleaned[cleaned.length - 1]?.toLowerCase() ?? '';
  if (last === 'th') return 'th';
  if (last === 'td') return 'td';
  if (last === 'tr') return 'tr';
  if (last === 'thead') return 'thead';
  if (last === 'tbody') return 'tbody';
  if (last === 'table') return 'table';
  if (last === 'p') return 'p';
  return 'div';
}

export function buildStructuredTables(elements: StructuredDataElement[]): TableModel[] {
  const models = new Map<string, TableModel>();

  for (const element of elements) {
    if (!isTableRelated(element.Path)) {
      continue;
    }
    const tableId = extractTableId(element.Path);
    if (!tableId) {
      continue;
    }
    if (!models.has(tableId)) {
      models.set(tableId, {
        id: tableId,
        page: element.Page ?? 0,
        bounds: null,
        cells: [],
        sourceFile: findTableSourceFile(element.filePaths)
      });
    }
    const model = models.get(tableId)!;
    if (!model.sourceFile) {
      model.sourceFile = findTableSourceFile(element.filePaths);
    }

    const candidateBounds = normalizeBounds(element, DEFAULT_PAGE_HEIGHT);
    if (candidateBounds) {
      model.bounds = mergeBounds(model.bounds, candidateBounds);
    }
    if (typeof element.Page === 'number') {
      model.page = element.Page;
    }

    if (typeof element.Text !== 'string' || element.Text.trim().length === 0) {
      continue;
    }

    const rowInfo = extractRowInfo(element.Path);
    const cellInfo = extractCellInfo(element.Path);
    if (!rowInfo || !cellInfo) {
      continue;
    }

    const text = element.Text.trim();
    const existing = model.cells.find((cell) => cell.row === rowInfo.row && cell.col === cellInfo.col);
    if (existing) {
      existing.text = `${existing.text} ${text}`.trim();
    } else {
      model.cells.push({
        row: rowInfo.row,
        col: cellInfo.col,
        text,
        kind: cellInfo.kind
      });
    }
  }

  return Array.from(models.values()).map((model) => applyTableDataFromAssets(model));
}

export function extractTableId(path?: string): string | null {
  if (!path) return null;
  const match = path.match(/(.*?Table(?:\[\d+\])?)/);
  return match ? match[1] : null;
}

function extractRowInfo(path?: string): { row: number } | null {
  if (!path) return null;
  const match = path.match(/TR(?:\[(\d+)\])?/);
  if (!match) return null;
  return { row: match[1] ? Number(match[1]) : 1 };
}

function extractCellInfo(path?: string): { col: number; kind: 'td' | 'th' } | null {
  if (!path) return null;
  const tdMatch = path.match(/TD(?:\[(\d+)\])?/);
  const thMatch = path.match(/TH(?:\[(\d+)\])?/);
  if (tdMatch) {
    return { col: tdMatch[1] ? Number(tdMatch[1]) : 1, kind: 'td' };
  }
  if (thMatch) {
    return { col: thMatch[1] ? Number(thMatch[1]) : 1, kind: 'th' };
  }
  return null;
}

function mergeBounds(current: NormalizedBounds | null, candidate: NormalizedBounds): NormalizedBounds {
  if (!current) {
    return candidate;
  }
  const minX = Math.min(current.left, candidate.left);
  const minY = Math.min(current.top, candidate.top);
  const maxX = Math.max(current.left + current.width, candidate.left + candidate.width);
  const maxY = Math.max(current.top + current.height, candidate.top + candidate.height);
  return {
    left: minX,
    top: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function findTableSourceFile(filePaths?: string[]): string | null {
  if (!Array.isArray(filePaths)) {
    return null;
  }
  for (const path of filePaths) {
    if (path.toLowerCase().endsWith('.xlsx')) {
      const parts = path.split('/');
      return parts[parts.length - 1];
    }
  }
  return null;
}

function applyTableDataFromAssets(model: TableModel): TableModel {
  if (!model.sourceFile) {
    return model;
  }
  const data = TABLE_DATA[model.sourceFile];
  if (!data) {
    return model;
  }
  const cells: TableCell[] = [];
  for (let rowIndex = 0; rowIndex < data.length; rowIndex += 1) {
    const row = data[rowIndex];
    for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
      const raw = row[colIndex];
      const text = cleanTableText(raw);
      cells.push({
        row: rowIndex + 1,
        col: colIndex + 1,
        text: text.length > 0 ? text : '\u00A0',
        kind: rowIndex === 0 ? 'th' : 'td'
      });
    }
  }
  if (cells.length === 0) {
    return model;
  }
  return {
    ...model,
    cells
  };
}

function cleanTableText(value: string): string {
  if (!value) {
    return '';
  }
  return value.replace(/_x000D_/gi, '').replace(/\s+/g, ' ').trim();
}

function resolveAssetUrl(path: string, baseUrl: string, assetMap: Record<string, string> | null): string {
  const normalizedPath = trimLeadingSlash(path);
  if (assetMap && assetMap[normalizedPath]) {
    return assetMap[normalizedPath];
  }
  try {
    return new URL(normalizedPath, ensureTrailingSlash(baseUrl)).href;
  } catch {
    return path;
  }
}

function ensureTrailingSlash(value: string): string {
  if (value.endsWith('/')) {
    return value;
  }
  return `${value}/`;
}

function trimLeadingSlash(value: string): string {
  return value.startsWith('/') ? value.slice(1) : value;
}
