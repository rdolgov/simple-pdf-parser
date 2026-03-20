import { describe, expect, it } from 'vitest';

import type { StructuredDataDocument } from '../src/query/structuredExtractApi';
import { deriveGeminiExtractionFromStructuredData } from '../testApp/src/utils/structuredExtractToGemini';

describe('structuredExtractToGemini', () => {
  it('derives layout-style Gemini extraction from a structured extract document', () => {
    const document: StructuredDataDocument = {
      pages: [
        { page_number: 0, width: 200, height: 100 }
      ],
      elements: [
        {
          Page: 0,
          Path: '//Document/Title',
          Bounds: [10, 70, 110, 90],
          Text: 'Attention Is All You Need',
          SemanticType: 'title'
        },
        {
          Page: 0,
          Path: '//Document/Formula',
          Bounds: [20, 40, 140, 60],
          Text: 'Attention(Q, K, V) = softmax(...)V',
          SemanticType: 'formula'
        },
        {
          Page: 0,
          Path: '//Document/Reference',
          Bounds: [20, 10, 90, 24],
          Text: '[17] Vaswani et al.',
          SemanticType: 'reference'
        },
        {
          Page: 0,
          Path: '//Document/Figure',
          Bounds: [120, 20, 180, 80],
          SemanticType: 'image',
          Description: 'Transformer diagram'
        }
      ]
    };

    const extraction = deriveGeminiExtractionFromStructuredData(document);

    expect(extraction.document_title).toBe('Attention Is All You Need');
    expect(extraction.pages).toHaveLength(1);
    expect(extraction.pages[0]).toMatchObject({
      page_number: 1
    });
    expect(normalizeElements(extraction.pages[0]?.elements ?? [])).toEqual([
      {
        type: 'title',
        content: 'Attention Is All You Need',
        bounding_box: [0.05, 0.1, 0.5, 0.2]
      },
      {
        type: 'formula',
        content: 'Attention(Q, K, V) = softmax(...)V',
        bounding_box: [0.1, 0.4, 0.6, 0.2]
      },
      {
        type: 'reference',
        content: '[17] Vaswani et al.',
        bounding_box: [0.1, 0.76, 0.35, 0.14]
      },
      {
        type: 'image',
        content: '',
        description: 'Transformer diagram',
        bounding_box: [0.6, 0.2, 0.3, 0.6]
      }
    ]);
  });
});

function normalizeElements(elements: Array<{ bounding_box: [number, number, number, number] } & Record<string, unknown>>) {
  return elements.map((element) => ({
    ...element,
    bounding_box: element.bounding_box.map((value) => Number(value.toFixed(4)))
  }));
}
