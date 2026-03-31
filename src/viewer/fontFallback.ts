const KATEX_MATH_FALLBACK_STACK =
  "'KaTeX_Math', 'KaTeX_Main', math, 'Cambria Math', 'STIX Two Math', 'STIXGeneral', 'Latin Modern Math', 'Times New Roman', serif";
const KATEX_DELIMITER_FALLBACK_STACK =
  "'KaTeX_Size4', 'KaTeX_Size3', 'KaTeX_Size2', 'KaTeX_Size1', 'KaTeX_Math', 'KaTeX_Main', math, 'Cambria Math', 'STIX Two Math', 'STIXGeneral', 'Latin Modern Math', 'Times New Roman', serif";
const SERIF_FALLBACK_STACK = "'KaTeX_Main', 'Times New Roman', Georgia, serif";
const SANS_FALLBACK_STACK = "'KaTeX_SansSerif', Arial, Helvetica, sans-serif";
const MONOSPACE_FALLBACK_STACK = "'KaTeX_Typewriter', 'Courier New', Monaco, monospace";
const SYMBOL_FALLBACK_STACK =
  "'Apple Symbols', 'Segoe UI Symbol', 'Noto Sans Symbols', 'Noto Sans Symbols 2', 'Symbol', sans-serif";

export function resolveCanvasFontFallback(fontName: string | undefined, fallback: string): string {
  const fallbackFamily = fallback.replace(/^\d+(?:\.\d+)?px\s*/, '').trim();
  if (!fontName) {
    return fallbackFamily;
  }

  const normalized = fontName.toLowerCase();

  if (/^cmex/.test(normalized)) {
    return `${KATEX_DELIMITER_FALLBACK_STACK}, ${fallbackFamily}`;
  }

  if (/^cm(?:ex|sy|mi|bsy|mmi|mib)/.test(normalized)) {
    return `${KATEX_MATH_FALLBACK_STACK}, ${fallbackFamily}`;
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

  if (
    /cambria|times|georgia|garamond|palatino|bookman|baskerville|bodoni|didot|constantia|minion|serif/.test(
      normalized
    )
  ) {
    return `${SERIF_FALLBACK_STACK}, ${fallbackFamily}`;
  }

  if (/arial|helvetica|calibri|verdana|tahoma|sans/.test(normalized)) {
    return `${SANS_FALLBACK_STACK}, ${fallbackFamily}`;
  }

  if (/courier|consolas|menlo|monaco|mono/.test(normalized)) {
    return `${MONOSPACE_FALLBACK_STACK}, ${fallbackFamily}`;
  }

  if (/symbol|dingbat|emoji|icons?/.test(normalized)) {
    return `${SYMBOL_FALLBACK_STACK}, ${fallbackFamily}`;
  }

  return fallbackFamily;
}
