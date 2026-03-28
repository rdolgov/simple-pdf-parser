import { describe, expect, it } from 'vitest';

import {
  buildPrioritizedSelectionChatContext,
  resolveTextSelectionAnnotationBounds,
  resolveTextSelectionLocalBounds,
  resolveTextSelectionToolbarPosition
} from '../testApp/src/utils/textSelectionActions';

describe('textSelectionActions', () => {
  it('resolves the combined local bounds of multi-line selection fragments', () => {
    expect(resolveTextSelectionLocalBounds([
      { left: 24, top: 18, width: 72, height: 20 },
      { left: 16, top: 44, width: 54, height: 18 }
    ])).toEqual({
      left: 16,
      top: 18,
      width: 80,
      height: 44
    });
  });

  it('anchors the selection toolbar to the first visible selection fragment', () => {
    expect(resolveTextSelectionToolbarPosition([
      { left: 42, top: 20, width: 80, height: 18 },
      { left: 18, top: 46, width: 64, height: 18 }
    ])).toEqual({
      left: 130,
      top: 2
    });
  });

  it('converts local selection fragments back into PDF annotation bounds', () => {
    expect(resolveTextSelectionAnnotationBounds({
      fragments: [
        { left: 30, top: 16, width: 40, height: 18 },
        { left: 18, top: 42, width: 60, height: 16 }
      ],
      blockBounds: { minX: 100, minY: 200, maxX: 220, maxY: 280 },
      scaleX: 2,
      scaleY: 2,
      padding: 12
    })).toEqual({
      minX: 103,
      minY: 257,
      maxX: 133,
      maxY: 278
    });
  });

  it('builds a chat context that prioritizes the selected excerpt over surrounding text', () => {
    expect(buildPrioritizedSelectionChatContext({
      title: 'Methods',
      selectedText: 'the recurrent layer',
      surroundingText: 'This paragraph explains the recurrent layer and the training setup.'
    })).toBe(
      'Methods\n\n' +
      'Primary selection (answer this first):\n' +
      'the recurrent layer\n\n' +
      'Secondary surrounding context from the same document (use only when it helps explain the selection):\n' +
      'This paragraph explains the recurrent layer and the training setup.'
    );
  });

  it('omits duplicate secondary context when the selected text already matches it', () => {
    expect(buildPrioritizedSelectionChatContext({
      selectedText: 'the recurrent layer',
      surroundingText: 'the recurrent layer'
    })).toBe(
      'Primary selection (answer this first):\n' +
      'the recurrent layer'
    );
  });
});
