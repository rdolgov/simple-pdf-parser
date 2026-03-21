export function extractJsonObjectCandidate(input: string): string {
  const trimmed = input.trim();
  const start = trimmed.indexOf('{');
  if (start < 0) {
    return trimmed;
  }

  let inString: '"' | '\'' | null = null;
  let escapeNext = false;
  let inLineComment = false;
  let inBlockComment = false;
  const expectedClosers: string[] = [];
  let endIndex = -1;

  for (let index = start; index < trimmed.length; index += 1) {
    const current = trimmed[index];
    const next = trimmed[index + 1];

    if (inLineComment) {
      if (current === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (current === '\\') {
        escapeNext = true;
        continue;
      }
      if (current === inString) {
        inString = null;
      }
      continue;
    }

    if (current === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (current === '"' || current === '\'') {
      inString = current;
      continue;
    }
    if (current === '{') {
      expectedClosers.push('}');
      continue;
    }
    if (current === '[') {
      expectedClosers.push(']');
      continue;
    }
    if (current === '}' || current === ']') {
      if (expectedClosers[expectedClosers.length - 1] === current) {
        expectedClosers.pop();
        if (expectedClosers.length === 0) {
          endIndex = index + 1;
          break;
        }
      }
    }
  }

  let candidate = trimmed.slice(start, endIndex > 0 ? endIndex : trimmed.length).trimEnd();
  if (inString) {
    candidate += inString;
  }
  if (expectedClosers.length > 0) {
    candidate += expectedClosers.slice().reverse().join('');
  }
  return candidate;
}
