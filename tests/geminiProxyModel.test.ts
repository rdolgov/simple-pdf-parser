import { describe, expect, it } from 'vitest';

import { resolveGeminiProxyUpstreamPath } from '../server/src/geminiProxyModel';

describe('resolveGeminiProxyUpstreamPath', () => {
  it('uses the configured text model for generateContent text requests', () => {
    const selection = resolveGeminiProxyUpstreamPath(
      'v1beta/models/gemini-3-pro-preview:generateContent',
      Buffer.from(JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: 'hello' }]
          }
        ]
      }), 'utf8'),
      {
        textModel: 'gemini-3-flash-preview'
      }
    );

    expect(selection.mode).toBe('text');
    expect(selection.requestedModel).toBe('gemini-3-pro-preview');
    expect(selection.selectedModel).toBe('gemini-3-flash-preview');
    expect(selection.upstreamPath).toBe('v1beta/models/gemini-3-flash-preview:generateContent');
  });

  it('uses the configured binary model for inline pdf/image requests when provided', () => {
    const selection = resolveGeminiProxyUpstreamPath(
      'v1beta/models/gemini-3-pro-preview:generateContent',
      Buffer.from(JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'application/pdf',
                  data: 'cGRm'
                }
              },
              { text: 'extract this pdf' }
            ]
          }
        ]
      }), 'utf8'),
      {
        textModel: 'gemini-3-flash-preview',
        binaryInputModel: 'gemini-3-pro-image-preview'
      }
    );

    expect(selection.mode).toBe('binary');
    expect(selection.selectedModel).toBe('gemini-3-pro-image-preview');
    expect(selection.upstreamPath).toBe('v1beta/models/gemini-3-pro-image-preview:generateContent');
  });

  it('uses the configured binary model for image-generation requests that ask for IMAGE modality', () => {
    const selection = resolveGeminiProxyUpstreamPath(
      'v1beta/models/gemini-3-pro-preview:generateContent',
      Buffer.from(JSON.stringify({
        generationConfig: {
          responseModalities: ['IMAGE']
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Create a chart image.' }]
          }
        ]
      }), 'utf8'),
      {
        textModel: 'gemini-3-flash-preview',
        binaryInputModel: 'gemini-3-pro-image-preview'
      }
    );

    expect(selection.mode).toBe('binary');
    expect(selection.selectedModel).toBe('gemini-3-pro-image-preview');
    expect(selection.upstreamPath).toBe('v1beta/models/gemini-3-pro-image-preview:generateContent');
  });

  it('preserves the requested image model when no binary override is configured', () => {
    const selection = resolveGeminiProxyUpstreamPath(
      'v1alpha/models/gemini-3-pro-image-preview:generateContent',
      Buffer.from(JSON.stringify({
        generationConfig: {
          responseModalities: ['IMAGE']
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Create a chart image.' }]
          }
        ]
      }), 'utf8'),
      {
        textModel: 'gemini-3-flash-preview'
      }
    );

    expect(selection.mode).toBe('binary');
    expect(selection.selectedModel).toBe('gemini-3-pro-image-preview');
    expect(selection.upstreamPath).toBe('v1alpha/models/gemini-3-pro-image-preview:generateContent');
  });

  it('leaves non-generateContent routes unchanged', () => {
    const selection = resolveGeminiProxyUpstreamPath(
      'v1beta/models/gemini-embedding-001:embedContent',
      Buffer.from('{}', 'utf8'),
      {
        textModel: 'gemini-3-flash-preview'
      }
    );

    expect(selection.mode).toBe('passthrough');
    expect(selection.upstreamPath).toBe('v1beta/models/gemini-embedding-001:embedContent');
  });
});
