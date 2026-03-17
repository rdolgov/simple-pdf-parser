import { describe, expect, it } from 'vitest';
import {
  buildDocumentContextExcerpt,
  buildLassoChatContextText,
  buildLassoExplainPrompt,
  buildLassoInteractiveWidgetPrompt,
  buildLassoPromptContext
} from '../testApp/src/utils/lassoPrompts';

describe('lasso prompts', () => {
  it('builds local and document context for a selected page region', () => {
    const page = {
      number: 4,
      size: { width: 612, height: 792 },
      textItems: [
        {
          text: 'Section 2',
          bounds: { minX: 72, minY: 708, maxX: 140, maxY: 724 }
        },
        {
          text: 'Attention maps highlight',
          bounds: { minX: 80, minY: 660, maxX: 220, maxY: 676 }
        },
        {
          text: 'which tokens interact strongly.',
          bounds: { minX: 224, minY: 660, maxX: 396, maxY: 676 }
        },
        {
          text: 'Distant footer',
          bounds: { minX: 80, minY: 120, maxX: 160, maxY: 136 }
        }
      ],
      imageItems: []
    } as any;

    const htmlPage = {
      number: 4,
      content: [
        {
          type: 'heading',
          text: 'Section 2',
          bounds: { minX: 72, minY: 706, maxX: 180, maxY: 730 }
        },
        {
          type: 'paragraph',
          text: 'Attention maps highlight which tokens interact strongly.',
          bounds: { minX: 72, minY: 640, maxX: 420, maxY: 688 }
        }
      ]
    } as any;

    const context = buildLassoPromptContext({
      page,
      pageNumber: 4,
      totalPages: 12,
      htmlPage,
      documentTitle: 'Attention Is All You Need',
      documentText: [
        'Attention Is All You Need introduces the Transformer architecture.',
        'The paper compares recurrent, convolutional, and attention-only models.',
        'It reports strong translation results and analyzes attention behavior.'
      ].join(' '),
      selectionBounds: {
        minX: 100,
        minY: 650,
        maxX: 250,
        maxY: 682
      }
    });

    expect(context.sectionHeading).toBe('Section 2');
    expect(context.nearbyPageText).toContain('Attention maps highlight which tokens interact strongly.');
    expect(context.nearbyPageText).not.toContain('Distant footer');
    expect(context.documentContextText).toContain('Transformer architecture');

    const chatContext = buildLassoChatContextText(context);
    expect(chatContext).toContain('Page: 4 of 12');
    expect(chatContext).toContain('Whole-document context excerpt');

    const explainPrompt = buildLassoExplainPrompt(context);
    expect(explainPrompt).toContain('three panels');
    expect(explainPrompt).toContain('Section 2');

    const widgetPrompt = buildLassoInteractiveWidgetPrompt(context);
    expect(widgetPrompt).toContain('"title": "Short widget title"');
    expect(widgetPrompt).toContain('Use only vanilla HTML, CSS, and JavaScript.');
  });

  it('samples long document text across the full document', () => {
    const longText = `${'begin '.repeat(350)}${'middle '.repeat(350)}${'end '.repeat(350)}`;
    const excerpt = buildDocumentContextExcerpt(longText, 900);

    expect(excerpt).toContain('Beginning:');
    expect(excerpt).toContain('Middle:');
    expect(excerpt).toContain('Ending:');
  });
});
