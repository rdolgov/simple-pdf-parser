export type AiDetectionMode = 'manual' | 'structured' | 'all';

export const AI_DETECTION_QUERY_PARAM = 'aiDetection';

export function parseAiDetectionMode(search: string): AiDetectionMode {
  const params = new URLSearchParams(search);
  const rawValue = params.get(AI_DETECTION_QUERY_PARAM)?.trim().toLowerCase();

  if (
    rawValue === 'manual' ||
    rawValue === 'off' ||
    rawValue === 'false' ||
    rawValue === '0' ||
    rawValue === 'disabled' ||
    rawValue === 'none' ||
    rawValue === 'render' ||
    rawValue === 'render-only'
  ) {
    return 'manual';
  }

  if (rawValue === 'structured' || rawValue === 'extract') {
    return 'structured';
  }

  if (!rawValue || rawValue === 'all' || rawValue === 'true' || rawValue === '1' || rawValue === 'auto' || rawValue === 'on') {
    return 'all';
  }

  return 'all';
}

export function shouldAutoRunStructuredExtract(mode: AiDetectionMode): boolean {
  return mode === 'structured' || mode === 'all';
}

export function describeAiDetectionMode(mode: AiDetectionMode): string {
  switch (mode) {
    case 'structured':
      return `Auto-run one combined AI extract via ?${AI_DETECTION_QUERY_PARAM}=structured. Use ?${AI_DETECTION_QUERY_PARAM}=off for renderer-only checks.`;
    case 'all':
      return `AI extraction starts automatically. Use ?${AI_DETECTION_QUERY_PARAM}=off for renderer-only checks without AI overlays.`;
    case 'manual':
    default:
      return `AI extraction is disabled by URL. Use ?${AI_DETECTION_QUERY_PARAM}=off for renderer-only checks, or remove the flag to restore auto-run.`;
  }
}
