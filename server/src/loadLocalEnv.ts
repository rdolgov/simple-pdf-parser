import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_FILE_NAMES = ['.env', '.env.local'];

export function loadLocalEnvFiles(cwd = process.cwd()): void {
  const initialEnvKeys = new Set(Object.keys(process.env));
  for (const fileName of ENV_FILE_NAMES) {
    const filePath = resolve(cwd, fileName);
    if (!existsSync(filePath)) {
      continue;
    }

    const contents = readFileSync(filePath, 'utf-8');
    const entries = parseEnvFile(contents);
    for (const [key, value] of Object.entries(entries)) {
      if (initialEnvKeys.has(key)) {
        continue;
      }
      process.env[key] = value;
    }
  }
}

function parseEnvFile(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const normalizedLine = line.startsWith('export ') ? line.slice(7).trimStart() : line;
    const separatorIndex = normalizedLine.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    const rawValue = normalizedLine.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    parsed[key] = stripWrappingQuotes(stripInlineComment(rawValue));
  }
  return parsed;
}

function stripInlineComment(value: string): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (char === '#' && !inSingleQuote && !inDoubleQuote) {
      return value.slice(0, index).trimEnd();
    }
  }

  return value;
}

function stripWrappingQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}
