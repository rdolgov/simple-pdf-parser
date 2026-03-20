import type { StructuredDataDocument, StructuredDataElement, StructuredPage } from 'pdf-layout-parser';
import type {
  GeminiDocumentExtraction,
  GeminiElement,
  GeminiElementType,
  GeminiPageExtraction
} from '../storage/geminiExtractionStorage';

type StructuredElementWithSemantics = StructuredDataElement & {
  SemanticType?: unknown;
  StructuredContent?: unknown;
  Description?: unknown;
};

export function deriveGeminiExtractionFromStructuredData(document: StructuredDataDocument): GeminiDocumentExtraction {
  const pages = normalizePages(document.pages);
  const elementsByPage = new Map<number, GeminiElement[]>();

  for (const element of document.elements ?? []) {
    const pageIndex = normalizePageIndex(element.Page);
    const page = pages[pageIndex];
    if (!page) {
      continue;
    }

    const bounds = readRatioBounds(element, page.width, page.height);
    if (!bounds) {
      continue;
    }

    const nextElement: GeminiElement = {
      type: normalizeElementType(element),
      content: readElementContent(element),
      bounding_box: bounds
    };

    const description = readNonEmptyString((element as StructuredElementWithSemantics).Description);
    if (description) {
      nextElement.description = description;
    }

    const pageNumber = pageIndex + 1;
    const existing = elementsByPage.get(pageNumber);
    if (existing) {
      existing.push(nextElement);
    } else {
      elementsByPage.set(pageNumber, [nextElement]);
    }
  }

  const extractedPages: GeminiPageExtraction[] = pages.map((_, index) => ({
    page_number: index + 1,
    elements: elementsByPage.get(index + 1) ?? []
  }));

  const documentTitle = resolveDocumentTitle(document.elements ?? []);
  return documentTitle ? { document_title: documentTitle, pages: extractedPages } : { pages: extractedPages };
}

function normalizePages(rawPages: StructuredPage[] | undefined): Array<{ width: number; height: number }> {
  if (!Array.isArray(rawPages) || rawPages.length === 0) {
    return [];
  }
  return rawPages.map((page) => ({
    width: typeof page.width === 'number' && page.width > 0 ? page.width : 612,
    height: typeof page.height === 'number' && page.height > 0 ? page.height : 792
  }));
}

function normalizePageIndex(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function readRatioBounds(
  element: StructuredDataElement,
  pageWidth: number,
  pageHeight: number
): [number, number, number, number] | null {
  const tuple = normalizeBoundsTuple(element.attributes?.BBox ?? element.Bounds);
  if (!tuple) {
    return null;
  }
  const [minX, minY, maxX, maxY] = tuple;
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0 || pageWidth <= 0 || pageHeight <= 0) {
    return null;
  }

  const x = clampRatio(minX / pageWidth);
  const y = clampRatio(1 - maxY / pageHeight);
  const ratioWidth = clampRatio(width / pageWidth);
  const ratioHeight = clampRatio(height / pageHeight);

  if (ratioWidth <= 0 || ratioHeight <= 0) {
    return null;
  }

  return [x, y, ratioWidth, ratioHeight];
}

function normalizeBoundsTuple(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) {
    return null;
  }
  const numbers = value.map((entry) => (typeof entry === 'number' ? entry : Number(entry)));
  if (!numbers.every((entry) => Number.isFinite(entry))) {
    return null;
  }
  return numbers as [number, number, number, number];
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function normalizeElementType(element: StructuredDataElement): GeminiElementType {
  const structured = element as StructuredElementWithSemantics;
  const semanticType = readNonEmptyString(structured.SemanticType)?.toLowerCase();
  if (semanticType) {
    const mapped = mapSemanticType(semanticType);
    if (mapped) {
      return mapped;
    }
  }

  const path = readNonEmptyString(element.Path) ?? '';
  if (path.startsWith('//Document/Title')) {
    return 'title';
  }
  if (path.startsWith('//Document/H')) {
    return 'heading';
  }
  if (path.startsWith('//Document/Table')) {
    return 'table';
  }
  if (path.startsWith('//Document/Figure')) {
    return 'image';
  }
  if (path.startsWith('//Document/Reference')) {
    return 'reference';
  }
  if (path.startsWith('//Document/Formula')) {
    return 'formula';
  }
  if (path.startsWith('//Document/Caption')) {
    return 'caption';
  }
  if (path.startsWith('//Document/Footnote')) {
    return 'footnote';
  }
  if (path.startsWith('//Document/Authors')) {
    return 'authors';
  }
  if (path.startsWith('//Document/L')) {
    return 'list';
  }

  return 'paragraph';
}

function mapSemanticType(value: string): GeminiElementType | null {
  switch (value) {
    case 'title':
      return 'title';
    case 'h1':
    case 'h2':
    case 'h3':
    case 'heading':
    case 'header':
    case 'subheading':
    case 'sub-header':
      return 'heading';
    case 'authors':
    case 'author':
      return 'authors';
    case 'paragraph':
    case 'other':
      return 'paragraph';
    case 'footnote':
      return 'footnote';
    case 'reference':
    case 'citation':
      return 'reference';
    case 'image':
    case 'figure':
    case 'diagram':
      return 'image';
    case 'table':
      return 'table';
    case 'formula':
    case 'equation':
    case 'math':
      return 'formula';
    case 'caption':
      return 'caption';
    case 'list':
    case 'bullet':
      return 'list';
    default:
      return null;
  }
}

function readElementContent(element: StructuredDataElement): string | Record<string, unknown> {
  const structured = element as StructuredElementWithSemantics;
  if (structured.StructuredContent && typeof structured.StructuredContent === 'object') {
    return structured.StructuredContent as Record<string, unknown>;
  }
  return readNonEmptyString(element.Text) ?? '';
}

function resolveDocumentTitle(elements: StructuredDataElement[]): string | undefined {
  for (const element of elements) {
    if (normalizeElementType(element) === 'title') {
      const title = readNonEmptyString(element.Text);
      if (title) {
        return title;
      }
    }
  }
  return undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
