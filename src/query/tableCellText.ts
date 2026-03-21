const MAX_NORMALIZE_DEPTH = 4;

export function normalizeParsedTableRows(value: unknown): string[][] {
  if (!Array.isArray(value)) {
    return [];
  }

  const rows: string[][] = [];
  for (const row of value) {
    if (!Array.isArray(row)) {
      continue;
    }
    rows.push(row.map((cell) => normalizeTableCellText(cell)));
  }
  return rows.filter((row) => row.length > 0);
}

export function normalizeTableCellText(value: unknown, depth = 0): string {
  if (depth > MAX_NORMALIZE_DEPTH || value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeTableCellText(item, depth + 1))
      .filter((item) => item.length > 0)
      .join(' ')
      .trim();
  }

  if (typeof value !== 'object') {
    return '';
  }

  for (const key of ['text', 'content', 'value', 'label', 'title', 'name', 'displayText'] as const) {
    if (key in value) {
      const normalized = normalizeTableCellText((value as Record<string, unknown>)[key], depth + 1);
      if (normalized.length > 0) {
        return normalized;
      }
    }
  }

  for (const key of ['texts', 'segments', 'runs', 'parts', 'items', 'children', 'values'] as const) {
    if (key in value) {
      const normalized = normalizeTableCellText((value as Record<string, unknown>)[key], depth + 1);
      if (normalized.length > 0) {
        return normalized;
      }
    }
  }

  const flattenedValues = Object.values(value as Record<string, unknown>)
    .map((item) => normalizeTableCellText(item, depth + 1))
    .filter((item) => item.length > 0);
  if (flattenedValues.length > 0) {
    return flattenedValues.join(' ').trim();
  }

  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}
