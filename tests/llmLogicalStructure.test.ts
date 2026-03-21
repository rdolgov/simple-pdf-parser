import { describe, expect, it } from 'vitest';
import {
  buildHtmlLogicalStructure,
  resolveHtmlLogicalUnitForSelection,
  type HtmlDocumentLayout
} from '../src/html/htmlLogicalStructure';
import {
  buildHtmlLogicalStructureFromTopicGroups,
  collectHtmlLogicalSectionBatches,
  normalizeHtmlLogicalTopicGroups,
  parseHtmlLogicalTopicProposals
} from '../src/html/llmLogicalStructure';

describe('llm logical structure', () => {
  it('collapses short headed sections into one logical group even if the llm proposes smaller groups', () => {
    const layout: HtmlDocumentLayout = {
      pages: [
        {
          number: 1,
          width: 612,
          height: 792,
          content: [
            headingBlock('Model Architecture', 1, bounds(72, 720, 320, 744)),
            paragraphBlock('Decoder details are introduced before the main implementation notes.', bounds(72, 674, 520, 704)),
            paragraphBlock('• Six identical layers are stacked in the decoder.', bounds(92, 640, 520, 666)),
            paragraphBlock('• Masked self-attention prevents access to future positions.', bounds(92, 606, 520, 632)),
            paragraphBlock('We evaluate the decoder stack on translation benchmarks.', bounds(72, 560, 520, 592))
          ]
        }
      ]
    };

    const baseStructure = buildHtmlLogicalStructure(layout);
    const batch = collectHtmlLogicalSectionBatches(layout, baseStructure)[0];
    const proposals = parseHtmlLogicalTopicProposals(`
      \`\`\`json
      {
        "groups": [
          {
            "title": "Decoder stack overview",
            "blockIds": ["${batch.paragraphs[0].id}", "${batch.paragraphs[1].id}", "${batch.paragraphs[2].id}"]
          }
        ]
      }
      \`\`\`
    `);

    const groups = normalizeHtmlLogicalTopicGroups(batch, proposals);

    expect(groups).toHaveLength(1);
    expect(groups[0].blockRefs.map((ref) => ref.blockIndex)).toEqual([1, 2, 3, 4]);
  });

  it('treats a short headed section as the primary logical unit even when the llm returns one whole-section group', () => {
    const layout: HtmlDocumentLayout = {
      pages: [
        {
          number: 1,
          width: 612,
          height: 792,
          content: [
            headingBlock('Methods', 1, bounds(72, 720, 220, 744)),
            paragraphBlock('We use a shared encoder-decoder stack.', bounds(72, 678, 520, 706)),
            paragraphBlock('The decoder adds masked self-attention over future positions.', bounds(72, 644, 520, 672)),
            paragraphBlock('This preserves autoregressive generation during training.', bounds(72, 610, 520, 638))
          ]
        }
      ]
    };

    const baseStructure = buildHtmlLogicalStructure(layout);
    const batch = collectHtmlLogicalSectionBatches(layout, baseStructure)[0];
    const groups = normalizeHtmlLogicalTopicGroups(batch, [
      {
        title: 'Decoder stack and masking',
        blockIds: batch.paragraphs.map((paragraph) => paragraph.id)
      }
    ]);

    const structure = buildHtmlLogicalStructureFromTopicGroups(layout, baseStructure, groups, {
      provider: 'openai',
      model: 'gpt-5.2',
      promptVersion: 'test-v1',
      batchCount: 1
    });

    expect(structure.strategy).toBe('llm-v1');
    expect(structure.metadata?.provider).toBe('openai');
    expect(structure.units.filter((unit) => unit.kind === 'topic')).toHaveLength(0);

    const selection = resolveHtmlLogicalUnitForSelection(structure, {
      pageNumber: 1,
      blockIndex: 2,
      blockType: 'paragraph'
    });

    expect(selection.scope).toBe('section');
    expect(selection.logicalUnit?.title).toBe('Methods');
    expect(selection.logicalUnit?.paragraphCount).toBe(3);
    expect(selection.sectionUnit?.title).toBe('Methods');
  });

  it('prefers the enclosing section over a smaller llm topic when the subsection is short', () => {
    const layout: HtmlDocumentLayout = {
      pages: [
        {
          number: 1,
          width: 612,
          height: 792,
          content: [
            headingBlock('3.3 Position-wise Feed-Forward Networks', 2, bounds(72, 720, 520, 750)),
            paragraphBlock(
              'In addition to attention sub-layers, each layer contains a fully connected feed-forward network.',
              bounds(72, 662, 520, 702)
            ),
            paragraphBlock(
              'This consists of two linear transformations with a ReLU activation in between.',
              bounds(72, 620, 520, 652)
            )
          ]
        }
      ]
    };

    const baseStructure = buildHtmlLogicalStructure(layout, {
      minTopicChars: 60,
      maxTopicChars: 220,
      maxTopicParagraphs: 1
    });
    const batch = collectHtmlLogicalSectionBatches(layout, baseStructure)[0];
    const groups = normalizeHtmlLogicalTopicGroups(batch, [
      {
        title: 'Feed-forward network setup',
        blockIds: [batch.paragraphs[0].id]
      },
      {
        title: 'Two linear layers',
        blockIds: [batch.paragraphs[1].id]
      }
    ]);

    const structure = buildHtmlLogicalStructureFromTopicGroups(layout, baseStructure, groups, {
      provider: 'gemini',
      model: 'gemini-3-flash-preview',
      promptVersion: 'test-v1',
      batchCount: 1
    });
    const topicUnits = structure.units.filter((unit) => unit.kind === 'topic');

    const selection = resolveHtmlLogicalUnitForSelection(structure, {
      pageNumber: 1,
      blockIndex: 1,
      blockType: 'paragraph'
    });

    expect(topicUnits).toHaveLength(0);
    expect(selection.scope).toBe('section');
    expect(selection.logicalUnit?.kind).toBe('section');
    expect(selection.logicalUnit?.title).toBe('3.3 Position-wise Feed-Forward Networks');
    expect(selection.sectionUnit?.title).toBe('3.3 Position-wise Feed-Forward Networks');
  });

  it('merges tiny topic proposals inside large sections into larger contiguous groups', () => {
    const batch = {
      id: 'section-1-batch-1',
      sectionId: 'section-1',
      sectionTitle: 'Large Section',
      sectionPath: ['Large Section'],
      batchIndex: 1,
      batchCount: 1,
      totalParagraphCount: 21,
      totalSentenceCount: 21,
      paragraphs: Array.from({ length: 21 }, (_, index) => ({
        id: `p-${index + 1}`,
        pageNumber: 1,
        blockIndex: index + 1,
        text: `Sentence ${index + 1}.`,
        sentenceCount: 1,
        sectionId: 'section-1',
        sectionTitle: 'Large Section',
        sectionPath: ['Large Section'],
        isListLike: false
      }))
    } as const;

    const groups = normalizeHtmlLogicalTopicGroups(
      batch,
      batch.paragraphs.map((paragraph) => ({
        title: paragraph.id,
        blockIds: [paragraph.id]
      }))
    );

    expect(groups).toHaveLength(2);
    expect(groups[0].blockRefs).toHaveLength(10);
    expect(groups[1].blockRefs).toHaveLength(11);
  });
});

function headingBlock(text: string, level: 1 | 2 | 3 | 4 | 5 | 6, blockBounds: ReturnType<typeof bounds>) {
  return {
    type: 'heading' as const,
    level,
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
    confidence: 0.7
  };
}

function bounds(minX: number, minY: number, maxX: number, maxY: number) {
  return { minX, minY, maxX, maxY };
}
