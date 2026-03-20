import {
  getOpenAiCompatibleProviderLabel,
  isOpenAiCompatibleProvider,
  type OpenAiCompatibleProvider,
  type StructuredExtractProvider
} from 'pdf-layout-parser';

export type AppLlmProvider = StructuredExtractProvider | 'mock';

export function getProviderDisplayName(provider: AppLlmProvider): string {
  if (provider === 'mock') {
    return 'Mock';
  }
  if (provider === 'gemini') {
    return 'Gemini';
  }
  return getOpenAiCompatibleProviderLabel(provider);
}

export function isProxyOnlyProvider(provider: StructuredExtractProvider): boolean {
  return provider === 'codex';
}

export function isOpenAiCompatibleAppProvider(
  provider: StructuredExtractProvider | OpenAiCompatibleProvider | string
): provider is OpenAiCompatibleProvider {
  return isOpenAiCompatibleProvider(provider);
}
