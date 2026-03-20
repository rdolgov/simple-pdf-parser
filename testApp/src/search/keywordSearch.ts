import type { PDFDocument, PDFImageBounds } from 'pdf-layout-parser';
import {
  extractTextItemWords,
  normalizeSearchText,
  type PDFTextWord
} from 'pdf-layout-parser';

export interface KeywordSearchResult {
  id: string;
  pageNumber: number;
  bounds: PDFImageBounds;
  fragments: PDFImageBounds[];
  query: string;
  text: string;
  lineText: string;
  textItemIndex: number;
  start: number;
  end: number;
}

export interface KeywordSearchOptions {
  caseSensitive?: boolean;
}

export function keywordSearchDocument(
  document: PDFDocument,
  query: string,
  options: KeywordSearchOptions = {}
): KeywordSearchResult[] {
  const queryText = query.trim();
  const caseSensitive = options.caseSensitive ?? false;
  const queryTokens = tokenizeQuery(queryText, caseSensitive);
  if (queryTokens.length === 0) {
    return [];
  }

  const results: KeywordSearchResult[] = [];

  for (const page of document.pages) {
    for (let textItemIndex = 0; textItemIndex < page.textItems.length; textItemIndex += 1) {
      const item = page.textItems[textItemIndex]!;
      const words = extractTextItemWords(item);
      if (words.length === 0) {
        continue;
      }

      const matches = findWordMatches(words, queryTokens, caseSensitive);
      for (const match of matches) {
        const fragments = match.words.map((word) => word.bounds);
        results.push({
          id: `${page.number}:${textItemIndex}:${match.start}:${match.end}:${normalizeSearchText(queryText)}`,
          pageNumber: page.number,
          bounds: combineBounds(fragments),
          fragments,
          query: queryText,
          text: match.words.map((word) => word.text).join(' '),
          lineText: item.text,
          textItemIndex,
          start: match.start,
          end: match.end
        });
      }
    }
  }

  return results.sort((left, right) => {
    if (left.pageNumber !== right.pageNumber) {
      return left.pageNumber - right.pageNumber;
    }
    if (left.bounds.maxY !== right.bounds.maxY) {
      return right.bounds.maxY - left.bounds.maxY;
    }
    if (left.bounds.minX !== right.bounds.minX) {
      return left.bounds.minX - right.bounds.minX;
    }
    return left.id.localeCompare(right.id);
  });
}

interface QueryToken {
  raw: string;
  normalized: string;
}

interface WordMatch {
  words: PDFTextWord[];
  start: number;
  end: number;
}

function findWordMatches(words: PDFTextWord[], queryTokens: QueryToken[], caseSensitive: boolean): WordMatch[] {
  if (queryTokens.length === 0 || words.length === 0) {
    return [];
  }

  const comparableWords = words.map((word) => ({
    raw: normalizeTokenText(word.text, caseSensitive),
    normalized: stripBoundaryPunctuation(normalizeTokenText(word.text, caseSensitive))
  }));
  const matches: WordMatch[] = [];

  for (let startIndex = 0; startIndex <= words.length - queryTokens.length; startIndex += 1) {
    let didMatch = true;
    for (let offset = 0; offset < queryTokens.length; offset += 1) {
      if (!wordMatchesToken(comparableWords[startIndex + offset]!, queryTokens[offset]!)) {
        didMatch = false;
        break;
      }
    }
    if (!didMatch) {
      continue;
    }

    const matchedWords = words.slice(startIndex, startIndex + queryTokens.length);
    matches.push({
      words: matchedWords,
      start: matchedWords[0]!.start,
      end: matchedWords[matchedWords.length - 1]!.end
    });
  }

  return matches;
}

function tokenizeQuery(query: string, caseSensitive: boolean): QueryToken[] {
  return query
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => ({
      raw: normalizeTokenText(token, caseSensitive),
      normalized: stripBoundaryPunctuation(normalizeTokenText(token, caseSensitive))
    }))
    .filter((token) => token.raw || token.normalized);
}

function wordMatchesToken(
  word: { raw: string; normalized: string },
  token: { raw: string; normalized: string }
): boolean {
  if (token.normalized && word.normalized.includes(token.normalized)) {
    return true;
  }
  return Boolean(token.raw) && word.raw.includes(token.raw);
}

function combineBounds(boundsList: PDFImageBounds[]): PDFImageBounds {
  const first = boundsList[0];
  if (!first) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  return boundsList.slice(1).reduce((combined, bounds) => ({
    minX: Math.min(combined.minX, bounds.minX),
    minY: Math.min(combined.minY, bounds.minY),
    maxX: Math.max(combined.maxX, bounds.maxX),
    maxY: Math.max(combined.maxY, bounds.maxY)
  }), first);
}

function normalizeTokenText(text: string, caseSensitive: boolean): string {
  return caseSensitive ? text.trim() : normalizeSearchText(text);
}

function stripBoundaryPunctuation(text: string): string {
  const stripped = text.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
  return stripped || text;
}
