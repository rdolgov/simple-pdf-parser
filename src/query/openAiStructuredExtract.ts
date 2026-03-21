import {
  GeminiStructuredExtract,
  type GeminiStructuredExtractOptions,
  type ParsedTable,
  type StructuredDataDocument,
  type StructuredExtractFileInput
} from './geminiStructuredExtract.js';
import { OpenAiAPI, type OpenAiApiConfig } from './openAiApi.js';
import type { OpenAiCompatibleProvider } from './openAiCompatibleProvider.js';

export type OpenAiStructuredExtractOptions = GeminiStructuredExtractOptions;

export interface OpenAiStructuredExtractConfig {
  apiKey: string;
  providerName?: OpenAiCompatibleProvider;
  model?: string;
  endpoint?: string;
  generationConfig?: OpenAiApiConfig['generationConfig'];
  prompt?: string;
}

export interface OpenAiStructuredExtractResult {
  document: StructuredDataDocument;
  parsedTables: ParsedTable[];
  assetMap: Record<string, string>;
  model: string;
  prompt: string;
  rawText: string;
}

export class OpenAiStructuredExtract {
  private readonly delegate: GeminiStructuredExtract;

  constructor(config: OpenAiStructuredExtractConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAiStructuredExtract requires an apiKey');
    }

    const client = new OpenAiAPI({
      apiKey: config.apiKey,
      model: config.model,
      endpoint: config.endpoint,
      generationConfig: config.generationConfig
    });

    this.delegate = new GeminiStructuredExtract(
      {
        apiKey: config.apiKey,
        model: config.model,
        generationConfig: config.generationConfig,
        prompt: config.prompt
      },
      {
        client,
        providerName: config.providerName ?? 'openai'
      }
    );
  }

  async extract(
    file: StructuredExtractFileInput,
    options: OpenAiStructuredExtractOptions = {}
  ): Promise<OpenAiStructuredExtractResult> {
    return this.delegate.extract(file, options);
  }
}
