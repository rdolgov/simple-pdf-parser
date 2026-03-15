export type PopupTextSegment =
  | { type: 'text'; content: string }
  | { type: 'citation'; content: string; numbers: string[] }
  | { type: 'url'; content: string; href: string };

const CITATION_PATTERN = /\[(\d+(?:\s*[-,]\s*\d+)*)\]/g;
const URL_START_PATTERN = /https?:\/\/|www\./gi;
const URL_SOFT_SEPARATORS = new Set(['˜', '∼']);
const URL_HARD_STOP_CHARS = new Set(['<', '>', '"', "'", '`', '|']);
const URL_TRAILING_PUNCTUATION = new Set([',', '.', ';', ':', '!', '?', ')', ']', '}']);

export function parsePopupTextSegments(text: string): PopupTextSegment[] {
  if (!text) {
    return [];
  }

  const segments: PopupTextSegment[] = [];
  let index = 0;

  while (index < text.length) {
    const citationMatch = findNextCitation(text, index);
    const urlStart = findNextUrlStart(text, index);
    const nextStart = chooseEarlierStart(citationMatch?.index, urlStart);

    if (nextStart === undefined) {
      pushTextSegment(segments, text.slice(index));
      break;
    }

    if (nextStart > index) {
      pushTextSegment(segments, text.slice(index, nextStart));
    }

    if (citationMatch && citationMatch.index === nextStart) {
      segments.push({
        type: 'citation',
        content: citationMatch.content,
        numbers: citationMatch.numbers
      });
      index = citationMatch.end;
      continue;
    }

    if (urlStart === nextStart) {
      ensureDisplaySpaceBeforeUrl(segments, text, urlStart);
      const urlSegment = extractUrlSegment(text, urlStart);
      if (urlSegment) {
        segments.push(urlSegment.segment);
        index = urlSegment.end;
        continue;
      }
    }

    pushTextSegment(segments, text[index]);
    index += 1;
  }

  return segments;
}

function pushTextSegment(segments: PopupTextSegment[], value: string): void {
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

function chooseEarlierStart(
  citationStart: number | undefined,
  urlStart: number | undefined
): number | undefined {
  if (citationStart === undefined) {
    return urlStart;
  }
  if (urlStart === undefined) {
    return citationStart;
  }
  return Math.min(citationStart, urlStart);
}

function findNextCitation(
  text: string,
  fromIndex: number
): { index: number; end: number; content: string; numbers: string[] } | undefined {
  CITATION_PATTERN.lastIndex = fromIndex;
  const match = CITATION_PATTERN.exec(text);
  if (!match || match.index < fromIndex) {
    return undefined;
  }

  return {
    index: match.index,
    end: match.index + match[0].length,
    content: match[0],
    numbers: parseCitationNumbers(match[1] ?? '')
  };
}

function parseCitationNumbers(numbersStr: string): string[] {
  return numbersStr.split(/\s*,\s*/).flatMap((part) => {
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!rangeMatch) {
      return [part.trim()];
    }

    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    const range: string[] = [];
    for (let value = start; value <= end; value += 1) {
      range.push(String(value));
    }
    return range;
  });
}

function findNextUrlStart(text: string, fromIndex: number): number | undefined {
  URL_START_PATTERN.lastIndex = fromIndex;
  const match = URL_START_PATTERN.exec(text);
  return match ? match.index : undefined;
}

function extractUrlSegment(
  text: string,
  start: number
): { segment: Extract<PopupTextSegment, { type: 'url' }>; end: number } | undefined {
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
      if (previousChar === '/') {
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
    segment: {
      type: 'url',
      content,
      href: content.startsWith('www.') ? `https://${content}` : content
    },
    end: trimmedEnd
  };
}

function isHostContinuationAfterProtocol(text: string, start: number, candidateStart: number): boolean {
  return (
    (text.startsWith('http://', start) && candidateStart === start + 'http://'.length && text.startsWith('www.', candidateStart)) ||
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

function ensureDisplaySpaceBeforeUrl(segments: PopupTextSegment[], text: string, urlStart: number): void {
  if (urlStart <= 0 || /\s/.test(text[urlStart - 1]) || !/[A-Za-z0-9]/.test(text[urlStart - 1])) {
    return;
  }

  const previous = segments[segments.length - 1];
  if (previous?.type === 'text' && !previous.content.endsWith(' ')) {
    previous.content += ' ';
  }
}
