import { describe, expect, it } from 'vitest';

import {
  buildCodexExecPrompt,
  createCodexResponsesPayload,
  parseCodexResponsesRequest
} from '../server/src/codexResponses';

describe('codexResponses', () => {
  it('parses simple string inputs into a single user prompt', () => {
    const parsed = parseCodexResponsesRequest(Buffer.from(JSON.stringify({
      model: 'gpt-5-codex',
      input: 'Summarize this document'
    }), 'utf8'));

    expect(parsed.model).toBe('gpt-5-codex');
    expect(parsed.instructions).toBeUndefined();
    expect(parsed.messages).toEqual([
      {
        role: 'user',
        textParts: ['Summarize this document'],
        attachments: []
      }
    ]);
  });

  it('parses OpenAI-style input parts into text and binary attachments', () => {
    const parsed = parseCodexResponsesRequest(Buffer.from(JSON.stringify({
      instructions: 'Return JSON only.',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Analyze the attached inputs.' },
            { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' },
            { type: 'input_file', filename: 'paper.pdf', file_data: 'data:application/pdf;base64,cGRm' }
          ]
        }
      ]
    }), 'utf8'));

    expect(parsed.instructions).toBe('Return JSON only.');
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]!.textParts).toEqual(['Analyze the attached inputs.']);
    expect(parsed.messages[0]!.attachments).toHaveLength(2);
    expect(parsed.messages[0]!.attachments[0]).toMatchObject({
      kind: 'image',
      filename: 'image.png',
      mimeType: 'image/png'
    });
    expect(parsed.messages[0]!.attachments[1]).toMatchObject({
      kind: 'file',
      filename: 'paper.pdf',
      mimeType: 'application/pdf'
    });
    expect(parsed.messages[0]!.attachments[0]!.data.toString('utf8')).toBe('hello');
    expect(parsed.messages[0]!.attachments[1]!.data.toString('utf8')).toBe('pdf');
  });

  it('renders a codex exec prompt with attachment paths and instructions', () => {
    const parsed = parseCodexResponsesRequest(Buffer.from(JSON.stringify({
      instructions: 'Return only valid JSON.',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Extract the table.' },
            { type: 'input_file', filename: 'table.pdf', file_data: 'data:application/pdf;base64,cGRm' }
          ]
        }
      ]
    }), 'utf8'));

    const prompt = buildCodexExecPrompt(parsed, [
      {
        role: 'user',
        textParts: ['Extract the table.'],
        attachments: [
          {
            id: 'file-1',
            kind: 'file',
            filename: 'table.pdf',
            mimeType: 'application/pdf',
            path: '/tmp/codex/table.pdf'
          }
        ]
      }
    ]);

    expect(prompt).toContain('System instructions:\nReturn only valid JSON.');
    expect(prompt).toContain('User message 1:');
    expect(prompt).toContain('Extract the table.');
    expect(prompt).toContain('/tmp/codex/table.pdf');
    expect(prompt).toContain('Use the local paths above directly');
  });

  it('wraps codex output in an OpenAI-compatible responses payload', () => {
    const payload = createCodexResponsesPayload('Final answer', 'gpt-5-codex');

    expect(payload.model).toBe('gpt-5-codex');
    expect(payload.status).toBe('completed');
    expect(payload.output_text).toBe('Final answer');
    expect(payload.output).toEqual([
      {
        id: expect.any(String),
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: 'Final answer'
          }
        ]
      }
    ]);
  });
});
