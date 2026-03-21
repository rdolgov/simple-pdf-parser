import { describe, expect, it } from 'vitest';
import {
  decideStructuredDetectSplit,
  shouldRetryStructuredDetectAsSplit
} from '../server/src/structuredDetectSplitPolicy';

describe('structuredDetectSplitPolicy', () => {
  it('skips splitting when the pdf is at or below the configured byte threshold', () => {
    expect(decideStructuredDetectSplit({
      fileSizeBytes: 512_000,
      minSplitBytes: 512_000,
      pageCount: 2,
      minSplitPages: 8
    })).toEqual({
      shouldSplit: false,
      reason: 'file-too-small'
    });
  });

  it('allows splitting when the pdf is larger than the configured byte threshold', () => {
    expect(decideStructuredDetectSplit({
      fileSizeBytes: 512_001,
      minSplitBytes: 512_000,
      pageCount: 2,
      minSplitPages: 8
    })).toEqual({
      shouldSplit: true,
      reason: 'eligible'
    });
  });

  it('allows splitting when the pdf has many pages even if the file bytes are small', () => {
    expect(decideStructuredDetectSplit({
      fileSizeBytes: 228_716,
      minSplitBytes: 1_048_576,
      pageCount: 12,
      minSplitPages: 8
    })).toEqual({
      shouldSplit: true,
      reason: 'eligible'
    });
  });

  it('skips splitting for a single-page pdf even when the file is small', () => {
    expect(decideStructuredDetectSplit({
      fileSizeBytes: 128_000,
      minSplitBytes: 1_048_576,
      pageCount: 1,
      minSplitPages: 8
    })).toEqual({
      shouldSplit: false,
      reason: 'page-count-too-small'
    });
  });

  it('retries as split when Gemini returns a no-text recitation-style response', () => {
    expect(
      shouldRetryStructuredDetectAsSplit(
        new Error(
          'Gemini response did not include text content (model=gemini-3-pro-image-preview; candidates=1; directText=0; nestedText=0; candidateSummary=RECITATION:none)'
        ),
        12
      )
    ).toBe(true);
  });
});
