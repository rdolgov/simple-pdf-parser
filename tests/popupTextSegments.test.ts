import { describe, expect, it } from 'vitest';

import { parsePopupTextSegments } from '../testApp/src/utils/popupTextSegments';

describe('parsePopupTextSegments', () => {
  it('extracts malformed PDF URLs into clickable segments', () => {
    const input =
      'The test set is available atwww.fit.vutbr.cz/ imikolov/rnnlm/word-test.v1.txt˜http://ronan.collobert.com/senna/http://metaoptimize.com/projects/wordreprs/http://www.fit.vutbr.cz/ imikolov/rnnlm/˜http://ai.stanford.edu/ ehhuang/˜';

    const segments = parsePopupTextSegments(input);
    const urls = segments.filter((segment) => segment.type === 'url');

    expect(segments[0]).toEqual({
      type: 'text',
      content: 'The test set is available at '
    });
    expect(urls).toEqual([
      {
        type: 'url',
        content: 'www.fit.vutbr.cz/imikolov/rnnlm/word-test.v1.txt',
        href: 'https://www.fit.vutbr.cz/imikolov/rnnlm/word-test.v1.txt'
      },
      {
        type: 'url',
        content: 'http://ronan.collobert.com/senna/',
        href: 'http://ronan.collobert.com/senna/'
      },
      {
        type: 'url',
        content: 'http://metaoptimize.com/projects/wordreprs/',
        href: 'http://metaoptimize.com/projects/wordreprs/'
      },
      {
        type: 'url',
        content: 'http://www.fit.vutbr.cz/imikolov/rnnlm/',
        href: 'http://www.fit.vutbr.cz/imikolov/rnnlm/'
      },
      {
        type: 'url',
        content: 'http://ai.stanford.edu/ehhuang/',
        href: 'http://ai.stanford.edu/ehhuang/'
      }
    ]);
  });

  it('keeps citation segments clickable alongside URLs', () => {
    const input = 'See [12] at www.example.com/path/to/file.txt for details.';

    expect(parsePopupTextSegments(input)).toEqual([
      { type: 'text', content: 'See ' },
      { type: 'citation', content: '[12]', numbers: ['12'] },
      { type: 'text', content: ' at ' },
      {
        type: 'url',
        content: 'www.example.com/path/to/file.txt',
        href: 'https://www.example.com/path/to/file.txt'
      },
      { type: 'text', content: ' for details.' }
    ]);
  });
});
