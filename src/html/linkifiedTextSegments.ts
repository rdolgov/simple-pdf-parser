export type LinkifiedTextSegment =
  | { type: 'text'; content: string }
  | { type: 'url'; content: string; href: string };

const URL_START_PATTERN = /https?:\/\/|www\./gi;
const URL_SOFT_SEPARATORS = new Set(['˜', '∼']);
const URL_HARD_STOP_CHARS = new Set(['<', '>', '"', "'", '`', '|']);
const URL_TRAILING_PUNCTUATION = new Set([',', '.', ';', ':', '!', '?', ')', ']', '}']);
const URL_CONTINUATION_HINT_PATTERN = /[./?%#=&_-]/;

export function buildLinkifiedTextFromLines(
  lines: Array<{ text: string }>,
  defaultSeparator = '\n'
): string {
  if (lines.length === 0) {
    return '';
  }

  let result = lines[0].text.trimEnd();
  for (let index = 1; index < lines.length; index += 1) {
    const previousLine = lines[index - 1].text.trimEnd();
    const currentLine = lines[index].text.trimEnd();
    result += shouldMergeWrappedUrlLine(previousLine, currentLine) ? '' : defaultSeparator;
    result += currentLine;
  }

  return result;
}

export function parseLinkifiedTextSegments(text: string): LinkifiedTextSegment[] {
  if (!text) {
    return [];
  }

  const segments: LinkifiedTextSegment[] = [];
  let index = 0;

  while (index < text.length) {
    const urlStart = findNextUrlStart(text, index);
    if (urlStart === undefined) {
      pushTextSegment(segments, text.slice(index));
      break;
    }

    if (urlStart > index) {
      pushTextSegment(segments, text.slice(index, urlStart));
    }

    ensureDisplaySpaceBeforeUrl(segments, text, urlStart);
    const urlSegment = extractUrlSegment(text, urlStart);
    if (urlSegment) {
      segments.push(urlSegment.segment);
      index = urlSegment.end;
      continue;
    }

    pushTextSegment(segments, text[index]);
    index += 1;
  }

  return segments;
}

function shouldMergeWrappedUrlLine(previousLine: string, currentLine: string): boolean {
  const previousUrlMatch = previousLine.match(/(?:https?:\/\/|www\.)\S*$/i);
  if (!previousUrlMatch) {
    return false;
  }

  const nextToken = currentLine.trimStart().match(/^\S+/)?.[0] ?? '';
  if (!nextToken) {
    return false;
  }

  return nextToken.startsWith('/') || URL_CONTINUATION_HINT_PATTERN.test(nextToken);
}

function pushTextSegment(segments: LinkifiedTextSegment[], value: string): void {
  if (!value) {
    return;
  }

  const previous = segments[segments.length - 1];
  if (previous?.type === 'text') {
    previous.content += value;
    return;
  }

  segments.push({ type: 'text', content: value });
}

function findNextUrlStart(text: string, fromIndex: number): number | undefined {
  URL_START_PATTERN.lastIndex = fromIndex;
  const match = URL_START_PATTERN.exec(text);
  return match ? match.index : undefined;
}

function extractUrlSegment(
  text: string,
  start: number
): { segment: Extract<LinkifiedTextSegment, { type: 'url' }>; end: number } | undefined {
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
      if (previousChar === '/' || nextChar === '/' || URL_CONTINUATION_HINT_PATTERN.test(nextChar)) {
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

function ensureDisplaySpaceBeforeUrl(segments: LinkifiedTextSegment[], text: string, urlStart: number): void {
  if (urlStart <= 0 || /\s/.test(text[urlStart - 1]) || !/[A-Za-z0-9]/.test(text[urlStart - 1])) {
    return;
  }

  const previous = segments[segments.length - 1];
  if (previous?.type === 'text' && !previous.content.endsWith(' ')) {
    previous.content += ' ';
  }
}
