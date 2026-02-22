import * as XLSX from 'xlsx';

export interface ParsedTable {
  name: string;
  rows: string[][];
}

/**
 * Parse a map of XLSX buffers into parsed table rows.
 */
export async function parseXlsxTables(tableAssets: Record<string, ArrayBuffer>): Promise<ParsedTable[]> {
  const tables: ParsedTable[] = [];
  for (const [name, buffer] of Object.entries(tableAssets)) {
    try {
      const rows = parseSingle(buffer);
      tables.push({ name, rows });
    } catch (error) {
      // Keep parsing resilient: skip problematic files.
      // eslint-disable-next-line no-console
      console.warn(`Failed to parse XLSX table ${name}`, error);
    }
  }
  return tables;
}

function parseSingle(buffer: ArrayBuffer): string[][] {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return [];
  }
  const sheet = workbook.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[];
  return (json as string[][]).map((row) => row.map((cell) => (cell ?? '').toString()));
}
