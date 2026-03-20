export const DEFAULT_GEMINI_TEXT_MODEL = 'gemini-3-pro-preview';
export const DEFAULT_GEMINI_BINARY_INPUT_MODEL = 'gemini-3-pro-image-preview';

export function resolveGeminiTextModel(configuredModel?: string | null): string {
  const normalized = normalizeModel(configuredModel);
  if (!normalized || /^gpt-/i.test(normalized)) {
    return DEFAULT_GEMINI_TEXT_MODEL;
  }
  return normalized;
}

export function resolveGeminiBinaryInputModel(configuredModel?: string | null): string {
  const normalized = normalizeModel(configuredModel);
  if (!normalized || /^gpt-/i.test(normalized)) {
    return DEFAULT_GEMINI_BINARY_INPUT_MODEL;
  }
  if (looksLikeExplicitBinaryInputModel(normalized)) {
    return normalized;
  }
  return DEFAULT_GEMINI_BINARY_INPUT_MODEL;
}

function normalizeModel(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function looksLikeExplicitBinaryInputModel(model: string): boolean {
  const normalized = model.replace(/^models\//i, '').toLowerCase();
  return (
    normalized.includes('image') ||
    normalized.includes('vision') ||
    normalized.includes('multimodal') ||
    normalized.includes('omni')
  );
}
