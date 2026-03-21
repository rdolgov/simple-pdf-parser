export interface StructuredDetectSplitDecision {
  shouldSplit: boolean;
  reason: 'file-too-small' | 'page-count-too-small' | 'eligible';
}

export function decideStructuredDetectSplit(input: {
  fileSizeBytes: number;
  minSplitBytes: number;
  pageCount: number;
  minSplitPages: number;
}): StructuredDetectSplitDecision {
  if (input.pageCount >= input.minSplitPages) {
    return {
      shouldSplit: true,
      reason: 'eligible'
    };
  }

  if (input.fileSizeBytes > input.minSplitBytes) {
    return {
      shouldSplit: true,
      reason: 'eligible'
    };
  }

  if (input.pageCount <= 1) {
    return {
      shouldSplit: false,
      reason: 'page-count-too-small'
    };
  }

  return {
    shouldSplit: false,
    reason: 'file-too-small'
  };
}

export function shouldRetryStructuredDetectAsSplit(error: unknown, pageCount: number): boolean {
  if (pageCount <= 1) {
    return false;
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  const normalized = message.toLowerCase();
  return normalized.includes('did not include text content') || normalized.includes('recitation');
}
