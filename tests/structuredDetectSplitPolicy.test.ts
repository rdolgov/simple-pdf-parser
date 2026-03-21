import { describe, expect, it } from 'vitest';
import { decideStructuredDetectSplit } from '../server/src/structuredDetectSplitPolicy';

describe('structuredDetectSplitPolicy', () => {
  it('skips splitting when the pdf is at or below the configured byte threshold', () => {
    expect(decideStructuredDetectSplit({
      fileSizeBytes: 512_000,
      minSplitBytes: 512_000
    })).toEqual({
      shouldSplit: false,
      reason: 'file-too-small'
    });
  });

  it('allows splitting when the pdf is larger than the configured byte threshold', () => {
    expect(decideStructuredDetectSplit({
      fileSizeBytes: 512_001,
      minSplitBytes: 512_000
    })).toEqual({
      shouldSplit: true,
      reason: 'eligible'
    });
  });
});
