export interface LMStudioConfig {
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
}

export interface LMStudioEmbeddingRequest {
  model?: string;
  input: string | string[];
}

export interface LMStudioEmbeddingResponse {
  object?: string;
  model?: string;
  data?: Array<{
    object?: string;
    embedding?: number[];
    index?: number;
  }>;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

export interface LMStudioEmbeddingResult {
  embeddings: number[][];
  model: string;
  usage?: LMStudioEmbeddingResponse['usage'];
  raw: LMStudioEmbeddingResponse;
}

export class LMStudioAPI {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultModel: string;

  constructor(config?: LMStudioConfig) {
    this.baseUrl = (config?.baseUrl ?? 'http://127.0.0.1:1234/v1').replace(/\/$/, '');
    this.apiKey = config?.apiKey;
    this.defaultModel = config?.defaultModel ?? 'text-embedding-nomic-embed-text-v2-moe';
  }

  async generateEmbedding(request: LMStudioEmbeddingRequest): Promise<LMStudioEmbeddingResult> {
    const model = request.model ?? this.defaultModel;
    const url = `${this.baseUrl}/embeddings`;
    const payload = {
      model,
      input: request.input
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const message = await safeReadText(response);
      throw new Error(`LM Studio embeddings request failed with status ${response.status}: ${message}`);
    }

    const body = (await response.json()) as LMStudioEmbeddingResponse;
    const embeddings = extractEmbeddings(body);
    return {
      embeddings,
      model: body.model ?? model,
      usage: body.usage,
      raw: body
    };
  }
}

function extractEmbeddings(response: LMStudioEmbeddingResponse): number[][] {
  if (!response.data || response.data.length === 0) {
    throw new Error('LM Studio embeddings response did not include data');
  }
  const embeddings: number[][] = [];
  for (const item of response.data) {
    if (!item.embedding || !Array.isArray(item.embedding)) {
      continue;
    }
    embeddings.push(item.embedding);
  }
  if (embeddings.length === 0) {
    throw new Error('LM Studio embeddings response did not include embedding vectors');
  }
  return embeddings;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    return error instanceof Error ? error.message : 'unable to read error body';
  }
}
