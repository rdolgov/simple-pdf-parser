export type AiDetectionMode = 'manual' | 'structured' | 'all';

export const AI_DETECTION_QUERY_PARAM = 'aiDetection';

export function parseAiDetectionMode(search: string): AiDetectionMode {
  const params = new URLSearchParams(search);
  const rawValue = params.get(AI_DETECTION_QUERY_PARAM)?.trim().toLowerCase();

  if (!rawValue || rawValue === 'manual' || rawValue === 'off' || rawValue === 'false' || rawValue === '0') {
    return 'manual';
  }

  if (rawValue === 'structured' || rawValue === 'extract') {
    return 'structured';
  }

  if (rawValue === 'all' || rawValue === 'true' || rawValue === '1' || rawValue === 'auto' || rawValue === 'on') {
    return 'all';
  }

  return 'manual';
}

export function shouldAutoRunStructuredExtract(mode: AiDetectionMode): boolean {
  return mode === 'structured' || mode === 'all';
}

export function shouldAutoRunLayoutDetection(mode: AiDetectionMode): boolean {
  return mode === 'all';
}

export function describeAiDetectionMode(mode: AiDetectionMode): string {
  switch (mode) {
    case 'structured':
      return `Auto-run structured extract only via ?${AI_DETECTION_QUERY_PARAM}=structured`;
    case 'all':
      return `Auto-run structured extract and layout detection via ?${AI_DETECTION_QUERY_PARAM}=all`;
    case 'manual':
    default:
      return `Manual by default. Use ?${AI_DETECTION_QUERY_PARAM}=structured or ?${AI_DETECTION_QUERY_PARAM}=all to auto-run.`;
  }
}
