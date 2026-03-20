import type { StructuredExtractProvider } from 'pdf-layout-parser';
import {
  getStructuredExtractApiKey,
  getStructuredExtractModel,
  getStructuredExtractProvider
} from './structuredExtractSettings';

export interface AiLayoutRuntimeSettings {
  provider: StructuredExtractProvider;
  apiKey: string | null;
  model: string | null;
}

export function loadAiLayoutRuntimeSettings(): AiLayoutRuntimeSettings {
  const provider = getStructuredExtractProvider();
  return {
    provider,
    apiKey: getStructuredExtractApiKey(provider),
    model: getStructuredExtractModel(provider)
  };
}
