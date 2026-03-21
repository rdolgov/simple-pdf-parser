import { describe, expect, it } from 'vitest';
import { resolveLogicalHoverSegment } from '../testApp/src/utils/logicalHoverSegment';

describe('logicalHoverSegment', () => {
  it('clips a logical hover segment at the next sibling heading on the same page', () => {
    const page = {
      number: 5,
      width: 612,
      height: 792,
      content: [
        headingBlock('3.3 Position-wise Feed-Forward Networks', bounds(72, 700, 420, 724)),
        paragraphBlock('The feed-forward block contains two learned linear projections.', bounds(72, 654, 520, 690)),
        paragraphBlock('The inner layer expands to a larger hidden dimension.', bounds(72, 610, 520, 646)),
        headingBlock('3.4 Embeddings and Softmax', bounds(72, 560, 320, 584)),
        paragraphBlock('Embeddings convert tokens to vectors.', bounds(72, 520, 520, 554)),
        headingBlock('3.5 Positional Encoding', bounds(72, 470, 310, 494)),
        paragraphBlock('Positional signals are added to the embeddings.', bounds(72, 430, 520, 464))
      ]
    };

    const segment = resolveLogicalHoverSegment({
      page,
      blockIndexes: [0, 1, 2, 3, 4, 5, 6],
      selectedBlockIndex: 1
    });

    expect(segment).not.toBeNull();
    expect(segment?.blockIndexes).toEqual([0, 1, 2]);
    expect(segment?.text).toContain('3.3 Position-wise Feed-Forward Networks');
    expect(segment?.text).not.toContain('3.4 Embeddings and Softmax');
    expect(segment?.text).not.toContain('3.5 Positional Encoding');
  });

  it('keeps the whole segment when there is no later local heading boundary', () => {
    const page = {
      number: 1,
      width: 612,
      height: 792,
      content: [
        headingBlock('Overview', bounds(72, 700, 220, 724)),
        paragraphBlock('First paragraph.', bounds(72, 654, 520, 690)),
        paragraphBlock('Second paragraph.', bounds(72, 610, 520, 646))
      ]
    };

    const segment = resolveLogicalHoverSegment({
      page,
      blockIndexes: [0, 1, 2],
      selectedBlockIndex: 2
    });

    expect(segment?.blockIndexes).toEqual([0, 1, 2]);
  });
});

function headingBlock(text: string, blockBounds: ReturnType<typeof bounds>) {
  return {
    type: 'heading' as const,
    level: 2,
    text,
    lines: [],
    spans: [],
    bounds: blockBounds,
    confidence: 0.9
  };
}

function paragraphBlock(text: string, blockBounds: ReturnType<typeof bounds>) {
  return {
    type: 'paragraph' as const,
    text,
    lines: [],
    spans: [],
    bounds: blockBounds,
    confidence: 0.8
  };
}

function bounds(minX: number, minY: number, maxX: number, maxY: number) {
  return { minX, minY, maxX, maxY };
}
