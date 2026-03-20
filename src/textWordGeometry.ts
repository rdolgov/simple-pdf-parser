import type { PDFImageBounds, PDFTextItem } from './types.js';
import { computeTextItemSubstringBounds } from './textItemSubstringBounds.js';

export interface PDFTextWord {
  text: string;
  normalizedText: string;
  start: number;
  end: number;
  bounds: PDFImageBounds;
}

export function extractTextItemWords(item: PDFTextItem): PDFTextWord[] {
  const characters = Array.from(item.text);
  if (characters.length === 0) {
    return [];
  }

  const words: PDFTextWord[] = [];
  let wordStart = -1;

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index] ?? '';
    if (/\s/u.test(character)) {
      if (wordStart !== -1) {
        pushWord(words, item, characters, wordStart, index);
        wordStart = -1;
      }
      continue;
    }

    if (wordStart === -1) {
      wordStart = index;
    }
  }

  if (wordStart !== -1) {
    pushWord(words, item, characters, wordStart, characters.length);
  }

  return words;
}

export function normalizeSearchText(text: string): string {
  return text.toLocaleLowerCase().trim();
}

function pushWord(
  words: PDFTextWord[],
  item: PDFTextItem,
  characters: string[],
  start: number,
  end: number
): void {
  const text = characters.slice(start, end).join('');
  const bounds = computeTextItemSubstringBounds(item, start, end);
  if (!bounds) {
    return;
  }

  words.push({
    text,
    normalizedText: stripBoundaryPunctuation(normalizeSearchText(text)),
    start,
    end,
    bounds
  });
}

function stripBoundaryPunctuation(text: string): string {
  const stripped = text.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
  return stripped || text;
}
