import type { EmbeddingProvider, StructuredExtractProvider } from 'pdf-layout-parser';

export const DEFAULT_TEXT_PROVIDER: StructuredExtractProvider = 'gemini';
export const DEFAULT_SEMANTIC_SEARCH_PROVIDER: Extract<EmbeddingProvider, 'gemini' | 'openai'> = 'gemini';

export function normalizeTextProvider(raw: string | null | undefined): StructuredExtractProvider {
  if (raw === 'openai' || raw === 'codex' || raw === 'gemini') {
    return raw;
  }
  return DEFAULT_TEXT_PROVIDER;
}

export function normalizeSemanticSearchProvider(
  raw: string | null | undefined
): Extract<EmbeddingProvider, 'gemini' | 'openai'> {
  return raw === 'openai' ? 'openai' : DEFAULT_SEMANTIC_SEARCH_PROVIDER;
}
