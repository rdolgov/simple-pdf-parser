const MONTH_YEAR_CELL_PATTERN = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{4}$/i;
const NUMERIC_TABLE_CELL_PATTERN = /^[([]?-?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?%?\)?$/;

export function looksLikeTableCellToken(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }

  const normalized = trimmed.replace(/\u2212/g, '-');
  return MONTH_YEAR_CELL_PATTERN.test(trimmed) || NUMERIC_TABLE_CELL_PATTERN.test(normalized);
}
