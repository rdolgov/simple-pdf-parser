import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  PDFDocument,
  convertLayoutToHtml,
  type HtmlContentBlock,
  type HtmlDocumentLayout,
  type HtmlPageLayout,
  type HtmlTableBlock,
  type HtmlTableRow,
  type HtmlTextSpan,
  type PDFGlyphSpan,
  type PDFImageBounds
} from '../../src/index.js';
import { mergeTextRuns } from '../../src/parser/textSmoother.js';
import type { DocumentCitationTextRun } from '../../src/query/documentCitationTypes.js';
import type { StoredDocumentRecord } from './taskStore.js';
import { TaskStore } from './taskStore.js';

export interface DocumentEvidenceRecord {
  evidenceId: string;
  pageNumber: number;
  kind: 'paragraph' | 'heading' | 'table-row';
  text: string;
  normalizedText: string;
  bounds: PDFImageBounds;
  textRuns: DocumentCitationTextRun[];
}

export interface DocumentEvidenceIndex {
  schemaVersion: number;
  documentId: string;
  fileHash: string;
  createdAt: string;
  records: DocumentEvidenceRecord[];
}

interface TextRunCandidate {
  used: boolean;
  run: SourceTextRun;
}

interface SourceTextRun {
  text: string;
  bounds: PDFImageBounds;
  baselineStart?: { x: number; y: number };
  baselineEnd?: { x: number; y: number };
  glyphSpans?: PDFGlyphSpan[];
}

const EVIDENCE_INDEX_SCHEMA_VERSION = 1;
const BOUNDS_TOLERANCE = 1.5;

export async function loadOrBuildEvidenceIndex(
  document: StoredDocumentRecord,
  taskStore: TaskStore
): Promise<DocumentEvidenceIndex> {
  const cached = await taskStore.getEvidenceIndex<DocumentEvidenceIndex>(document.id);
  if (
    cached &&
    cached.schemaVersion === EVIDENCE_INDEX_SCHEMA_VERSION &&
    cached.documentId === document.id &&
    cached.fileHash === document.fileHash
  ) {
    return cached;
  }

  const built = await buildEvidenceIndexFromPdf(document);
  await taskStore.setEvidenceIndex(document.id, built);
  return built;
}

export async function buildEvidenceIndexFromPdf(document: StoredDocumentRecord): Promise<DocumentEvidenceIndex> {
  const bytes = await readFile(document.filePath);
  const pdfDocument = PDFDocument.from(bytes);
  const htmlLayout = convertLayoutToHtml({
    pages: pdfDocument.pages,
    fontResources: Object.keys(pdfDocument.getFontResources()).length > 0 ? pdfDocument.getFontResources() : undefined
  });

  const records = buildEvidenceRecordsFromLayout(pdfDocument, htmlLayout);

  return {
    schemaVersion: EVIDENCE_INDEX_SCHEMA_VERSION,
    documentId: document.id,
    fileHash: document.fileHash,
    createdAt: new Date().toISOString(),
    records
  };
}

export function buildEvidenceRecordsFromLayout(
  pdfDocument: Pick<PDFDocument, 'pages'>,
  htmlLayout: HtmlDocumentLayout
): DocumentEvidenceRecord[] {
  const records: DocumentEvidenceRecord[] = [];

  for (const htmlPage of htmlLayout.pages) {
    const pdfPage = pdfDocument.pages.find((page) => page.number === htmlPage.number);
    if (!pdfPage) {
      continue;
    }

    const textRunCandidates = mergeTextRuns(pdfPage.textItems).map((item) => ({
      used: false,
      run: {
        text: item.text,
        bounds: cloneBounds(item.bounds),
        ...(item.baselineStart ? { baselineStart: { ...item.baselineStart } } : {}),
        ...(item.baselineEnd ? { baselineEnd: { ...item.baselineEnd } } : {}),
        ...(item.glyphSpans ? { glyphSpans: item.glyphSpans.map(cloneGlyphSpan) } : {})
      }
    }));

    for (const block of htmlPage.content) {
      if (block.type === 'paragraph' || block.type === 'heading') {
        const record = buildEvidenceRecord({
          pageNumber: htmlPage.number,
          kind: block.type,
          bounds: block.bounds,
          spans: block.spans,
          textRunCandidates,
          recordIndex: records.length
        });
        if (record) {
          records.push(record);
        }
        continue;
      }

      if (block.type === 'table') {
        const rowRecords = buildTableRowEvidenceRecords(htmlPage, block, textRunCandidates, records.length);
        records.push(...rowRecords);
      }
    }
  }

  return records;
}

function buildTableRowEvidenceRecords(
  page: HtmlPageLayout,
  block: HtmlTableBlock,
  textRunCandidates: TextRunCandidate[],
  startIndex: number
): DocumentEvidenceRecord[] {
  const records: DocumentEvidenceRecord[] = [];

  block.rows.forEach((row, rowIndex) => {
    const spans = flattenRowSpans(row);
    const record = buildEvidenceRecord({
      pageNumber: page.number,
      kind: 'table-row',
      bounds: row.bounds,
      spans,
      textRunCandidates,
      recordIndex: startIndex + rowIndex
    });
    if (record) {
      records.push(record);
    }
  });

  return records;
}

function buildEvidenceRecord(input: {
  pageNumber: number;
  kind: DocumentEvidenceRecord['kind'];
  bounds: PDFImageBounds;
  spans: HtmlTextSpan[];
  textRunCandidates: TextRunCandidate[];
  recordIndex: number;
}): DocumentEvidenceRecord | null {
  const sourceRuns: SourceTextRun[] = input.spans
    .map((span) => matchSpanToSourceRun(span, input.textRunCandidates))
    .filter((run): run is SourceTextRun => Boolean(run))
    .filter((run) => normalizeSearchText(run.text).length > 0);

  if (sourceRuns.length === 0) {
    return null;
  }

  const textRuns = materializeCitationTextRuns(sourceRuns);
  const text = textRuns.map((run) => run.text).join('');
  const normalizedText = normalizeSearchText(text);
  if (!normalizedText) {
    return null;
  }

  const evidenceId = createEvidenceId(input.pageNumber, input.kind, input.recordIndex, normalizedText);
  return {
    evidenceId,
    pageNumber: input.pageNumber,
    kind: input.kind,
    text,
    normalizedText,
    bounds: cloneBounds(input.bounds),
    textRuns
  };
}

function flattenRowSpans(row: HtmlTableRow): HtmlTextSpan[] {
  return row.cells.flatMap((cell) => cell.spans ?? []);
}

function matchSpanToSourceRun(span: HtmlTextSpan, candidates: TextRunCandidate[]): SourceTextRun | null {
  const exact = candidates.find((candidate) => !candidate.used && isExactSpanMatch(span, candidate.run));
  if (exact) {
    exact.used = true;
    return cloneSourceRun(exact.run);
  }

  const overlapping = candidates.find((candidate) => !candidate.used && isCompatibleSpanMatch(span, candidate.run));
  if (overlapping) {
    overlapping.used = true;
    return cloneSourceRun(overlapping.run);
  }

  if (!span.text.trim()) {
    return null;
  }

  return {
    text: span.text,
    bounds: cloneBounds(span.bounds)
  };
}

function materializeCitationTextRuns(sourceRuns: SourceTextRun[]): DocumentCitationTextRun[] {
  const textRuns: DocumentCitationTextRun[] = [];
  let assembledText = '';

  for (let index = 0; index < sourceRuns.length; index += 1) {
    const run = sourceRuns[index]!;
    if (textRuns.length > 0 && shouldInsertSpaceBetweenRuns(textRuns[textRuns.length - 1]!, run, assembledText)) {
      assembledText += ' ';
    }

    const start = assembledText.length;
    assembledText += run.text;
    textRuns.push({
      text: run.text,
      bounds: cloneBounds(run.bounds),
      start,
      end: assembledText.length,
      ...(run.baselineStart ? { baselineStart: { ...run.baselineStart } } : {}),
      ...(run.baselineEnd ? { baselineEnd: { ...run.baselineEnd } } : {}),
      ...(run.glyphSpans ? { glyphSpans: run.glyphSpans.map(cloneGlyphSpan) } : {})
    });
  }

  return textRuns;
}

function shouldInsertSpaceBetweenRuns(
  previous: DocumentCitationTextRun,
  current: SourceTextRun,
  assembledText: string
): boolean {
  if (/\s$/.test(assembledText) || /^\s/.test(current.text)) {
    return false;
  }

  const previousHeight = Math.max(previous.bounds.maxY - previous.bounds.minY, 1);
  const currentHeight = Math.max(current.bounds.maxY - current.bounds.minY, 1);
  const gapX = current.bounds.minX - previous.bounds.maxX;
  const baselineShift = Math.abs(current.bounds.maxY - previous.bounds.maxY);
  const lineBreakThreshold = Math.max(previousHeight, currentHeight) * 0.45;

  if (baselineShift > lineBreakThreshold) {
    return true;
  }

  return gapX >= Math.max(previousHeight * 0.25, 0.5);
}

function createEvidenceId(
  pageNumber: number,
  kind: DocumentEvidenceRecord['kind'],
  recordIndex: number,
  normalizedText: string
): string {
  const hash = createHash('sha1').update(`${pageNumber}:${kind}:${normalizedText}`).digest('hex').slice(0, 8);
  return `p${pageNumber}-${kind}-${recordIndex}-${hash}`;
}

function isExactSpanMatch(span: HtmlTextSpan, run: SourceTextRun): boolean {
  return span.text === run.text && areBoundsClose(span.bounds, run.bounds, BOUNDS_TOLERANCE);
}

function isCompatibleSpanMatch(span: HtmlTextSpan, run: SourceTextRun): boolean {
  if (normalizeSearchText(span.text) !== normalizeSearchText(run.text)) {
    return false;
  }
  return boundsOverlap(span.bounds, run.bounds) || areBoundsClose(span.bounds, run.bounds, BOUNDS_TOLERANCE * 2);
}

function boundsOverlap(left: PDFImageBounds, right: PDFImageBounds): boolean {
  return !(
    left.maxX < right.minX ||
    left.minX > right.maxX ||
    left.maxY < right.minY ||
    left.minY > right.maxY
  );
}

function areBoundsClose(left: PDFImageBounds, right: PDFImageBounds, tolerance: number): boolean {
  return (
    Math.abs(left.minX - right.minX) <= tolerance &&
    Math.abs(left.minY - right.minY) <= tolerance &&
    Math.abs(left.maxX - right.maxX) <= tolerance &&
    Math.abs(left.maxY - right.maxY) <= tolerance
  );
}

function cloneGlyphSpan(span: PDFGlyphSpan): PDFGlyphSpan {
  return { ...span };
}

function cloneBounds(bounds: PDFImageBounds): PDFImageBounds {
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY
  };
}

function cloneSourceRun(run: SourceTextRun): SourceTextRun {
  return {
    text: run.text,
    bounds: cloneBounds(run.bounds),
    ...(run.baselineStart ? { baselineStart: { ...run.baselineStart } } : {}),
    ...(run.baselineEnd ? { baselineEnd: { ...run.baselineEnd } } : {}),
    ...(run.glyphSpans ? { glyphSpans: run.glyphSpans.map(cloneGlyphSpan) } : {})
  };
}

export function normalizeSearchText(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}
