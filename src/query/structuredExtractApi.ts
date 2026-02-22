import {
  GeminiStructuredExtract,
  type GeminiStructuredExtractOptions,
  type ParsedTable,
  type StructuredDataDocument as GeminiStructuredDataDocument,
  type StructuredDataElement as GeminiStructuredDataElement,
  type StructuredDataPage as GeminiStructuredDataPage,
  type StructuredExtractFileInput
} from './geminiStructuredExtract.js';
import { OpenAiStructuredExtract } from './openAiStructuredExtract.js';

export type StructuredExtractFile = StructuredExtractFileInput;
export type StructuredExtractProvider = 'gemini' | 'openai';

export interface StructuredExtractApiConfig {
  provider?: StructuredExtractProvider;
  apiKey?: string;
  model?: string;
  endpoint?: string;
  generationConfig?: Record<string, unknown>;
  safetySettings?: Array<Record<string, unknown>>;
  prompt?: string;
}

export type StructuredExtractOptions = GeminiStructuredExtractOptions;

export type StructuredDataElement = GeminiStructuredDataElement;
export type StructuredBoundsTuple = [number, number, number, number];
export type StructuredPage = GeminiStructuredDataPage;
export type StructuredDataDocument = GeminiStructuredDataDocument;

export interface StructuredExtractResult {
  document: StructuredDataDocument;
  assetMap: Record<string, string>;
  tableAssets: Record<string, ArrayBuffer>;
  rawZip: ArrayBuffer;
  parsedTables: ParsedTable[];
}

export type StructuredExtractAPIResponse = StructuredExtractResult;

export type { ParsedTable };

const PROVIDER_KEY_STORAGE_KEYS: Record<StructuredExtractProvider, readonly string[]> = {
  gemini: ['gemini-overlay-api-key', 'gemini-api-key', 'google-gemini-api-key'],
  openai: ['openai-api-key', 'openai-overlay-api-key']
} as const;

export class StructuredExtractAPI {
  private readonly config: StructuredExtractApiConfig;

  constructor(config: StructuredExtractApiConfig = {}) {
    this.config = config;
  }

  async extractStructuredData(
    file: StructuredExtractFile,
    options: StructuredExtractOptions = {}
  ): Promise<StructuredExtractResult> {
    const provider = this.config.provider ?? 'gemini';
    const apiKey = resolveApiKey(provider, this.config.apiKey);
    if (!apiKey) {
      const providerName = provider === 'openai' ? 'OpenAI' : 'Gemini';
      const storageKeys = PROVIDER_KEY_STORAGE_KEYS[provider];
      throw new Error(
        `${providerName} API key is required. Pass apiKey to StructuredExtractAPI or store it in localStorage under ${storageKeys.join(', ')}.`
      );
    }

    const extractor =
      provider === 'openai'
        ? new OpenAiStructuredExtract({
            apiKey,
            model: this.config.model,
            endpoint: this.config.endpoint,
            generationConfig: this.config.generationConfig,
            prompt: this.config.prompt
          })
        : new GeminiStructuredExtract({
            apiKey,
            model: this.config.model,
            generationConfig: this.config.generationConfig,
            safetySettings: this.config.safetySettings,
            prompt: this.config.prompt
          });

    const response = await extractor.extract(file, options);

    return {
      document: response.document,
      assetMap: response.assetMap,
      tableAssets: {},
      parsedTables: response.parsedTables,
      rawZip: encodeUtf8(response.rawText)
    };
  }
}

function resolveApiKey(provider: StructuredExtractProvider, explicitApiKey: string | undefined): string | undefined {
  const explicit = normalizeNonEmpty(explicitApiKey);
  if (explicit) {
    return explicit;
  }

  const envApiKey = resolveEnvApiKey(provider);
  if (envApiKey) {
    return envApiKey;
  }

  return resolveBrowserStorageApiKey(provider);
}

function resolveEnvApiKey(provider: StructuredExtractProvider): string | undefined {
  const withProcess = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  const candidate =
    provider === 'openai'
      ? withProcess.process?.env?.OPENAI_API_KEY
      : withProcess.process?.env?.GEMINI_API_KEY;
  return normalizeNonEmpty(candidate);
}

function resolveBrowserStorageApiKey(provider: StructuredExtractProvider): string | undefined {
  const withWindow = globalThis as typeof globalThis & {
    localStorage?: {
      getItem(key: string): string | null;
    };
  };
  const storage = withWindow.localStorage;
  if (!storage) {
    return undefined;
  }

  for (const key of PROVIDER_KEY_STORAGE_KEYS[provider]) {
    try {
      const candidate = storage.getItem(key);
      const normalized = normalizeNonEmpty(candidate ?? undefined);
      if (normalized) {
        return normalized;
      }
    } catch {
      // Ignore storage access errors.
    }
  }

  return undefined;
}

function normalizeNonEmpty(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function encodeUtf8(value: string): ArrayBuffer {
  const encoder = new TextEncoder();
  return encoder.encode(value).buffer as ArrayBuffer;
}
