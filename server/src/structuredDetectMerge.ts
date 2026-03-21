import type { TaskStructuredDetectResult } from './taskExecutors.js';

export interface StructuredDetectProgress {
  totalPages: number;
  completedPages: number;
  publishedPages: number;
}

export interface StructuredDetectPageResult {
  pageNumber: number;
  result: TaskStructuredDetectResult;
}

export interface StructuredDetectUnitResult {
  startPage: number;
  pageCount: number;
  result: TaskStructuredDetectResult;
}

export function mergeStructuredDetectPageResults(pageResults: StructuredDetectPageResult[]): TaskStructuredDetectResult {
  return mergeStructuredDetectUnitResults(
    pageResults.map((pageResult) => ({
      startPage: pageResult.pageNumber,
      pageCount: 1,
      result: pageResult.result
    }))
  );
}

export function mergeStructuredDetectUnitResults(unitResults: StructuredDetectUnitResult[]): TaskStructuredDetectResult {
  const sorted = [...unitResults].sort((left, right) => left.startPage - right.startPage);
  const firstDocument = (sorted[0]?.result.document ?? {}) as Record<string, unknown>;
  const pages: Array<Record<string, unknown>> = [];
  const elements: Array<Record<string, unknown>> = [];
  const parsedTables: Array<{ name: string; rows: string[][] }> = [];
  const assetMap: Record<string, string> = {};
  const prompts: string[] = [];
  const rawTexts: string[] = [];

  let nextElementId = 0;

  for (const unitResult of sorted) {
    const document = unitResult.result.document as {
      pages?: Array<Record<string, unknown>>;
      elements?: Array<Record<string, unknown>>;
    };
    const filePathPageMap = buildFilePathPageMap(document.elements ?? [], unitResult.startPage, unitResult.pageCount);

    for (let localPageIndex = 0; localPageIndex < unitResult.pageCount; localPageIndex += 1) {
      const absolutePageIndex = unitResult.startPage - 1 + localPageIndex;
      const pageRecord = document.pages?.[localPageIndex]
        ? {
            ...document.pages[localPageIndex],
            page_number: absolutePageIndex
          }
        : { page_number: absolutePageIndex };
      pages.push(pageRecord);
    }

    for (const [rawPath, value] of Object.entries(unitResult.result.assetMap)) {
      const pageNumber = filePathPageMap.get(rawPath) ?? unitResult.startPage;
      const scopedPath = scopeAssetPath(pageNumber, rawPath);
      assetMap[scopedPath] = value;
    }

    for (const table of unitResult.result.parsedTables as Array<{ name?: string; rows?: string[][] }>) {
      const rawName = table.name ?? `table-page-${unitResult.startPage}.xlsx`;
      const pageNumber = filePathPageMap.get(rawName) ?? unitResult.startPage;
      const scopedName = scopeAssetPath(pageNumber, rawName);
      parsedTables.push({
        name: scopedName,
        rows: Array.isArray(table.rows) ? table.rows : []
      });
    }

    for (const rawElement of document.elements ?? []) {
      const relativePageIndex = normalizeRelativePageIndex(rawElement.Page, unitResult.pageCount);
      const absolutePageIndex = unitResult.startPage - 1 + relativePageIndex;
      const nextElement: Record<string, unknown> = {
        ...rawElement,
        Page: absolutePageIndex,
        elementId: nextElementId++
      };
      if (Array.isArray(rawElement.filePaths)) {
        nextElement.filePaths = rawElement.filePaths.map((value) =>
          scopeAssetPath(filePathPageMap.get(value) ?? unitResult.startPage + relativePageIndex, value)
        );
      }
      elements.push(nextElement);
    }

    if (unitResult.result.rawText.trim().length > 0) {
      rawTexts.push(unitResult.result.rawText.trim());
    }
    if (unitResult.result.prompt.trim().length > 0) {
      prompts.push(unitResult.result.prompt.trim());
    }
  }

  return {
    document: {
      ...stripPagesAndElements(firstDocument),
      pages,
      elements
    },
    parsedTables,
    assetMap,
    model: sorted[0]?.result.model ?? 'unknown',
    prompt: prompts[0] ?? '',
    rawText: rawTexts.join('\n\n')
  };
}

function stripPagesAndElements(value: Record<string, unknown>): Record<string, unknown> {
  const { pages: _pages, elements: _elements, ...rest } = value;
  return rest;
}

function scopeAssetPath(pageNumber: number, value: string): string {
  const trimmed = value.trim().replace(/^\/+/, '');
  return `pages/page-${String(pageNumber).padStart(4, '0')}/${trimmed}`;
}

function buildFilePathPageMap(
  elements: Array<Record<string, unknown>>,
  startPage: number,
  pageCount: number
): Map<string, number> {
  const filePathPageMap = new Map<string, number>();
  for (const rawElement of elements) {
    if (!Array.isArray(rawElement.filePaths)) {
      continue;
    }
    const absolutePageNumber = startPage + normalizeRelativePageIndex(rawElement.Page, pageCount);
    for (const filePath of rawElement.filePaths) {
      if (typeof filePath !== 'string' || filePathPageMap.has(filePath)) {
        continue;
      }
      filePathPageMap.set(filePath, absolutePageNumber);
    }
  }
  return filePathPageMap;
}

function normalizeRelativePageIndex(value: unknown, pageCount: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < pageCount) {
    return Math.floor(value);
  }
  return 0;
}
