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
const DEFAULT_MODEL = 'gpt-4.1';

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
    this.defaultModel = config.model ?? DEFAULT_MODEL;
    this.defaultGenerationConfig = config.generationConfig;
  }

  async generateText(prompt: string, options?: Omit<OpenAiGenerateRequest, 'contents'>): Promise<OpenAiGenerateResult> {
    return this.generateContent({
      contents: prompt,
      ...options
    });
  }

  async generateContent(request: OpenAiGenerateRequest): Promise<OpenAiGenerateResult> {
    const model = request.model ?? this.defaultModel;
    const generationConfig = request.generationConfig ?? this.defaultGenerationConfig;

    const payload: Record<string, unknown> = {
      model,
      input: toResponsesInput(request.contents)
    };
    applyGenerationConfig(payload, generationConfig);

    const fetchImpl = resolveFetch();
    const response = await fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const message = await readErrorBody(response);
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

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 0 ? text : response.statusText;
  } catch (error) {
    return (error as Error).message;
  }
}
