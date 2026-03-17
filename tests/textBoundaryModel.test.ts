import { describe, expect, it } from 'vitest';

import { refineLexicalTextBoundaries } from '../src/parser/textBoundaryModel.js';
import type { PDFTextItem } from '../src/types.js';

function buildItem(
  text: string,
  glyphSpans: NonNullable<PDFTextItem['glyphSpans']>,
  minY: number
): PDFTextItem {
  const width = glyphSpans.reduce((sum, span) => sum + span.advance, 0);
  return {
    text,
    font: 'Times New Roman',
    fontSize: 10,
    bounds: {
      minX: 100,
      minY,
      maxX: 100 + width,
      maxY: minY + 10
    },
    baselineStart: { x: 100, y: minY + 2 },
    baselineEnd: { x: 100 + width, y: minY + 2 },
    glyphSpans
  };
}

function wordGlyphs(text: string): NonNullable<PDFTextItem['glyphSpans']> {
  return Array.from(text).map((char) => ({
    text: char,
    advance: 5
  }));
}

describe('text boundary model', () => {
  it('keeps title-case author names intact even when email local-parts bias the lexicon', () => {
    const items: PDFTextItem[] = [
      buildItem('Kai Chen', [...wordGlyphs('Kai'), { text: ' ', advance: 2.5, synthetic: true }, ...wordGlyphs('Chen')], 600),
      buildItem('Tomas Mikolov', [...wordGlyphs('Tomas'), { text: ' ', advance: 2.5, synthetic: true }, ...wordGlyphs('Mikolov')], 580),
      buildItem('kaichen@google.com', wordGlyphs('kaichen@google.com'), 560),
      buildItem('tmikolov@google.com', wordGlyphs('tmikolov@google.com'), 540)
    ];

    const refined = refineLexicalTextBoundaries(items);

    expect(refined[0]?.text).toBe('Kai Chen');
    expect(refined[1]?.text).toBe('Tomas Mikolov');
  });
});
