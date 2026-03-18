export type InterestingTextEntity =
  | {
      kind: 'url';
      content: string;
      href: string;
      source: 'pattern';
    }
  | {
      kind: 'citation';
      content: string;
      numbers: string[];
      source: 'pattern';
    };

export type InterestingTextMatch =
  | ({
      kind: 'url';
      content: string;
      href: string;
      source: 'pattern';
      start: number;
      end: number;
    })
  | ({
      kind: 'citation';
      content: string;
      numbers: string[];
      source: 'pattern';
      start: number;
      end: number;
    });

export type InterestingTextSegment =
  | { type: 'text'; content: string }
  | { type: 'entity'; entity: InterestingTextEntity };

export type InterestingTextLine = {
  text: string;
};

export type InterestingTextLineSlice = {
  text: string;
  start: number;
  end: number;
};

export type InterestingTextLayout = {
  text: string;
  lineSlices: InterestingTextLineSlice[];
  matches: InterestingTextMatch[];
};

const CITATION_PATTERN = /\[(\d+(?:\s*[-,]\s*\d+)*)\]/g;
const URL_START_PATTERN = /https?:\/\/|www\./gi;
const URL_SOFT_SEPARATORS = new Set(['˜', '∼']);
const URL_HARD_STOP_CHARS = new Set(['<', '>', '"', "'", '`', '|']);
const URL_TRAILING_PUNCTUATION = new Set([',', '.', ';', ':', '!', '?', ')', ']', '}']);
const URL_ENDING_CONTINUATION_PATTERN = /[/?%#=&_-]$/;
const URL_NEXT_TOKEN_CONTINUATION_PATTERN = /[./?%#=&_-]/;

export function buildInterestingTextLayout(
  lines: InterestingTextLine[],
  defaultSeparator = '\n'
): InterestingTextLayout {
  if (lines.length === 0) {
    return {
      text: '',
      lineSlices: [],
      matches: []
    };
  }

  const lineSlices: InterestingTextLineSlice[] = [];
  let text = '';

  for (let index = 0; index < lines.length; index += 1) {
    const previousLine = index > 0 ? lines[index - 1].text.trimEnd() : '';
    const currentLine = lines[index].text.trimEnd();

    if (index > 0 && !shouldMergeInterestingLine(previousLine, currentLine)) {
      text += defaultSeparator;
    }

    const start = text.length;
    text += currentLine;
    lineSlices.push({
      text: currentLine,
      start,
      end: text.length
    });
  }

  return {
    text,
    lineSlices,
    matches: findInterestingTextMatches(text)
  };
}

export function buildInterestingTextFromLines(
  lines: InterestingTextLine[],
  defaultSeparator = '\n'
): string {
  return buildInterestingTextLayout(lines, defaultSeparator).text;
}

export function parseInterestingTextSegments(text: string): InterestingTextSegment[] {
  if (!text) {
    return [];
  }

  const matches = findInterestingTextMatches(text);
  const segments: InterestingTextSegment[] = [];
  let index = 0;

  for (const match of matches) {
    if (match.start > index) {
      pushTextSegment(segments, text.slice(index, match.start));
    }

    if (match.kind === 'url') {
      ensureDisplaySpaceBeforeUrl(segments, text, match.start);
    }

    segments.push({
      type: 'entity',
      entity: toInterestingTextEntity(match)
    });
    index = match.end;
  }

  if (index < text.length) {
    pushTextSegment(segments, text.slice(index));
  }

  return segments;
}

export function parseInterestingTextSegmentsFromLines(
  lines: InterestingTextLine[],
  defaultSeparator = '\n'
): InterestingTextSegment[] {
  return parseInterestingTextSegments(buildInterestingTextFromLines(lines, defaultSeparator));
}

export function hasInterestingTextSegments(segments: InterestingTextSegment[]): boolean {
  return segments.some((segment) => segment.type === 'entity');
}

export function findInterestingTextMatches(text: string): InterestingTextMatch[] {
  if (!text) {
    return [];
  }

  const matches: InterestingTextMatch[] = [];
  let index = 0;

  while (index < text.length) {
    const citationMatch = findNextCitation(text, index);
    const urlMatch = findNextUrlMatch(text, index);
    const nextMatch = chooseEarlierMatch(citationMatch, urlMatch);

    if (!nextMatch) {
      break;
    }

    matches.push(nextMatch);
    index = nextMatch.end;
  }

  return matches;
}

function shouldMergeInterestingLine(previousLine: string, currentLine: string): boolean {
  const previousUrlMatch = previousLine.match(/(?:https?:\/\/|www\.)\S*$/i);
  if (!previousUrlMatch) {
    return false;
  }

  const nextToken = currentLine.trimStart().match(/^\S+/)?.[0] ?? '';
  if (!nextToken) {
    return false;
  }

  return (
    nextToken.startsWith('/') ||
    URL_NEXT_TOKEN_CONTINUATION_PATTERN.test(nextToken) ||
    URL_ENDING_CONTINUATION_PATTERN.test(previousUrlMatch[0])
  );
}

function toInterestingTextEntity(match: InterestingTextMatch): InterestingTextEntity {
  if (match.kind === 'url') {
    return {
      kind: 'url',
      content: match.content,
      href: match.href,
      source: match.source
    };
  }

  return {
    kind: 'citation',
    content: match.content,
    numbers: match.numbers,
    source: match.source
  };
}

function chooseEarlierMatch(
  citationMatch: InterestingTextMatch | undefined,
  urlMatch: InterestingTextMatch | undefined
): InterestingTextMatch | undefined {
  if (!citationMatch) {
    return urlMatch;
  }
  if (!urlMatch) {
    return citationMatch;
  }
  return citationMatch.start <= urlMatch.start ? citationMatch : urlMatch;
}

function findNextCitation(text: string, fromIndex: number): InterestingTextMatch | undefined {
  CITATION_PATTERN.lastIndex = fromIndex;
  const match = CITATION_PATTERN.exec(text);
  if (!match || match.index < fromIndex) {
    return undefined;
  }

  return {
    kind: 'citation',
    content: match[0],
    numbers: parseCitationNumbers(match[1] ?? ''),
    source: 'pattern',
    start: match.index,
    end: match.index + match[0].length
  };
}

function parseCitationNumbers(numbersStr: string): string[] {
  return numbersStr.split(/\s*,\s*/).flatMap((part) => {
    const trimmed = part.trim();
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!rangeMatch) {
      return trimmed.length > 0 ? [trimmed] : [];
    }

    const start = Number.parseInt(rangeMatch[1], 10);
    const end = Number.parseInt(rangeMatch[2], 10);
    const range: string[] = [];

    for (let value = start; value <= end; value += 1) {
      range.push(String(value));
    }

    return range;
  });
}

function findNextUrlMatch(text: string, fromIndex: number): InterestingTextMatch | undefined {
  const start = findNextUrlStart(text, fromIndex);
  if (start === undefined) {
    return undefined;
  }

  return extractUrlMatch(text, start);
}

function findNextUrlStart(text: string, fromIndex: number): number | undefined {
  URL_START_PATTERN.lastIndex = fromIndex;
  const match = URL_START_PATTERN.exec(text);
  return match ? match.index : undefined;
}

function extractUrlMatch(text: string, start: number): InterestingTextMatch | undefined {
  let end = start;

  while (end < text.length) {
    if (end > start && isUrlStartAt(text, end) && !isHostContinuationAfterProtocol(text, start, end)) {
      break;
    }

    const char = text[end];
    if (URL_SOFT_SEPARATORS.has(char) || URL_HARD_STOP_CHARS.has(char)) {
      break;
    }

    if (/\s/.test(char)) {
      const nextNonWhitespace = skipWhitespace(text, end);
      if (nextNonWhitespace >= text.length || isUrlStartAt(text, nextNonWhitespace)) {
        break;
      }

      const previousChar = end > start ? text[end - 1] : '';
      const nextChar = text[nextNonWhitespace] ?? '';
      if (previousChar === '/' || nextChar === '/' || URL_NEXT_TOKEN_CONTINUATION_PATTERN.test(nextChar)) {
        end = nextNonWhitespace;
        continue;
      }

      break;
    }

    end += 1;
  }

  const trimmedEnd = trimTrailingUrlPunctuation(text, start, end);
  if (trimmedEnd <= start) {
    return undefined;
  }

  const content = text.slice(start, trimmedEnd).replace(/\s+/g, '');
  if (!content) {
    return undefined;
  }

  return {
    kind: 'url',
    content,
    href: content.startsWith('www.') ? `https://${content}` : content,
    source: 'pattern',
    start,
    end: trimmedEnd
  };
}

function isHostContinuationAfterProtocol(text: string, start: number, candidateStart: number): boolean {
  return (
    (text.startsWith('http://', start) &&
      candidateStart === start + 'http://'.length &&
      text.startsWith('www.', candidateStart)) ||
    (text.startsWith('https://', start) &&
      candidateStart === start + 'https://'.length &&
      text.startsWith('www.', candidateStart))
  );
}

function skipWhitespace(text: string, start: number): number {
  let index = start;
  while (index < text.length && /\s/.test(text[index])) {
    index += 1;
  }
  return index;
}

function isUrlStartAt(text: string, index: number): boolean {
  return (
    text.startsWith('http://', index) ||
    text.startsWith('https://', index) ||
    text.startsWith('www.', index)
  );
}

function trimTrailingUrlPunctuation(text: string, start: number, end: number): number {
  let trimmedEnd = end;
  while (trimmedEnd > start && URL_TRAILING_PUNCTUATION.has(text[trimmedEnd - 1])) {
    trimmedEnd -= 1;
  }
  return trimmedEnd;
}

function pushTextSegment(segments: InterestingTextSegment[], value: string): void {
  const content = value.replace(/˜(?=\s*(?:https?:\/\/|www\.))/g, '');
  if (!content) {
    return;
  }

  const previous = segments[segments.length - 1];
  if (previous?.type === 'text') {
    previous.content += content;
    return;
  }

  segments.push({ type: 'text', content });
}

function ensureDisplaySpaceBeforeUrl(segments: InterestingTextSegment[], text: string, urlStart: number): void {
  if (urlStart <= 0 || /\s/.test(text[urlStart - 1]) || !/[A-Za-z0-9]/.test(text[urlStart - 1])) {
    return;
  }

  const previous = segments[segments.length - 1];
  if (previous?.type === 'text' && !previous.content.endsWith(' ')) {
    previous.content += ' ';
  }
}
