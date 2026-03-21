export function parseRelaxedJson(input: string): unknown {
  const parser = new RelaxedJsonParser(input);
  const value = parser.parseValue();
  parser.skipIgnored();
  if (!parser.isAtEnd()) {
    throw parser.error('Unexpected trailing content');
  }
  return value;
}

class RelaxedJsonParser {
  private readonly source: string;
  private index = 0;

  constructor(source: string) {
    this.source = source;
  }

  parseValue(): unknown {
    this.skipIgnored();
    const current = this.peek();
    if (!current) {
      throw this.error('Unexpected end of input');
    }

    if (current === '{') {
      return this.parseObject();
    }
    if (current === '[') {
      return this.parseArray();
    }
    if (current === '"' || current === '\'') {
      return this.parseString();
    }
    if (current === '-' || isDigit(current)) {
      return this.parseNumber();
    }
    return this.parseBareValue();
  }

  skipIgnored(): void {
    while (!this.isAtEnd()) {
      const current = this.peek();
      if (!current) {
        return;
      }
      if (isWhitespace(current)) {
        this.index += 1;
        continue;
      }
      if (current === '/' && this.peek(1) === '/') {
        this.index += 2;
        while (!this.isAtEnd()) {
          const char = this.peek();
          this.index += 1;
          if (char === '\n') {
            break;
          }
        }
        continue;
      }
      if (current === '/' && this.peek(1) === '*') {
        this.index += 2;
        while (!this.isAtEnd()) {
          if (this.peek() === '*' && this.peek(1) === '/') {
            this.index += 2;
            break;
          }
          this.index += 1;
        }
        continue;
      }
      return;
    }
  }

  isAtEnd(): boolean {
    return this.index >= this.source.length;
  }

  peek(offset = 0): string | undefined {
    return this.source[this.index + offset];
  }

  advance(count = 1): void {
    this.index += count;
  }

  error(message: string): Error {
    const before = this.source.slice(0, this.index);
    const line = before.split('\n').length;
    const column = before.length - before.lastIndexOf('\n');
    return new Error(`${message} at position ${this.index} (line ${line} column ${column})`);
  }

  private parseObject(): Record<string, unknown> {
    this.expect('{');
    const result: Record<string, unknown> = {};
    this.skipIgnored();
    if (this.peek() === '}') {
      this.index += 1;
      return result;
    }

    while (!this.isAtEnd()) {
      this.skipIgnored();
      const key = this.parseObjectKey();
      this.skipIgnored();
      this.expect(':');
      const value = this.parseValue();
      result[key] = value;
      this.skipIgnored();
      const current = this.peek();
      if (current === ',') {
        this.index += 1;
        this.skipIgnored();
        if (this.peek() === '}') {
          this.index += 1;
          return result;
        }
        continue;
      }
      if (current === '}') {
        this.index += 1;
        return result;
      }
      throw this.error('Expected "," or "}"');
    }

    throw this.error('Unterminated object');
  }

  private parseArray(): unknown[] {
    this.expect('[');
    const result: unknown[] = [];
    this.skipIgnored();
    if (this.peek() === ']') {
      this.index += 1;
      return result;
    }

    while (!this.isAtEnd()) {
      result.push(this.parseValue());
      this.skipIgnored();
      const current = this.peek();
      if (current === ',') {
        this.index += 1;
        this.skipIgnored();
        if (this.peek() === ']') {
          this.index += 1;
          return result;
        }
        continue;
      }
      if (current === ']') {
        this.index += 1;
        return result;
      }
      throw this.error('Expected "," or "]"');
    }

    throw this.error('Unterminated array');
  }

  private parseObjectKey(): string {
    this.skipIgnored();
    const current = this.peek();
    if (current === '"' || current === '\'') {
      return this.parseString();
    }
    return this.parseIdentifier();
  }

  private parseIdentifier(): string {
    const start = this.index;
    while (!this.isAtEnd()) {
      const current = this.peek();
      if (!current || !/[A-Za-z0-9_$.-]/.test(current)) {
        break;
      }
      this.index += 1;
    }
    if (this.index === start) {
      throw this.error('Expected identifier');
    }
    return this.source.slice(start, this.index);
  }

  private parseString(): string {
    const quote = this.peek();
    if (quote !== '"' && quote !== '\'') {
      throw this.error('Expected string');
    }
    this.index += 1;
    let result = '';

    while (!this.isAtEnd()) {
      const current = this.peek();
      this.index += 1;
      if (current === quote) {
        return result;
      }
      if (current === '\\') {
        const escaped = this.peek();
        if (!escaped) {
          throw this.error('Unterminated escape sequence');
        }
        this.index += 1;
        result += decodeEscape(escaped, this);
        continue;
      }
      result += current;
    }

    throw this.error('Unterminated string');
  }

  private parseNumber(): number {
    const start = this.index;
    if (this.peek() === '-') {
      this.index += 1;
    }
    while (isDigit(this.peek())) {
      this.index += 1;
    }
    if (this.peek() === '.') {
      this.index += 1;
      while (isDigit(this.peek())) {
        this.index += 1;
      }
    }
    const exponent = this.peek();
    if (exponent === 'e' || exponent === 'E') {
      this.index += 1;
      const sign = this.peek();
      if (sign === '+' || sign === '-') {
        this.index += 1;
      }
      while (isDigit(this.peek())) {
        this.index += 1;
      }
    }
    const raw = this.source.slice(start, this.index);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      throw this.error(`Invalid number "${raw}"`);
    }
    return parsed;
  }

  private parseBareValue(): unknown {
    const start = this.index;
    let parenDepth = 0;
    while (!this.isAtEnd()) {
      const current = this.peek();
      if (!current) {
        break;
      }
      if (current === '(') {
        parenDepth += 1;
        this.index += 1;
        continue;
      }
      if (current === ')') {
        if (parenDepth > 0) {
          parenDepth -= 1;
        }
        this.index += 1;
        continue;
      }
      if (parenDepth === 0 && (current === ',' || current === '}' || current === ']')) {
        break;
      }
      if (parenDepth === 0 && current === '/' && (this.peek(1) === '/' || this.peek(1) === '*')) {
        break;
      }
      this.index += 1;
    }

    const raw = this.source.slice(start, this.index).trim();
    if (!raw) {
      throw this.error('Expected value');
    }
    if (raw === 'true') {
      return true;
    }
    if (raw === 'false') {
      return false;
    }
    if (raw === 'null' || raw === 'undefined') {
      return null;
    }
    if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) {
      return Number(raw);
    }
    return raw;
  }

  private expect(value: string): void {
    this.skipIgnored();
    if (this.peek() !== value) {
      throw this.error(`Expected "${value}"`);
    }
    this.index += 1;
  }
}

function decodeEscape(char: string, parser: RelaxedJsonParser): string {
  switch (char) {
    case '"':
    case '\'':
    case '\\':
    case '/':
      return char;
    case 'b':
      return '\b';
    case 'f':
      return '\f';
    case 'n':
      return '\n';
    case 'r':
      return '\r';
    case 't':
      return '\t';
    case 'u': {
      let hex = '';
      for (let index = 0; index < 4; index += 1) {
        const next = parser.peek(index);
        if (!next || !/[0-9A-Fa-f]/.test(next)) {
          throw parser.error('Invalid unicode escape');
        }
        hex += next;
      }
      parser.advance(4);
      return String.fromCharCode(Number.parseInt(hex, 16));
    }
    default:
      return char;
  }
}

function isWhitespace(value: string | undefined): boolean {
  return value === ' ' || value === '\n' || value === '\r' || value === '\t';
}

function isDigit(value: string | undefined): boolean {
  return Boolean(value && /[0-9]/.test(value));
}
