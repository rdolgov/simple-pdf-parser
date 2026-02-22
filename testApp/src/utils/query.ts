import type { AnnotatedHtmlDocumentLayout, MatchRange } from 'pdf-layout-parser';
import type { WordBoundary } from '../types';

export function extractBlockText(block: { text?: string; lines?: Array<{ text: string }>; type: string }): string {
  if (typeof block.text === 'string' && block.text.length > 0) {
    return block.text;
  }
  if (Array.isArray(block.lines) && block.lines.length > 0) {
    return block.lines.map((line) => line.text).filter(Boolean).join(' ');
  }
  return block.type;
}

export function applyFocusQueryContext(layout: AnnotatedHtmlDocumentLayout, query: string): void {
  const pattern = buildQueryRegex(query);
  if (!pattern) {
    return;
  }
  for (const page of layout.pages) {
    page.content.forEach((block) => {
      const relevance = block.relevance;
      if (!relevance || relevance.state !== 'highlight') {
        return;
      }
      const text = extractBlockText(block);
      if (!text) {
        return;
      }
      const matchRanges = collectLiteralMatchRanges(text, pattern);
      if (matchRanges.length === 0) {
        return;
      }
      const contextRange = expandRangeWithWordRadius(text, matchRanges[0], 20);
      const snippet = buildSnippetFromRange(text, contextRange);
      block.relevance = {
        ...relevance,
        matchRanges,
        summary: snippet
      };
    });
  }
}

export function buildQueryRegex(query: string): RegExp | null {
  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }
  return new RegExp(escapeRegExp(trimmed), 'gi');
}

export function collectLiteralMatchRanges(text: string, pattern: RegExp): MatchRange[] {
  const ranges: MatchRange[] = [];
  const clone = new RegExp(pattern.source, pattern.flags);
  let match: RegExpExecArray | null;
  while ((match = clone.exec(text)) !== null) {
    if (typeof match.index === 'number') {
      ranges.push({ start: match.index, end: match.index + match[0].length });
      if (clone.lastIndex === match.index) {
        clone.lastIndex += 1;
      }
    }
  }
  return ranges;
}

export function expandRangeWithWordRadius(text: string, range: MatchRange, wordRadius: number): MatchRange {
  const boundaries = buildWordBoundaries(text);
  if (boundaries.length === 0) {
    return range;
  }
  const startWord = findWordIndex(boundaries, range.start);
  const endWord = findWordIndex(boundaries, range.end);
  const lower = Math.max(0, startWord - wordRadius);
  const upper = Math.min(boundaries.length - 1, endWord + wordRadius);
  return {
    start: boundaries[lower]?.start ?? range.start,
    end: boundaries[upper]?.end ?? range.end
  };
}

export function buildWordBoundaries(text: string): WordBoundary[] {
  const boundaries: WordBoundary[] = [];
  const wordPattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = wordPattern.exec(text)) !== null) {
    const start = match.index ?? 0;
    boundaries.push({ start, end: start + match[0].length });
  }
  return boundaries;
}

export function findWordIndex(boundaries: WordBoundary[], offset: number): number {
  if (boundaries.length === 0) {
    return 0;
  }
  for (let index = 0; index < boundaries.length; index += 1) {
    const boundary = boundaries[index];
    if (offset >= boundary.start && offset <= boundary.end) {
      return index;
    }
  }
  if (offset < boundaries[0].start) {
    return 0;
  }
  return boundaries.length - 1;
}

export function buildSnippetFromRange(text: string, range: MatchRange): string {
  const start = clamp(range.start, 0, text.length);
  const end = clamp(range.end, start, text.length);
  const snippet = collapseWhitespace(text.slice(start, end));
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${snippet}${suffix}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
