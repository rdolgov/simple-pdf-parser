import { describe, expect, it } from 'vitest';
import { buildMergedTextHighlightBlockData } from '../testApp/src/utils/highlightUtils';

describe('highlightUtils', () => {
  it('builds one merged highlight region from multiple paragraph blocks', () => {
    const blocks = [
      paragraphBlock('First paragraph line.', 72, 640, 400, 664, 16),
      paragraphBlock('Second paragraph line.', 72, 580, 420, 604, 16)
    ];

    const merged = buildMergedTextHighlightBlockData(blocks);

    expect(merged).not.toBeNull();
    expect(merged?.bounds).toEqual({
      minX: 72,
      minY: 580,
      maxX: 420,
      maxY: 664
    });
    expect(merged?.lines).toHaveLength(2);
    expect(merged?.lines.map((line) => line.text)).toEqual([
      'First paragraph line.',
      'Second paragraph line.'
    ]);
  });
});

function paragraphBlock(text: string, minX: number, minY: number, maxX: number, maxY: number, fontSize: number) {
  return {
    type: 'paragraph' as const,
    text,
    lines: [
      {
        text,
        bounds: { minX, minY, maxX, maxY },
        lineHeight: maxY - minY,
        spans: [
          {
            text,
            fontSize,
            font: 'Times',
            bounds: { minX, minY, maxX, maxY }
          }
        ]
      }
    ],
    spans: [
      {
        text,
        fontSize,
        font: 'Times',
        bounds: { minX, minY, maxX, maxY }
      }
    ],
    bounds: { minX, minY, maxX, maxY },
    confidence: 0.8
  };
}
