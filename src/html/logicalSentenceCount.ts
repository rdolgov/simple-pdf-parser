export function estimateLogicalSentenceCount(text: string): number {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 0;
  }

  const segments = normalized
    .split(/(?<=[.!?])(?:["'”’)\]]+)?\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length > 0) {
    return segments.length;
  }

  return 1;
}
