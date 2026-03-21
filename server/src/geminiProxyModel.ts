export interface GeminiProxyModelConfig {
  textModel: string;
  binaryInputModel?: string;
}

export interface GeminiProxyModelSelection {
  upstreamPath: string;
  requestedModel: string | null;
  selectedModel: string | null;
  mode: 'text' | 'binary' | 'passthrough';
}

const GENERATE_CONTENT_PATH_PATTERN = /^(v[0-9a-z]+(?:[a-z]*)\/models\/)([^/:]+)(:generateContent)$/i;

export function resolveGeminiProxyUpstreamPath(
  upstreamPath: string,
  body: Buffer,
  config: GeminiProxyModelConfig
): GeminiProxyModelSelection {
  const match = GENERATE_CONTENT_PATH_PATTERN.exec(upstreamPath);
  if (!match) {
    return {
      upstreamPath,
      requestedModel: null,
      selectedModel: null,
      mode: 'passthrough'
    };
  }

  const requestedModel = decodeURIComponent(match[2] ?? '').trim() || null;
  const needsBinaryOrImageModel = requestNeedsBinaryOrImageModel(body);
  const selectedModel = needsBinaryOrImageModel
    ? normalizeOptionalModel(config.binaryInputModel) ?? requestedModel
    : normalizeOptionalModel(config.textModel);

  if (!selectedModel) {
    return {
      upstreamPath,
      requestedModel,
      selectedModel: requestedModel,
      mode: needsBinaryOrImageModel ? 'binary' : 'text'
    };
  }

  const normalizedRequested = normalizeModelId(requestedModel);
  const normalizedSelected = normalizeModelId(selectedModel);
  if (normalizedRequested === normalizedSelected) {
    return {
      upstreamPath,
      requestedModel,
      selectedModel,
      mode: needsBinaryOrImageModel ? 'binary' : 'text'
    };
  }

  return {
    upstreamPath: `${match[1]}${encodeURIComponent(selectedModel)}${match[3]}`,
    requestedModel,
    selectedModel,
    mode: needsBinaryOrImageModel ? 'binary' : 'text'
  };
}

function requestNeedsBinaryOrImageModel(body: Buffer): boolean {
  const payload = tryParseJsonObject(body);
  if (!payload) {
    return false;
  }

  if (requestAsksForImageOutput(payload)) {
    return true;
  }

  const contents = Array.isArray(payload.contents)
    ? payload.contents
    : payload.contents && typeof payload.contents === 'object'
      ? [payload.contents]
      : [];

  for (const content of contents) {
    if (!content || typeof content !== 'object') {
      continue;
    }
    const parts = Array.isArray((content as { parts?: unknown }).parts)
      ? (content as { parts: unknown[] }).parts
      : [];
    for (const part of parts) {
      if (!part || typeof part !== 'object') {
        continue;
      }
      const inlineData = readInlineData(part);
      if (!inlineData) {
        continue;
      }
      const mimeType = normalizeOptionalModel(inlineData.mimeType);
      if (!mimeType) {
        return true;
      }
      const normalized = mimeType.toLowerCase();
      if (
        normalized.startsWith('image/') ||
        normalized === 'application/pdf' ||
        normalized.startsWith('audio/') ||
        normalized.startsWith('video/')
      ) {
        return true;
      }
    }
  }
  return false;
}

function requestAsksForImageOutput(payload: Record<string, unknown>): boolean {
  const generationConfig = readGenerationConfig(payload);
  if (!generationConfig) {
    return false;
  }

  const responseModalities = Array.isArray(generationConfig.responseModalities)
    ? generationConfig.responseModalities
    : Array.isArray(generationConfig.response_modalities)
      ? generationConfig.response_modalities
      : [];

  return responseModalities.some((value: unknown) => typeof value === 'string' && value.trim().toUpperCase() === 'IMAGE');
}

function readGenerationConfig(
  payload: Record<string, unknown>
): {
  responseModalities?: unknown;
  response_modalities?: unknown;
} | null {
  if (isRecord(payload.generationConfig)) {
    return payload.generationConfig as {
      responseModalities?: unknown;
      response_modalities?: unknown;
    };
  }
  if (isRecord(payload.generation_config)) {
    return payload.generation_config as {
      responseModalities?: unknown;
      response_modalities?: unknown;
    };
  }
  return null;
}

function readInlineData(part: object): { mimeType?: string | null } | null {
  const record = part as {
    inlineData?: { mimeType?: string | null } | null;
    inline_data?: { mime_type?: string | null; mimeType?: string | null } | null;
  };
  if (record.inlineData) {
    return record.inlineData;
  }
  if (record.inline_data) {
    return {
      mimeType: record.inline_data.mimeType ?? record.inline_data.mime_type ?? null
    };
  }
  return null;
}

function tryParseJsonObject(body: Buffer): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body.toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalizeOptionalModel(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeModelId(value: string | null | undefined): string {
  return normalizeOptionalModel(value)?.replace(/^models\//i, '').toLowerCase() ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
