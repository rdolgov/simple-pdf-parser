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
  it('normalizes proposal JSON into contiguous topic groups and preserves bullet context', () => {
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

    expect(groups).toHaveLength(2);
    expect(groups[0].title).toBe('Decoder stack overview');
    expect(groups[0].blockRefs).toHaveLength(3);
    expect(groups[0].blockRefs.map((ref) => ref.blockIndex)).toEqual([1, 2, 3]);
    expect(groups[1].blockRefs.map((ref) => ref.blockIndex)).toEqual([4]);
  });

  it('builds llm topic units while preserving section-level selection context', () => {
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
    expect(structure.units.filter((unit) => unit.kind === 'topic')).toHaveLength(1);

    const selection = resolveHtmlLogicalUnitForSelection(structure, {
      pageNumber: 1,
      blockIndex: 2,
      blockType: 'paragraph'
    });

    expect(selection.scope).toBe('topic');
    expect(selection.logicalUnit?.title).toBe('Decoder stack and masking');
    expect(selection.logicalUnit?.paragraphCount).toBe(3);
    expect(selection.sectionUnit?.title).toBe('Methods');
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
