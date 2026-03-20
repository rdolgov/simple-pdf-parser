import { describe, expect, it } from 'vitest';

import { renderMarkdownToHtml } from '../testApp/src/utils/markdownRenderer';

describe('markdownRenderer', () => {
  it('renders common markdown blocks and inline formatting', () => {
    const html = renderMarkdownToHtml([
      '# Title',
      '',
      'A **bold** line with `code` and a [link](https://example.com).',
      '',
      '- first',
      '- second',
      '',
      '```js',
      'const value = 1;',
      '```'
    ].join('\n'));

    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('<ul><li>first</li><li>second</li></ul>');
    expect(html).toContain('<pre><code class="language-js">const value = 1;</code></pre>');
  });

  it('drops unsafe link protocols', () => {
    const html = renderMarkdownToHtml('[bad](javascript:alert(1))');

    expect(html).not.toContain('href=');
    expect(html).toContain('<p>bad</p>');
  });

  it('renders inline and block LaTeX with katex markup', () => {
    const html = renderMarkdownToHtml([
      'The scaling factor is $\\frac{1}{\\sqrt{d_k}}$.',
      '',
      '$$',
      '\\sum_i x_i',
      '$$'
    ].join('\n'));

    expect(html).toContain('class="katex"');
    expect(html).toContain('mini-chat-math-block');
  });
});
