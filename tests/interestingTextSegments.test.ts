import { describe, expect, it } from 'vitest';

import {
  buildInterestingTextFromLines,
  hasInterestingTextSegments,
  parseInterestingTextSegments,
  parseInterestingTextSegmentsFromLines
} from '../testApp/src/utils/interestingTextSegments';

describe('interestingTextSegments', () => {
  it('merges wrapped URLs across highlight lines before building interactive segments', () => {
    const lines = [
      { text: 'Code is available at https://github.com/tensorflow/' },
      { text: 'tensor2tensor for training.' }
    ];

    expect(buildInterestingTextFromLines(lines)).toBe(
      'Code is available at https://github.com/tensorflow/tensor2tensor for training.'
    );

    expect(parseInterestingTextSegmentsFromLines(lines)).toEqual([
      { type: 'text', content: 'Code is available at ' },
      {
        type: 'entity',
        entity: {
          kind: 'url',
          content: 'https://github.com/tensorflow/tensor2tensor',
          href: 'https://github.com/tensorflow/tensor2tensor',
          source: 'pattern'
        }
      },
      { type: 'text', content: ' for training.' }
    ]);
  });

  it('detects citations alongside clickable links from normalized text', () => {
    const segments = parseInterestingTextSegments('See [12-13] and www.example.com/docs for details.');

    expect(hasInterestingTextSegments(segments)).toBe(true);
    expect(segments).toEqual([
      { type: 'text', content: 'See ' },
      {
        type: 'entity',
        entity: {
          kind: 'citation',
          content: '[12-13]',
          numbers: ['12', '13'],
          source: 'pattern'
        }
      },
      { type: 'text', content: ' and ' },
      {
        type: 'entity',
        entity: {
          kind: 'url',
          content: 'www.example.com/docs',
          href: 'https://www.example.com/docs',
          source: 'pattern'
        }
      },
      { type: 'text', content: ' for details.' }
    ]);
  });
});
