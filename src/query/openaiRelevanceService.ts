import type {
  RelevanceQueryInput,
  RelevanceResponse,
  RelevanceService,
  RelevanceServiceConfig
} from './relevanceTypes.js';
import { normalizeProviderApiError, readFormattedOpenAiErrorBody } from './apiErrorUtils.js';

interface OpenAiLikeClient {
  responses: {
    create(input: Record<string, unknown>): Promise<any>;
  };
}

type RawOpenAiResponse = {
  model?: string;
  created?: number | string | Date;
  output?: Array<{
    content?: Array<{
      text?: string;
    }>;
  }>;
};

export interface OpenAiClientFactory {
  (config: RelevanceServiceConfig): Promise<OpenAiLikeClient> | OpenAiLikeClient;
}

export class OpenAiRelevanceService implements RelevanceService {
  private readonly createClient: () => Promise<OpenAiLikeClient>;

  constructor(private readonly config: RelevanceServiceConfig, clientFactory?: OpenAiClientFactory) {
    if (config.provider !== 'openai') {
      throw new Error(`OpenAiRelevanceService requires provider to be "openai" (received "${config.provider}")`);
    }
    const apiKey = config.apiKey;
    if (!apiKey) {
      throw new Error('OpenAiRelevanceService requires an apiKey');
    }

    this.createClient = clientFactory
      ? async () => {
        const client = await clientFactory(config);
        return client;
      }
      : async () => {
          const moduleId = 'openai';
          try {
            const { default: OpenAI } = await import(/* @vite-ignore */ moduleId);
            return new OpenAI({
              apiKey,
              baseURL: this.config.endpoint,
              dangerouslyAllowBrowser: this.config.dangerouslyAllowBrowser ?? false
            });
          } catch (error) {
            return createFetchResponsesClient(apiKey, this.config.endpoint);
          }
        };
  }

  async analyze(input: RelevanceQueryInput): Promise<RelevanceResponse> {
    const client = await this.createClient();
    const prompt = buildPrompt(input);
    const model = sanitizeOpenAiModel(this.config.model);
    const requestPayload = {
      model,
      temperature: this.config.temperature ?? 0.2,
      top_p: this.config.topP,
      max_output_tokens: this.config.maxOutputTokens ?? 1200,
      input: prompt
    };

    const response = (await client.responses.create(requestPayload)) as RawOpenAiResponse;

    const outputText = response.output?.[0]?.content?.[0]?.text?.trim();
    if (!outputText) {
      throw new Error('OpenAI response did not include text content');
    }

    const annotations = parseAnnotations(outputText);
    const payload = {
      annotations,
      model: response.model,
      createdAt: resolveCreatedAt(response.created),
      querySummary: annotations.length > 0 ? annotations[0].rationale : undefined
    };

    this.config.debugRecorder?.({
      provider: 'openai',
      query: input.query,
      prompt,
      requestPayload,
      responsePayload: response
    });

    return payload;
  }
}

function sanitizeOpenAiModel(model: string | undefined): string {
  const trimmed = model?.trim();
  if (!trimmed) {
    return 'gpt-5.2';
  }
  const normalized = trimmed.toLowerCase();
  if (
    normalized.startsWith('gemini-') ||
    normalized.startsWith('models/gemini') ||
    normalized.startsWith('claude-') ||
    normalized.startsWith('gpt-image-') ||
    normalized.startsWith('dall-e-')
  ) {
    return 'gpt-5.2';
  }
  return trimmed;
}

function resolveCreatedAt(created: unknown): string | undefined {
  if (!created) {
    return undefined;
  }
  if (typeof created === 'number') {
    return new Date(created * 1000).toISOString();
  }
  if (created instanceof Date) {
    return created.toISOString();
  }
  if (typeof created === 'string') {
    return created;
  }
  return undefined;
}

function buildPrompt(input: RelevanceQueryInput): string {
  const { query, document, maxContextTokens = 6000 } = input;
  const header = `You are an assistant that highlights relevant sections of a PDF document for a user query. Return JSON matching the schema: { "annotations": [ { "pageNumber": number, "blockIndex": number, "state": "highlight"|"dim"|"hidden", "summary"?: string, "rewrittenText"?: string, "rationale"?: string, "confidence"?: number } ] }`;

  const chunks: string[] = [];
  let tokens = 0;
  let limitReached = false;
  for (const page of document.pages) {
    if (limitReached) {
      break;
    }
    for (let index = 0; index < page.content.length; index += 1) {
      const block = page.content[index];
      const snippet = summarizeBlock(block);
      const snippetTokens = estimateTokens(snippet);
      if (tokens + snippetTokens > maxContextTokens) {
        limitReached = true;
        break;
      }
      tokens += snippetTokens;
      chunks.push(`Page ${page.number}, Block ${index}: ${snippet}`);
    }
  }

  const context = chunks.join('\n');
  return `${header}\nUser query: ${query}\nDocument excerpts:\n${context}`;
}

function summarizeBlock(block: { type: string; text?: string; lines?: Array<{ text: string }>; }): string {
  if ('text' in block && typeof block.text === 'string' && block.text.trim().length > 0) {
    return block.text.trim();
  }
  if ('lines' in block && Array.isArray(block.lines)) {
    return block.lines.map((line) => line.text.trim()).filter(Boolean).join(' ');
  }
  return `[${block.type}]`;
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 3.5) + 4;
}

function parseAnnotations(jsonText: string) {
  try {
    const parsed = JSON.parse(jsonText) as RelevanceResponse;
    if (!parsed || !Array.isArray(parsed.annotations)) {
      throw new Error('Invalid annotation payload');
    }
    return parsed.annotations;
  } catch (error) {
    throw new Error(`Failed to parse annotations: ${(error as Error).message}`);
  }
}

function createFetchResponsesClient(apiKey: string, endpoint?: string): OpenAiLikeClient {
  const fetchImpl = resolveFetch();
  const targetEndpoint = endpoint ?? 'https://api.openai.com/v1/responses';
  return {
    responses: {
      async create(input: Record<string, unknown>) {
        let response: Response;
        try {
          response = await fetchImpl(targetEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify(input)
          });
        } catch (error) {
          throw normalizeProviderApiError('OpenAI', error);
        }
        if (!response.ok) {
          const message = await readFormattedOpenAiErrorBody(response);
          throw new Error(`OpenAI request failed with status ${response.status}: ${message}`);
        }
        return (await response.json()) as RawOpenAiResponse;
      }
    }
  };
}

function resolveFetch(): typeof fetch {
  if (typeof fetch === 'function') {
    return fetch;
  }
  if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') {
    return globalThis.fetch;
  }
  throw new Error(
    'Neither the "openai" package nor a global fetch implementation is available. Install "openai" or polyfill fetch.'
  );
}
