import { computeTextItemSubstringBounds, type PDFImageBounds } from '../../src/index.js';
import type {
  DocumentCitationAnchor,
  DocumentCitationMatchStrategy,
  DocumentCitationTextRun
} from '../../src/query/documentCitationTypes.js';
import type { DocumentEvidenceRecord } from './documentEvidenceIndex.js';

export interface EvidenceQuoteMatch {
  quote: string;
  start: number;
  end: number;
  matchStrategy: Exclude<DocumentCitationMatchStrategy, 'block-fallback'>;
}

interface NormalizedTextMap {
  text: string;
  originalStarts: number[];
  originalEnds: number[];
}

export function locateEvidenceQuote(
  record: Pick<DocumentEvidenceRecord, 'text' | 'normalizedText'>,
  quote: string
): EvidenceQuoteMatch | null {
  const trimmedQuote = quote.trim();
  if (!trimmedQuote) {
    return null;
  }

  const exactIndex = record.text.indexOf(trimmedQuote);
  if (exactIndex >= 0) {
    return {
      quote: trimmedQuote,
      start: exactIndex,
      end: exactIndex + trimmedQuote.length,
      matchStrategy: 'exact-quote'
    };
  }

  const evidenceMap = buildNormalizedTextMap(record.text);
  const quoteMap = buildNormalizedTextMap(trimmedQuote);
  if (!evidenceMap.text || !quoteMap.text) {
    return null;
  }

  const normalizedIndex = evidenceMap.text.indexOf(quoteMap.text);
  if (normalizedIndex < 0) {
    return null;
  }

  const normalizedEnd = normalizedIndex + quoteMap.text.length - 1;
  const start = evidenceMap.originalStarts[normalizedIndex];
  const end = evidenceMap.originalEnds[normalizedEnd];
  if (start === undefined || end === undefined || end <= start) {
    return null;
  }

  return {
    quote: record.text.slice(start, end),
    start,
    end,
    matchStrategy: 'normalized-quote'
  };
}

export function resolveDocumentCitationAnchor(
  documentId: string,
  record: Pick<DocumentEvidenceRecord, 'pageNumber' | 'bounds' | 'evidenceId' | 'textRuns'>,
  match: EvidenceQuoteMatch | null,
  requestedQuote: string
): DocumentCitationAnchor {
  if (!match) {
    return {
      documentId,
      pageNumber: record.pageNumber,
      quote: requestedQuote.trim(),
      bounds: cloneBounds(record.bounds),
      evidenceId: record.evidenceId,
      matchStrategy: 'block-fallback'
    };
  }

  const bounds = resolveBoundsFromQuoteRange(record.textRuns, match.start, match.end) ?? cloneBounds(record.bounds);
  return {
    documentId,
    pageNumber: record.pageNumber,
    quote: match.quote,
    bounds,
    evidenceId: record.evidenceId,
    matchStrategy: match.matchStrategy
  };
}

function resolveBoundsFromQuoteRange(
  textRuns: DocumentCitationTextRun[],
  start: number,
  end: number
): PDFImageBounds | null {
  const boundsList: PDFImageBounds[] = [];

  for (const run of textRuns) {
    if (run.end <= start || run.start >= end) {
      continue;
    }
    const localStart = Math.max(start, run.start) - run.start;
    const localEnd = Math.min(end, run.end) - run.start;
    if (localEnd <= localStart) {
      continue;
    }

    const bounds = computeTextItemSubstringBounds(run as never, localStart, localEnd) ?? sliceRunBounds(run, localStart, localEnd);
    if (bounds) {
      boundsList.push(bounds);
    }
  }

  if (boundsList.length === 0) {
    return null;
  }

  return mergeBounds(boundsList);
}

function sliceRunBounds(
  run: DocumentCitationTextRun,
  start: number,
  end: number
): PDFImageBounds | null {
  const totalChars = Array.from(run.text).length;
  if (totalChars <= 0) {
    return null;
  }

  const width = run.bounds.maxX - run.bounds.minX;
  const startRatio = start / totalChars;
  const endRatio = end / totalChars;
  return {
    minX: run.bounds.minX + width * startRatio,
    maxX: run.bounds.minX + width * endRatio,
    minY: run.bounds.minY,
    maxY: run.bounds.maxY
  };
}

function buildNormalizedTextMap(text: string): NormalizedTextMap {
  let normalized = '';
  const originalStarts: number[] = [];
  const originalEnds: number[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const raw = text[index]!;
    const normalizedChar = normalizeCharacter(raw);
    if (!normalizedChar) {
      continue;
    }

    if (normalizedChar === ' ') {
      if (normalized.endsWith(' ')) {
        originalEnds[originalEnds.length - 1] = index + 1;
        continue;
      }
      normalized += ' ';
      originalStarts.push(index);
      originalEnds.push(index + 1);
      continue;
    }

    normalized += normalizedChar;
    originalStarts.push(index);
    originalEnds.push(index + 1);
  }

  return {
    text: normalized.trim(),
    originalStarts: trimMapping(normalized, originalStarts),
    originalEnds: trimMapping(normalized, originalEnds, true)
  };
}

function trimMapping(value: string, mapping: number[], useEnd = false): number[] {
  const leadingTrim = value.length - value.trimStart().length;
  const trailingTrim = value.length - value.trimEnd().length;
  const start = leadingTrim;
  const end = mapping.length - trailingTrim;
  const trimmed = mapping.slice(start, end);
  if (!useEnd) {
    return trimmed;
  }
  return trimmed;
}

function normalizeCharacter(value: string): string {
  if (/\s/.test(value)) {
    return ' ';
  }
  if (value === '\u2018' || value === '\u2019') {
    return "'";
  }
  if (value === '\u201C' || value === '\u201D') {
    return '"';
  }
  if (value === '\u2013' || value === '\u2014') {
    return '-';
  }
  return value.toLocaleLowerCase();
}

function mergeBounds(boundsList: PDFImageBounds[]): PDFImageBounds {
  return boundsList.reduce(
    (acc, bounds) => ({
      minX: Math.min(acc.minX, bounds.minX),
      minY: Math.min(acc.minY, bounds.minY),
      maxX: Math.max(acc.maxX, bounds.maxX),
      maxY: Math.max(acc.maxY, bounds.maxY)
    }),
    cloneBounds(boundsList[0]!)
  );
}

function cloneBounds(bounds: PDFImageBounds): PDFImageBounds {
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY
  };
}
