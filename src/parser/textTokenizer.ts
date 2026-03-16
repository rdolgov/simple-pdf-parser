export type OperatorToken =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'name'; value: string }
  | { type: 'command'; value: string }
  | { type: 'arrayStart' }
  | { type: 'arrayEnd' };

export function tokenize(content: string): OperatorToken[] {
  const tokens: OperatorToken[] = [];
  const length = content.length;

  for (let index = 0; index < length; index += 1) {
    const char = content[index];

    if (isWhitespace(char)) {
      continue;
    }

    if (char === '%') {
      index = consumeComment(content, index);
      continue;
    }

    if (char === '(') {
      const { value, nextIndex } = readLiteralString(content, index);
      tokens.push({ type: 'string', value });
      index = nextIndex;
      continue;
    }

    if (char === '<') {
      if (content[index + 1] === '<') {
        tokens.push({ type: 'command', value: '<<' });
        index += 1;
        continue;
      }
      const { value, nextIndex } = readHexString(content, index);
      tokens.push({ type: 'string', value });
      index = nextIndex;
      continue;
    }

    if (char === '[') {
      tokens.push({ type: 'arrayStart' });
      continue;
    }

    if (char === ']') {
      tokens.push({ type: 'arrayEnd' });
      continue;
    }

    if (char === '/') {
      const { value, nextIndex } = readName(content, index + 1);
      tokens.push({ type: 'name', value });
      index = nextIndex;
      continue;
    }

    const { value, nextIndex } = readToken(content, index);
    if (value === '') {
      index = nextIndex;
      continue;
    }

    if (isNumberToken(value)) {
      tokens.push({ type: 'number', value: Number(value) });
    } else {
      tokens.push({ type: 'command', value });
    }
    index = nextIndex;
  }

  return tokens;
}

export function readLiteralString(source: string, startIndex: number): { value: string; nextIndex: number } {
  let index = startIndex + 1;
  let nesting = 1;
  let buffer = '';

  while (index < source.length && nesting > 0) {
    const char = source[index];

    if (char === '\\') {
      const escapeResult = decodeEscapeSequence(source, index);
      buffer += escapeResult.value;
      index = escapeResult.nextIndex;
      continue;
    }

    if (char === '(') {
      nesting += 1;
      buffer += char;
      index += 1;
      continue;
    }

    if (char === ')') {
      nesting -= 1;
      if (nesting === 0) {
        index += 1;
        break;
      }
      buffer += char;
      index += 1;
      continue;
    }

    buffer += char;
    index += 1;
  }

  return { value: buffer, nextIndex: index - 1 };
}

export function readHexString(source: string, startIndex: number): { value: string; nextIndex: number } {
  let index = startIndex + 1;
  let hex = '';

  while (index < source.length) {
    const char = source[index];
    if (char === '>') {
      index += 1;
      break;
    }
    if (!isWhitespace(char)) {
      hex += char;
    }
    index += 1;
  }

  if (hex.length % 2 === 1) {
    hex += '0';
  }

  let output = '';
  for (let i = 0; i < hex.length; i += 2) {
    const byte = hex.slice(i, i + 2);
    const codePoint = Number.parseInt(byte, 16);
    if (!Number.isNaN(codePoint)) {
      output += String.fromCharCode(codePoint);
    }
  }

  return { value: output, nextIndex: index - 1 };
}

export function readName(source: string, startIndex: number): { value: string; nextIndex: number } {
  let index = startIndex;
  let buffer = '';

  while (index < source.length) {
    const char = source[index];
    if (isDelimiter(char) || isWhitespace(char)) {
      break;
    }
    buffer += char;
    index += 1;
  }

  return { value: buffer, nextIndex: index - 1 };
}

const TOKEN_SEPARATOR_REGEX = /[\s()<>\[\]{}\/%]/g;

export function readToken(source: string, startIndex: number): { value: string; nextIndex: number } {
  TOKEN_SEPARATOR_REGEX.lastIndex = startIndex;
  const match = TOKEN_SEPARATOR_REGEX.exec(source);
  if (!match) {
    return {
      value: source.slice(startIndex),
      nextIndex: source.length - 1
    };
  }

  if (match.index === startIndex) {
    return {
      value: '',
      nextIndex: startIndex
    };
  }

  return {
    value: source.slice(startIndex, match.index),
    nextIndex: match.index - 1
  };
}

export function decodeEscapeSequence(source: string, startIndex: number): { value: string; nextIndex: number } {
  const nextChar = source[startIndex + 1];

  switch (nextChar) {
    case 'n':
      return { value: '\n', nextIndex: startIndex + 2 };
    case 'r':
      return { value: '\r', nextIndex: startIndex + 2 };
    case 't':
      return { value: '\t', nextIndex: startIndex + 2 };
    case 'b':
      return { value: '\b', nextIndex: startIndex + 2 };
    case 'f':
      return { value: '\f', nextIndex: startIndex + 2 };
    case 'v':
      return { value: '\v', nextIndex: startIndex + 2 };
    case '(':
    case ')':
    case '\\':
      return { value: nextChar, nextIndex: startIndex + 2 };
    default: {
      if (isOctalDigit(nextChar)) {
        let octalDigits = nextChar;
        let index = startIndex + 2;
        for (let count = 0; count < 2 && index < source.length; count += 1, index += 1) {
          const char = source[index];
          if (isOctalDigit(char)) {
            octalDigits += char;
          } else {
            index -= 1;
            break;
          }
        }
        const codePoint = Number.parseInt(octalDigits, 8);
        return {
          value: String.fromCharCode(codePoint),
          nextIndex: startIndex + 1 + octalDigits.length
        };
      }
      return { value: nextChar ?? '', nextIndex: startIndex + 2 };
    }
  }
}

export function consumeComment(source: string, startIndex: number): number {
  let index = startIndex;
  while (index < source.length) {
    const char = source[index];
    if (char === '\r' || char === '\n') {
      break;
    }
    index += 1;
  }
  return index;
}

export const isWhitespace = (char: string): boolean => /\s/.test(char);

export const isDelimiter = (char: string): boolean => ['(', ')', '<', '>', '[', ']', '{', '}', '/', '%'].includes(char);

// Match numbers like: 123, -456, 1.5, -0.7, .34149, -.5
export const isNumberToken = (value: string): boolean => /^-?(\d+(\.\d*)?|\.\d+)$/.test(value);

export const isOctalDigit = (char: string | undefined): boolean => !!char && /^[0-7]$/.test(char);
