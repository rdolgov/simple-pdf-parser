import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import {
  GeminiAPI,
  OpenAiAPI,
  StructuredExtractAPI,
  createGoogleSearchTool,
  resolveGeminiBinaryInputModel,
  resolveGeminiTextModel,
  type StructuredExtractProvider
} from '../../src/index.js';
import { executeCodexResponses, type CodexExecConfig } from './codexExecProxy.js';

export type TaskTextProvider = 'gemini' | 'openai' | 'codex';
export type TaskImageProvider = 'gemini' | 'openai';

export interface TaskServerProvidersConfig {
  openAiBaseUrl: string;
  openAiApiKey?: string;
  geminiBaseUrl: string;
  geminiApiKey?: string;
  geminiModel: string;
  geminiBinaryInputModel?: string;
  codexExec: CodexExecConfig;
}

export interface TaskTextResult {
  text: string;
  model: string;
  raw: unknown;
}

export interface TaskImageResult {
  dataUri: string;
  mimeType: string;
  model: string;
  prompt?: string;
  raw: unknown;
}

export interface TaskStructuredDetectResult {
  document: Record<string, unknown>;
  parsedTables: unknown[];
  assetMap: Record<string, string>;
  model: string;
  rawText: string;
}

export async function executeStructuredDetectTask(
  input: {
    provider?: Exclude<StructuredExtractProvider, 'codex'>;
    model?: string;
    filePath: string;
    fileName: string;
  },
  config: TaskServerProvidersConfig
): Promise<TaskStructuredDetectResult> {
  const provider = input.provider ?? 'gemini';
  if (provider === 'openai') {
    if (!config.openAiApiKey) {
      throw new Error('OPENAI_API_KEY is not configured on the proxy server.');
    }
  } else if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the proxy server.');
  }

  const bytes = await readFile(input.filePath);
  const extractor = new StructuredExtractAPI({
    provider,
    apiKey: provider === 'openai' ? config.openAiApiKey : config.geminiApiKey,
    model: input.model,
    endpoint: provider === 'openai' ? config.openAiBaseUrl : config.geminiBaseUrl
  });
  const result = await extractor.extractStructuredData(bytes, { fileName: input.fileName });
  return {
    document: result.document as Record<string, unknown>,
    parsedTables: result.parsedTables,
    assetMap: result.assetMap,
    model: input.model?.trim() || providerDefaultModel(provider, config),
    rawText: decodeArrayBuffer(result.rawZip)
  };
}

export async function executeTextTask(
  input: {
    provider?: TaskTextProvider;
    model?: string;
    prompt: string;
    responseFormat?: 'text' | 'json';
    enableWebSearch?: boolean;
  },
  config: TaskServerProvidersConfig
): Promise<TaskTextResult> {
  const provider = input.provider ?? 'gemini';
  if (provider === 'openai') {
    if (!config.openAiApiKey) {
      throw new Error('OPENAI_API_KEY is not configured on the proxy server.');
    }
    const client = new OpenAiAPI({
      apiKey: config.openAiApiKey,
      endpoint: config.openAiBaseUrl,
      ...(input.model?.trim() ? { model: input.model.trim() } : {})
    });
    const response = await client.generateText(input.prompt, input.responseFormat === 'json'
      ? { generationConfig: { responseFormat: { type: 'json_object' } } }
      : undefined);
    return {
      text: response.text,
      model: response.model,
      raw: response.raw
    };
  }

  if (provider === 'codex') {
    if (!config.codexExec.enabled) {
      throw new Error('CODEX_EXEC_ENABLED is not configured on the proxy server.');
    }
    const body = Buffer.from(JSON.stringify({
      ...(input.model?.trim() ? { model: input.model.trim() } : {}),
      input: input.prompt
    }), 'utf8');
    const response = await executeCodexResponses(body, config.codexExec);
    const payload = safeParseJson(response.body.toString('utf8'));
    const text = normalizeNonEmptyString((payload as { output_text?: unknown })?.output_text);
    if (!text) {
      throw new Error('Codex response did not include text content.');
    }
    return {
      text,
      model: normalizeNonEmptyString((payload as { model?: unknown })?.model) ?? input.model?.trim() ?? 'codex',
      raw: payload
    };
  }

  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the proxy server.');
  }
  const geminiModel = resolveGeminiTextModel(input.model?.trim() || config.geminiModel);
  const client = new GeminiAPI({
    apiKey: config.geminiApiKey,
    endpoint: config.geminiBaseUrl,
    model: geminiModel,
    ...(input.enableWebSearch ? { tools: [createGoogleSearchTool()] } : {})
  });
  const response = await client.generateText(input.prompt, input.responseFormat === 'json'
    ? { generationConfig: { responseMimeType: 'application/json' } }
    : undefined);
  return {
    text: response.text,
    model: response.model,
    raw: response.raw
  };
}

export async function executeImageAnalysisTask(
  input: {
    provider?: TaskImageProvider;
    model?: string;
    prompt: string;
    base64Data: string;
    mimeType: string;
  },
  config: TaskServerProvidersConfig
): Promise<TaskTextResult> {
  const provider = input.provider ?? 'gemini';
  if (provider === 'openai') {
    if (!config.openAiApiKey) {
      throw new Error('OPENAI_API_KEY is not configured on the proxy server.');
    }
    const client = new OpenAiAPI({
      apiKey: config.openAiApiKey,
      endpoint: config.openAiBaseUrl,
      ...(input.model?.trim() ? { model: input.model.trim() } : {})
    });
    const response = await client.generateFromImage(input.base64Data, input.mimeType, input.prompt);
    return {
      text: response.text,
      model: response.model,
      raw: response.raw
    };
  }

  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the proxy server.');
  }
  const geminiModel = resolveGeminiBinaryInputModel(
    input.model?.trim() || config.geminiBinaryInputModel || config.geminiModel
  );
  const client = new GeminiAPI({
    apiKey: config.geminiApiKey,
    endpoint: config.geminiBaseUrl,
    model: geminiModel,
    imageModel: geminiModel
  });
  const response = await client.generateFromImage(input.base64Data, input.mimeType, input.prompt, {
    model: geminiModel,
    mediaResolution: 'high'
  });
  return {
    text: response.text,
    model: response.model,
    raw: response.raw
  };
}

export async function executeImageGenerationTask(
  input: {
    provider?: TaskImageProvider;
    model?: string;
    prompt: string;
  },
  config: TaskServerProvidersConfig
): Promise<TaskImageResult> {
  const provider = input.provider ?? 'gemini';
  if (provider === 'openai') {
    if (!config.openAiApiKey) {
      throw new Error('OPENAI_API_KEY is not configured on the proxy server.');
    }
    const client = new OpenAiAPI({
      apiKey: config.openAiApiKey,
      endpoint: config.openAiBaseUrl,
      ...(input.model?.trim() ? { model: input.model.trim() } : {})
    });
    const response = await client.generateImage({
      prompt: input.prompt,
      size: '1536x1024',
      background: 'opaque'
    });
    const image = response.images[0];
    const mimeType = image?.mimeType ?? 'image/png';
    const dataUri = image?.data
      ? `data:${mimeType};base64,${image.data}`
      : image?.url;
    if (!dataUri) {
      throw new Error('OpenAI image response did not include image data.');
    }
    return {
      dataUri,
      mimeType,
      model: response.model,
      prompt: response.text,
      raw: response.raw
    };
  }

  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the proxy server.');
  }
  const geminiModel = resolveGeminiBinaryInputModel(
    input.model?.trim() || config.geminiBinaryInputModel || config.geminiModel
  );
  const client = new GeminiAPI({
    apiKey: config.geminiApiKey,
    endpoint: config.geminiBaseUrl,
    model: geminiModel,
    imageModel: geminiModel
  });
  const response = await client.generateImage(input.prompt, { model: geminiModel });
  const image = response.images[0];
  const mimeType = image?.mimeType ?? 'image/png';
  const dataUri = image?.data ? `data:${mimeType};base64,${image.data}` : null;
  if (!dataUri) {
    throw new Error('Gemini response did not include inline image data.');
  }
  return {
    dataUri,
    mimeType,
    model: response.model,
    prompt: response.text,
    raw: response.raw
  };
}

function decodeArrayBuffer(value: ArrayBuffer): string {
  return Buffer.from(value).toString('utf8');
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function providerDefaultModel(provider: 'gemini' | 'openai', config: TaskServerProvidersConfig): string {
  if (provider === 'openai') {
    return 'gpt-5.2';
  }
  return config.geminiBinaryInputModel ?? config.geminiModel;
}
