import { normalizeProviderApiError, readFormattedOpenAiErrorBody } from './apiErrorUtils.js';
import { fetchWithLlmProxyPolling } from './llmProxyPolling.js';

export type OpenAiContent = string | OpenAiContentParts | OpenAiContentParts[];

export interface OpenAiContentParts {
  parts: OpenAiPart[];
}

export interface OpenAiPart {
  text?: string;
  inlineData?: OpenAiInlineDataInput;
}

export interface OpenAiInlineDataInput {
  mimeType: string;
  data: string;
}

export interface OpenAiApiConfig {
  apiKey: string;
  model?: string;
  endpoint?: string;
  generationConfig?: Record<string, unknown>;
}

export interface OpenAiGenerateRequest {
  contents: OpenAiContent;
  model?: string;
  generationConfig?: Record<string, unknown>;
  safetySettings?: Array<Record<string, unknown>>;
}

export interface OpenAiGenerateResult {
  text: string;
  raw: OpenAiResponsesResponse;
  model: string;
}

export interface OpenAiGeneratedImage {
  data?: string;
  url?: string;
  revisedPrompt?: string;
  mimeType?: string;
}

export interface OpenAiGenerateImageRequest {
  prompt: string;
  model?: string;
  size?: '1024x1024' | '1024x1536' | '1536x1024' | string;
  quality?: 'low' | 'medium' | 'high' | 'auto';
  background?: 'transparent' | 'opaque' | 'auto';
}

export interface OpenAiGenerateImageResult {
  images: OpenAiGeneratedImage[];
  text?: string;
  model: string;
  raw: Record<string, unknown>;
}

type OpenAiResponsesResponse = Record<string, unknown>;

type OpenAiResponsesInputMessage = {
  role: 'user';
  content: Array<
    | { type: 'input_text'; text: string }
    | { type: 'input_image'; image_url: string }
    | { type: 'input_file'; filename: string; file_data: string }
  >;
};

const DEFAULT_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-5.2';
const DEFAULT_IMAGE_MODEL = 'gpt-image-1';

export class OpenAiAPI {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly defaultModel: string;
  private readonly defaultGenerationConfig?: Record<string, unknown>;

  constructor(config: OpenAiApiConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAiAPI requires an apiKey');
    }
    this.apiKey = config.apiKey;
    this.endpoint = normalizeResponsesEndpoint(config.endpoint);
    this.defaultModel = sanitizeOpenAiModel(config.model);
    this.defaultGenerationConfig = config.generationConfig;
  }

  async generateText(prompt: string, options?: Omit<OpenAiGenerateRequest, 'contents'>): Promise<OpenAiGenerateResult> {
    return this.generateContent({
      contents: prompt,
      ...options
    });
  }

  async generateFromImage(
    imageData: string,
    mimeType: string,
    prompt: string,
    options?: Omit<OpenAiGenerateRequest, 'contents'>
  ): Promise<OpenAiGenerateResult> {
    return this.generateContent({
      contents: {
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: imageData } }
        ]
      },
      ...options
    });
  }

  async generateContent(request: OpenAiGenerateRequest): Promise<OpenAiGenerateResult> {
    const model = sanitizeOpenAiModel(request.model ?? this.defaultModel);
    const generationConfig = request.generationConfig ?? this.defaultGenerationConfig;

    const payload: Record<string, unknown> = {
      model,
      input: toResponsesInput(request.contents)
    };
    applyGenerationConfig(payload, generationConfig);

    const fetchImpl = resolveFetch();
    let response: Response;
    try {
      response = await fetchWithLlmProxyPolling(fetchImpl, this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      throw normalizeProviderApiError('OpenAI', error);
    }

    if (!response.ok) {
      const message = await readFormattedOpenAiErrorBody(response);
      throw new Error(`OpenAI request failed with status ${response.status}: ${message}`);
    }

    const raw = (await response.json()) as OpenAiResponsesResponse;
    const text = extractText(raw);
    if (!text) {
      throw new Error('OpenAI response did not include text content');
    }

    const modelFromResponse = normalizeText(readPath(raw, ['model']));
    return {
      text,
      raw,
      model: modelFromResponse ?? model
    };
  }

  async generateImage(requestOrPrompt: string | OpenAiGenerateImageRequest): Promise<OpenAiGenerateImageResult> {
    const request = typeof requestOrPrompt === 'string'
      ? ({ prompt: requestOrPrompt } satisfies OpenAiGenerateImageRequest)
      : requestOrPrompt;

    const model = sanitizeOpenAiImageModel(request.model);
    const fetchImpl = resolveFetch();
    const imagePayload: Record<string, unknown> = {
      model,
      prompt: request.prompt,
      size: request.size ?? '1024x1024',
      quality: request.quality ?? 'auto',
      background: request.background ?? 'auto'
    };
    // `gpt-image-*` rejects `response_format`; keep it only for legacy DALL-E compatibility.
    if (model.toLowerCase().startsWith('dall-e-')) {
      imagePayload.response_format = 'b64_json';
    }

    let response: Response;
    try {
      response = await fetchWithLlmProxyPolling(fetchImpl, normalizeImagesEndpoint(this.endpoint), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(imagePayload)
      });
    } catch (error) {
      throw normalizeProviderApiError('OpenAI', error);
    }

    if (!response.ok) {
      const message = await readFormattedOpenAiErrorBody(response);
      throw new Error(`OpenAI image generation request failed with status ${response.status}: ${message}`);
    }

    const raw = (await response.json()) as Record<string, unknown>;
    const images = extractImages(raw);
    return {
      images,
      text: images[0]?.revisedPrompt,
      model,
      raw
    };
  }
}

function sanitizeOpenAiModel(model: string | undefined): string {
  const trimmed = model?.trim();
  if (!trimmed) {
    return DEFAULT_MODEL;
  }
  if (looksLikeNonOpenAiModel(trimmed)) {
    return DEFAULT_MODEL;
  }
  return trimmed;
}

function sanitizeOpenAiImageModel(model: string | undefined): string {
  const trimmed = model?.trim();
  if (!trimmed) {
    return DEFAULT_IMAGE_MODEL;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized.startsWith('gpt-image-') || normalized.startsWith('dall-e-')) {
    return trimmed;
  }
  return DEFAULT_IMAGE_MODEL;
}

function looksLikeNonOpenAiModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return (
    normalized.startsWith('gemini-') ||
    normalized.startsWith('models/gemini') ||
    normalized.startsWith('claude-') ||
    normalized.startsWith('gpt-image-') ||
    normalized.startsWith('dall-e-')
  );
}

function normalizeResponsesEndpoint(endpoint: string | undefined): string {
  if (!endpoint) {
    return DEFAULT_RESPONSES_ENDPOINT;
  }
  const trimmed = endpoint.trim();
  if (trimmed.length === 0) {
    return DEFAULT_RESPONSES_ENDPOINT;
  }
  if (trimmed.endsWith('/responses')) {
    return trimmed;
  }
  return `${trimmed.replace(/\/+$/, '')}/responses`;
}

function normalizeImagesEndpoint(endpoint: string | undefined): string {
  const responses = normalizeResponsesEndpoint(endpoint);
  if (responses.endsWith('/responses')) {
    return `${responses.slice(0, -'/responses'.length)}/images/generations`;
  }
  return `${responses.replace(/\/+$/, '')}/images/generations`;
}

function applyGenerationConfig(
  payload: Record<string, unknown>,
  generationConfig?: Record<string, unknown>
): void {
  if (!generationConfig) {
    return;
  }

  const passthroughKeys = ['temperature', 'top_p', 'max_output_tokens', 'response_format'] as const;
  for (const key of passthroughKeys) {
    if (key in generationConfig) {
      payload[key] = generationConfig[key];
    }
  }

  if ('topP' in generationConfig && !('top_p' in payload)) {
    payload.top_p = generationConfig.topP;
  }
  if ('maxOutputTokens' in generationConfig && !('max_output_tokens' in payload)) {
    payload.max_output_tokens = generationConfig.maxOutputTokens;
  }
  if ('responseFormat' in generationConfig && !('response_format' in payload)) {
    payload.response_format = generationConfig.responseFormat;
  }
}

function toResponsesInput(content: OpenAiContent): string | OpenAiResponsesInputMessage[] {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((entry) => toInputMessage(entry));
  }

  return [toInputMessage(content)];
}

function toInputMessage(content: OpenAiContentParts): OpenAiResponsesInputMessage {
  const parts: OpenAiResponsesInputMessage['content'] = [];
  for (const part of content.parts ?? []) {
    if (typeof part.text === 'string' && part.text.trim().length > 0) {
      parts.push({ type: 'input_text', text: part.text });
    }
    if (part.inlineData?.data && part.inlineData.mimeType) {
      const dataUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      if (part.inlineData.mimeType.startsWith('image/')) {
        parts.push({ type: 'input_image', image_url: dataUrl });
      } else {
        parts.push({
          type: 'input_file',
          filename: inferFilename(part.inlineData.mimeType),
          file_data: dataUrl
        });
      }
    }
  }

  if (parts.length === 0) {
    parts.push({ type: 'input_text', text: '' });
  }

  return { role: 'user', content: parts };
}

function inferFilename(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized === 'application/pdf') {
    return 'document.pdf';
  }
  if (normalized.includes('json')) {
    return 'document.json';
  }
  if (normalized.includes('text/plain')) {
    return 'document.txt';
  }
  return 'document.bin';
}

function extractImages(response: Record<string, unknown>): OpenAiGeneratedImage[] {
  const data = response.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('OpenAI image generation response did not include images');
  }
  const images: OpenAiGeneratedImage[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as Record<string, unknown>;
    const b64 = normalizeText(record.b64_json);
    const url = normalizeText(record.url);
    const revisedPrompt = normalizeText(record.revised_prompt);
    if (!b64 && !url) {
      continue;
    }
    images.push({
      data: b64,
      url,
      revisedPrompt,
      mimeType: b64 ? 'image/png' : undefined
    });
  }
  if (images.length === 0) {
    throw new Error('OpenAI image generation response did not include image payloads');
  }
  return images;
}

function extractText(response: OpenAiResponsesResponse): string | undefined {
  const outputText = normalizeText(readPath(response, ['output_text']));
  if (outputText) {
    return outputText;
  }

  const output = readPath(response, ['output']);
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const content = readPath(item as Record<string, unknown>, ['content']);
      if (!Array.isArray(content)) {
        continue;
      }
      for (const part of content) {
        if (!part || typeof part !== 'object') {
          continue;
        }
        const textDirect = normalizeText(readPath(part as Record<string, unknown>, ['text']));
        if (textDirect) {
          return textDirect;
        }
        const textValue = normalizeText(readPath(part as Record<string, unknown>, ['text', 'value']));
        if (textValue) {
          return textValue;
        }
      }
    }
  }

  return undefined;
}

function readPath(value: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveFetch(): typeof fetch {
  if (typeof fetch === 'function') {
    return fetch;
  }
  if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') {
    return globalThis.fetch;
  }
  throw new Error('A global fetch implementation is required to call the OpenAI API.');
}
