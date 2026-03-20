export type OpenAiCompatibleProvider = 'openai' | 'codex';

export function isOpenAiCompatibleProvider(provider: string): provider is OpenAiCompatibleProvider {
  return provider === 'openai' || provider === 'codex';
}

export function getOpenAiCompatibleProviderLabel(provider: OpenAiCompatibleProvider): string {
  return provider === 'codex' ? 'Codex' : 'OpenAI';
}
