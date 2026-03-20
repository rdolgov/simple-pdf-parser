import { describe, expect, it } from 'vitest';

import {
  describeAiDetectionMode,
  parseAiDetectionMode,
  shouldAutoRunStructuredExtract
} from '../testApp/src/utils/aiDetectionActivation';

describe('aiDetectionActivation', () => {
  it('defaults to manual mode when the query parameter is missing or disabled', () => {
    expect(parseAiDetectionMode('')).toBe('manual');
    expect(parseAiDetectionMode('?aiDetection=manual')).toBe('manual');
    expect(parseAiDetectionMode('?aiDetection=0')).toBe('manual');
  });

  it('supports structured-only and full auto-run modes', () => {
    expect(parseAiDetectionMode('?aiDetection=structured')).toBe('structured');
    expect(parseAiDetectionMode('?aiDetection=all')).toBe('all');
    expect(parseAiDetectionMode('?aiDetection=true')).toBe('all');
  });

  it('maps auto-run flags to the expected detector groups', () => {
    expect(shouldAutoRunStructuredExtract('manual')).toBe(false);
    expect(shouldAutoRunStructuredExtract('structured')).toBe(true);
    expect(shouldAutoRunStructuredExtract('all')).toBe(true);
  });

  it('describes the current mode for the UI banner', () => {
    expect(describeAiDetectionMode('manual')).toContain('combined AI extract');
    expect(describeAiDetectionMode('all')).toContain('combined AI extract');
  });
});
