import type {
  BlockRelevanceAnnotation,
  MatchRange,
  RelevanceQueryInput,
  RelevanceResponse,
  RelevanceService
} from './relevanceTypes.js';

export class MockRelevanceService implements RelevanceService {
  async analyze(input: RelevanceQueryInput): Promise<RelevanceResponse> {
    const annotations: BlockRelevanceAnnotation[] = [];
    const keyword = input.query.trim();
    const regex = keyword.length > 0 ? new RegExp(escapeRegExp(keyword), 'gi') : null;

    for (const page of input.document.pages) {
      page.content.forEach((block, index) => {
        const text = extractBlockText(block);
        const exactMatchRanges = regex ? collectMatchRanges(text, regex) : [];
        const contextualRanges =
          regex && exactMatchRanges.length > 0 ? collectContextualRanges(text, regex, { wordRadius: 20 }) : [];
        const snippetRange = contextualRanges[0] ?? exactMatchRanges[0];
        const summary = snippetRange ? buildContextSnippet(text, snippetRange) : undefined;
        const isMatch = exactMatchRanges.length > 0;
        annotations.push({
          pageNumber: page.number,
          blockIndex: index,
          state: isMatch ? 'highlight' : contextualRanges.length > 0 ? 'dim' : 'hidden',
          confidence: isMatch ? 0.95 : contextualRanges.length > 0 ? 0.4 : 0,
          rationale: isMatch ? `Matched "${keyword}"` : contextualRanges.length > 0 ? 'Context window' : undefined,
          summary: summary ?? (isMatch ? truncate(text, 200) : undefined),
          matchRanges: isMatch ? exactMatchRanges : []
        });
      });
    }

    if (!annotations.some((annotation) => annotation.state === 'highlight')) {
      annotations.slice(0, 3).forEach((annotation) => {
        annotation.state = 'dim';
        annotation.confidence = 0.25;
      });
    }

    return {
      annotations,
      model: 'mock-relevance-service',
      createdAt: new Date().toISOString(),
      querySummary: `Mocked response for query "${input.query}"`
    };
  }
}

function extractBlockText(block: { text?: string; lines?: Array<{ text: string }>; type: string }): string {
  if (typeof block.text === 'string' && block.text.length > 0) {
    return block.text;
  }
  if (Array.isArray(block.lines)) {
    return block.lines.map((line) => line.text).filter(Boolean).join(' ');
  }
  return block.type;
}

function collectMatchRanges(text: string, pattern: RegExp): MatchRange[] {
  return collectRanges(text, pattern, (match) => ({ start: match.index, end: match.index + match[0].length }));
}

function collectContextualRanges(
  text: string,
  pattern: RegExp,
  options: { wordRadius: number }
): MatchRange[] {
  const { wordRadius } = options;
  const ranges = collectRanges(text, pattern, (match) => ({ start: match.index, end: match.index + match[0].length }));
  if (ranges.length === 0) {
    return [];
  }

  const words = splitIntoWords(text);
  const wordBoundaries = buildWordBoundaries(words, text);
  return ranges.map(({ start, end }) => {
    const startWord = findWordIndex(wordBoundaries, start);
    const endWord = findWordIndex(wordBoundaries, end);
    const lower = Math.max(0, startWord - wordRadius);
    const upper = Math.min(words.length - 1, endWord + wordRadius);
    const startOffset = wordBoundaries[lower]?.start ?? start;
    const endOffset = wordBoundaries[upper]?.end ?? end;
    return { start: startOffset, end: endOffset };
  });
}

function collectRanges(
  text: string,
  pattern: RegExp,
  project: (match: RegExpExecArray) => MatchRange
): MatchRange[] {
  const ranges: MatchRange[] = [];
  const clone = new RegExp(pattern.source, pattern.flags);
  let match: RegExpExecArray | null;
  while ((match = clone.exec(text)) !== null) {
    ranges.push(project(match));
    if (clone.lastIndex === match.index) {
      clone.lastIndex += 1;
    }
  }
  return ranges;
}

interface WordBoundary {
  start: number;
  end: number;
}

function splitIntoWords(text: string): string[] {
  return text
    .split(/(\s+)/)
    .filter((token) => token.trim().length > 0);
}

function buildWordBoundaries(words: string[], original: string): WordBoundary[] {
  const boundaries: WordBoundary[] = [];
  let cursor = 0;
  const textLength = original.length;

  for (const word of words) {
    const start = original.indexOf(word, cursor);
    if (start === -1) {
      continue;
    }
    const end = start + word.length;
    boundaries.push({ start, end: Math.min(end, textLength) });
    cursor = end;
  }

  return boundaries;
}

function findWordIndex(boundaries: WordBoundary[], offset: number): number {
  for (let i = 0; i < boundaries.length; i += 1) {
    const boundary = boundaries[i];
    if (offset >= boundary.start && offset <= boundary.end) {
      return i;
    }
  }
  return boundaries.length - 1;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function buildContextSnippet(text: string, range: MatchRange): string {
  const start = clamp(range.start, 0, text.length);
  const end = clamp(range.end, start, text.length);
  const snippet = collapseWhitespace(text.slice(start, end));
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${snippet}${suffix}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
