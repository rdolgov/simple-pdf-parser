import { describe, expect, it } from 'vitest';

import { summarizeCodexResponsesBody } from '../server/src/codexRequestIntents';

describe('codexRequestIntents', () => {
  it('classifies interactive widget requests from the protocol marker', () => {
    const summary = summarizeCodexResponsesBody(Buffer.from(JSON.stringify({
      model: 'gpt-5.2',
      input: 'Create widget.\nProtocol marker: interactive_widget_v1'
    }), 'utf8'));

    expect(summary.intent).toBe('interactive-widget');
    expect(summary.model).toBe('gpt-5.2');
    expect(summary.textChars).toBeGreaterThan(0);
  });

  it('classifies logical structure requests from the section-grouping prompt', () => {
    const summary = summarizeCodexResponsesBody(Buffer.from(JSON.stringify({
      input: 'You are segmenting ordered PDF paragraphs into logical reading units for a reader UI.\nSchema: {"groups":[{"title":"short optional label","blockIds":["id1","id2"]}]}'
    }), 'utf8'));

    expect(summary.intent).toBe('logical-structure');
  });
});
