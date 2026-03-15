const MATH_FALLBACK_STACK =
  "math, 'Cambria Math', 'STIX Two Math', 'STIXGeneral', 'Latin Modern Math', 'Times New Roman', serif";
const SERIF_FALLBACK_STACK = "'Times New Roman', Georgia, serif";
const SANS_FALLBACK_STACK = "Arial, Helvetica, sans-serif";
const MONOSPACE_FALLBACK_STACK = "'Courier New', Monaco, monospace";
const SYMBOL_FALLBACK_STACK =
  "'Apple Symbols', 'Segoe UI Symbol', 'Noto Sans Symbols', 'Noto Sans Symbols 2', 'Symbol', sans-serif";

export function resolveCanvasFontFallback(fontName: string | undefined, fallback: string): string {
  const fallbackFamily = fallback.replace(/^\d+(?:\.\d+)?px\s*/, '').trim();
  if (!fontName) {
    return fallbackFamily;
  }

  const normalized = fontName.toLowerCase();

  if (/^cm(?:ex|sy|mi|bsy|mmi|mib)/.test(normalized)) {
    return `${MATH_FALLBACK_STACK}, ${fallbackFamily}`;
  }

  if (/^cmr|^cmbx|^cmti|^cmsl|^cmu/.test(normalized)) {
    return `${SERIF_FALLBACK_STACK}, ${fallbackFamily}`;
  }

  if (/^cmss/.test(normalized)) {
    return `${SANS_FALLBACK_STACK}, ${fallbackFamily}`;
  }

  if (/^cmtt/.test(normalized)) {
    return `${MONOSPACE_FALLBACK_STACK}, ${fallbackFamily}`;
  }

  if (/symbol|dingbat|emoji|icons?/.test(normalized)) {
    return `${SYMBOL_FALLBACK_STACK}, ${fallbackFamily}`;
  }

  return fallbackFamily;
}
