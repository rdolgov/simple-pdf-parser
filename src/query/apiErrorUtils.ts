type JsonObject = Record<string, unknown>;

export async function readFormattedOpenAiErrorBody(response: Response): Promise<string> {
  const requestId = readResponseHeader(response, ['x-request-id', 'request-id']);

  try {
    const text = await response.text();
    return formatOpenAiErrorText(text, response.statusText, requestId);
  } catch (error) {
    const base = error instanceof Error ? error.message : 'Unable to read error response body';
    return requestId ? `${base} (request id: ${requestId})` : base;
  }
}

export function normalizeProviderApiError(provider: 'OpenAI' | 'Gemini' | 'Codex', error: unknown): Error {
  const message = formatProviderErrorMessage(provider, error);
  if (error instanceof Error && message === error.message) {
    return error;
  }
  const wrapped = new Error(message);
  if (error instanceof Error && error.stack) {
    wrapped.stack = error.stack;
  }
  return wrapped;
}

function formatOpenAiErrorText(text: string, fallbackStatusText: string, requestId: string | null): string {
  const parsed = tryParseJson(text);
  const errorObj = parsed && isObject(parsed.error)
    ? parsed.error
    : isObject(parsed)
    ? parsed
    : null;

  const message = normalizeText(
    errorObj ? (errorObj.message ?? parsed?.message) : parsed?.message
  ) ?? normalizeText(text) ?? fallbackStatusText;

  const details: string[] = [];
  const type = normalizeText(errorObj?.type);
  const param = normalizeText(errorObj?.param);
  const code = normalizeText(errorObj?.code);
  if (type) details.push(`type: ${type}`);
  if (param) details.push(`param: ${param}`);
  if (code) details.push(`code: ${code}`);
  if (requestId) details.push(`request id: ${requestId}`);

  return details.length > 0 ? `${message} (${details.join(', ')})` : message;
}

function formatProviderErrorMessage(provider: 'OpenAI' | 'Gemini' | 'Codex', error: unknown): string {
  const basePrefix = `${provider} API request failed`;

  if (error instanceof Error) {
    const extracted = extractNestedApiMessage(error.message);
    const status = normalizeText((error as Error & { status?: unknown; statusCode?: unknown }).status)
      ?? normalizeText((error as Error & { statusCode?: unknown }).statusCode);
    const code = normalizeText((error as Error & { code?: unknown }).code);
    const parts: string[] = [];
    if (status) parts.push(`status: ${status}`);
    if (code) parts.push(`code: ${code}`);

    const message = extracted ?? error.message;
    if (message.toLowerCase().startsWith(provider.toLowerCase())) {
      return message;
    }
    return parts.length > 0 ? `${basePrefix}: ${message} (${parts.join(', ')})` : `${basePrefix}: ${message}`;
  }

  if (isObject(error)) {
    const message =
      extractNestedApiMessage(normalizeText(error.message) ?? '') ??
      normalizeText(error.message) ??
      normalizeText(error.error) ??
      normalizeText(error.details);
    if (message) {
      return `${basePrefix}: ${message}`;
    }
    try {
      return `${basePrefix}: ${JSON.stringify(error)}`;
    } catch {
      return basePrefix;
    }
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    const extracted = extractNestedApiMessage(error) ?? error.trim();
    return `${basePrefix}: ${extracted}`;
  }

  return basePrefix;
}

function extractNestedApiMessage(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = tryParseJson(trimmed) ?? tryParseJson(extractJsonObjectCandidate(trimmed));
  if (!parsed) {
    return null;
  }

  const errorObj = isObject(parsed.error)
    ? parsed.error
    : isObject(parsed)
    ? parsed
    : null;
  const message = normalizeText(errorObj?.message) ?? normalizeText(parsed.message);
  if (!message) {
    return null;
  }

  const type = normalizeText(errorObj?.type);
  const code = normalizeText(errorObj?.code);
  const param = normalizeText(errorObj?.param);
  const details: string[] = [];
  if (type) details.push(`type: ${type}`);
  if (param) details.push(`param: ${param}`);
  if (code) details.push(`code: ${code}`);
  return details.length > 0 ? `${message} (${details.join(', ')})` : message;
}

function extractJsonObjectCandidate(value: string): string | null {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  return value.slice(start, end + 1);
}

function tryParseJson(value: string | null): JsonObject | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readResponseHeader(response: Response, names: string[]): string | null {
  for (const name of names) {
    const value = response.headers.get(name);
    const normalized = normalizeText(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
