import { describe, expect, it } from 'vitest';
import {
  buildHtmlLogicalStructure,
  resolveHtmlLogicalUnitForSelection,
  type HtmlDocumentLayout
} from '../src/html/htmlLogicalStructure';

describe('html logical structure', () => {
  it('groups adjacent paragraphs into topic units while preserving section context', () => {
    const layout: HtmlDocumentLayout = {
      pages: [
        {
          number: 1,
          width: 612,
          height: 792,
          content: [
            headingBlock('Overview', 1, bounds(72, 720, 260, 744)),
            paragraphBlock(
              'Transformers replace recurrence with attention and expose more direct token-to-token interactions across the full sequence.',
              bounds(72, 660, 520, 704)
            ),
            paragraphBlock(
              'This makes long-range dependencies easier to model and keeps the computation highly parallel across training batches.',
              bounds(72, 606, 520, 648)
            ),
            paragraphBlock(
              'However, optimization choices and regularization still determine whether the architecture actually converges well in practice.',
              bounds(72, 544, 520, 588)
            )
          ]
        }
      ]
    };

    const structure = buildHtmlLogicalStructure(layout, {
      minTopicChars: 120,
      maxTopicChars: 500,
      maxTopicParagraphs: 4
    });

    const topicUnits = structure.units.filter((unit) => unit.kind === 'topic');
    const sectionUnits = structure.units.filter((unit) => unit.kind === 'section');

    expect(topicUnits).toHaveLength(2);
    expect(sectionUnits).toHaveLength(1);
    expect(topicUnits[0].paragraphCount).toBe(2);
    expect(topicUnits[0].text).toContain('Transformers replace recurrence');
    expect(topicUnits[0].text).toContain('long-range dependencies');
    expect(topicUnits[1].text).toContain('However, optimization choices');

    const paragraphSelection = resolveHtmlLogicalUnitForSelection(structure, {
      pageNumber: 1,
      blockIndex: 1,
      blockType: 'paragraph'
    });
    expect(paragraphSelection.scope).toBe('topic');
    expect(paragraphSelection.logicalUnit?.paragraphCount).toBe(2);
    expect(paragraphSelection.sectionUnit?.title).toBe('Overview');

    const headingSelection = resolveHtmlLogicalUnitForSelection(structure, {
      pageNumber: 1,
      blockIndex: 0,
      blockType: 'heading'
    });
    expect(headingSelection.scope).toBe('section');
    expect(headingSelection.logicalUnit?.title).toBe('Overview');
    expect(headingSelection.logicalUnit?.paragraphCount).toBe(3);
  });

  it('keeps subsection hierarchy and parent section coverage intact', () => {
    const layout: HtmlDocumentLayout = {
      pages: [
        {
          number: 1,
          width: 612,
          height: 792,
          content: [
            headingBlock('Methods', 1, bounds(72, 720, 220, 744)),
            paragraphBlock(
              'We use a shared encoder-decoder stack with residual pathways and standard token embeddings.',
              bounds(72, 668, 520, 706)
            ),
            headingBlock('Attention Heads', 2, bounds(72, 610, 260, 636)),
            paragraphBlock(
              'Multiple heads let the model separate syntactic and semantic relations while keeping the per-head projections lightweight.',
              bounds(72, 556, 520, 598)
            ),
            paragraphBlock(
              'Each head attends over the same inputs but can specialize to different positional and lexical cues during training.',
              bounds(72, 508, 520, 548)
            )
          ]
        }
      ]
    };

    const structure = buildHtmlLogicalStructure(layout, {
      minTopicChars: 100,
      maxTopicChars: 600,
      maxTopicParagraphs: 4
    });

    const sections = structure.units.filter((unit) => unit.kind === 'section');
    const methodsSection = sections.find((unit) => unit.title === 'Methods');
    const attentionSection = sections.find((unit) => unit.title === 'Attention Heads');

    expect(methodsSection).toBeDefined();
    expect(attentionSection).toBeDefined();
    expect(attentionSection?.parentId).toBe(methodsSection?.id);
    expect(methodsSection?.text).toContain('Attention Heads');
    expect(methodsSection?.text).toContain('Each head attends over the same inputs');

    const subsectionSelection = resolveHtmlLogicalUnitForSelection(structure, {
      pageNumber: 1,
      blockIndex: 3,
      blockType: 'paragraph'
    });
    expect(subsectionSelection.scope).toBe('topic');
    expect(subsectionSelection.sectionUnit?.title).toBe('Attention Heads');
    expect(subsectionSelection.sectionUnit?.parentId).toBe(methodsSection?.id);
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
