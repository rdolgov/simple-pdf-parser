export interface StructuredDetectSplitDecision {
  shouldSplit: boolean;
  reason: 'file-too-small' | 'eligible';
}

export function decideStructuredDetectSplit(input: {
  fileSizeBytes: number;
  minSplitBytes: number;
}): StructuredDetectSplitDecision {
  if (input.fileSizeBytes <= input.minSplitBytes) {
    return {
      shouldSplit: false,
      reason: 'file-too-small'
    };
  }

  return {
    shouldSplit: true,
    reason: 'eligible'
  };
}
