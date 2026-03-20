function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sanitizeHref(url: string): string | null {
  const trimmed = url.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function renderInlineMarkdown(source: string): string {
  const codeSegments: string[] = [];
  const withCodePlaceholders = source.replace(/`([^`]+)`/g, (_match, code: string) => {
    const placeholder = `@@CODE_${codeSegments.length}@@`;
    codeSegments.push(`<code>${escapeHtml(code)}</code>`);
    return placeholder;
  });

  let html = escapeHtml(withCodePlaceholders);

  html = html.replace(/\[([^\]]+)\]\(((?:[^()\s]+|\([^)]*\))+)\)/g, (_match, label: string, href: string) => {
    const safeHref = sanitizeHref(href);
    const safeLabel = renderInlineMarkdown(label);
    if (!safeHref) {
      return safeLabel;
    }
    return `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noreferrer">${safeLabel}</a>`;
  });

  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  html = html.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');

  return html.replace(/@@CODE_(\d+)@@/g, (_match, index: string) => codeSegments[Number(index)] ?? '');
}

function renderParagraph(lines: string[]): string {
  return `<p>${renderInlineMarkdown(lines.join(' '))}</p>`;
}

function renderList(lines: string[]): string {
  const isOrdered = /^\d+\.\s/.test(lines[0] ?? '');
  const tag = isOrdered ? 'ol' : 'ul';
  const items = lines
    .map((line) => line.replace(isOrdered ? /^\d+\.\s+/ : /^[-*]\s+/, ''))
    .map((line) => `<li>${renderInlineMarkdown(line)}</li>`)
    .join('');
  return `<${tag}>${items}</${tag}>`;
}

function renderBlockquote(lines: string[]): string {
  const content = lines.map((line) => line.replace(/^>\s?/, '')).join('\n');
  return `<blockquote>${renderMarkdownToHtml(content)}</blockquote>`;
}

function renderHeading(line: string): string {
  const match = /^(#{1,6})\s+(.*)$/.exec(line);
  if (!match) {
    return renderParagraph([line]);
  }
  const level = Math.min(match[1].length, 6);
  return `<h${level}>${renderInlineMarkdown(match[2])}</h${level}>`;
}

function renderCodeBlock(language: string | null, lines: string[]): string {
  const className = language && language.trim().length > 0
    ? ` class="language-${escapeHtml(language.trim().toLowerCase())}"`
    : '';
  return `<pre><code${className}>${escapeHtml(lines.join('\n'))}</code></pre>`;
}

export function renderMarkdownToHtml(markdown: string): string {
  const normalized = markdown.replace(/\r\n?/g, '\n').trim();
  if (normalized.length === 0) {
    return '';
  }

  const lines = normalized.split('\n');
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const fenceMatch = /^```([\w-]+)?\s*$/.exec(line);
    if (fenceMatch) {
      const language = fenceMatch[1] ?? null;
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index] ?? '')) {
        codeLines.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(renderCodeBlock(language, codeLines));
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      blocks.push(renderHeading(line));
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) {
        quoteLines.push(lines[index] ?? '');
        index += 1;
      }
      blocks.push(renderBlockquote(quoteLines));
      continue;
    }

    if (/^([-*]\s+|\d+\.\s+)/.test(line)) {
      const listLines: string[] = [];
      while (index < lines.length && /^([-*]\s+|\d+\.\s+)/.test(lines[index] ?? '')) {
        listLines.push(lines[index] ?? '');
        index += 1;
      }
      blocks.push(renderList(listLines));
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      (lines[index] ?? '').trim().length > 0 &&
      !/^```/.test(lines[index] ?? '') &&
      !/^#{1,6}\s+/.test(lines[index] ?? '') &&
      !/^>\s?/.test(lines[index] ?? '') &&
      !/^([-*]\s+|\d+\.\s+)/.test(lines[index] ?? '')
    ) {
      paragraphLines.push(lines[index] ?? '');
      index += 1;
    }
    blocks.push(renderParagraph(paragraphLines));
  }

  return blocks.join('');
}
