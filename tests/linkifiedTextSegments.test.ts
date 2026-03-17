import { describe, expect, it } from 'vitest';

import {
  buildLinkifiedTextFromLines,
  parseLinkifiedTextSegments
} from '../src/html/linkifiedTextSegments.js';

describe('linkified text segments', () => {
  it('merges wrapped URL lines before linkification', () => {
    const text = buildLinkifiedTextFromLines([
      { text: 'The code is available at https://github.com/' },
      { text: 'tensorflow/tensor2tensor.' }
    ]);

    expect(text).toBe('The code is available at https://github.com/tensorflow/tensor2tensor.');
    expect(parseLinkifiedTextSegments(text)).toEqual([
      { type: 'text', content: 'The code is available at ' },
      {
        type: 'url',
        content: 'https://github.com/tensorflow/tensor2tensor',
        href: 'https://github.com/tensorflow/tensor2tensor'
      },
      { type: 'text', content: '.' }
    ]);
  });
});
