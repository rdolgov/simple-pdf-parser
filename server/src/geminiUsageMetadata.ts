export interface GeminiUsageMetadata {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export function extractGeminiUsageMetadata(body: Buffer): GeminiUsageMetadata | null {
  const payload = tryParseJson(body);
  if (!payload) {
    return null;
  }

  const usageRecord = readUsageRecord(payload);
  if (!usageRecord) {
    return null;
  }

  const promptTokenCount = readCount(usageRecord.promptTokenCount);
  const cachedContentTokenCount = readCount(usageRecord.cachedContentTokenCount);
  const candidatesTokenCount = readCount(usageRecord.candidatesTokenCount);
  const thoughtsTokenCount = readCount(usageRecord.thoughtsTokenCount);
  const totalTokenCount = readCount(usageRecord.totalTokenCount);

  const inputTokens = promptTokenCount + cachedContentTokenCount;
  const outputTokens = candidatesTokenCount + thoughtsTokenCount;
  const totalTokens = totalTokenCount > 0 ? totalTokenCount : inputTokens + outputTokens;

  if (inputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens
  };
}

function tryParseJson(body: Buffer): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body.toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function readUsageRecord(payload: Record<string, unknown>): Record<string, unknown> | null {
  const direct = asRecord(payload.usageMetadata);
  if (direct) {
    return direct;
  }

  const nestedResponse = asRecord(payload.response);
  if (nestedResponse) {
    const nestedUsage = asRecord(nestedResponse.usageMetadata);
    if (nestedUsage) {
      return nestedUsage;
    }
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}
