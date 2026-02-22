import type {
  AnnotatedHtmlContentBlock,
  AnnotatedHtmlDocumentLayout,
  AnnotatedHtmlPageLayout,
  BlockRelevanceAnnotation,
  RelevanceAugmenter,
  RelevanceAugmenterOptions,
  RelevanceResponse
} from './relevanceTypes.js';
import type { HtmlContentBlock, HtmlDocumentLayout } from '../html/htmlLayoutConverter.js';

export class DefaultRelevanceAugmenter implements RelevanceAugmenter {
  augment(
    base: HtmlDocumentLayout,
    response: RelevanceResponse,
    options: RelevanceAugmenterOptions = {}
  ): AnnotatedHtmlDocumentLayout {
    const annotationMap = groupAnnotations(response.annotations);
    const defaultState = options.defaultState ?? 'dim';

    const annotatedPages: AnnotatedHtmlPageLayout[] = base.pages.map((page) => {
      const content = page.content.map((block, index) => {
        const key = makeKey(page.number, index);
        const annotation = annotationMap.get(key);
        const appliedAnnotation = annotation ?? createDefaultAnnotation(page.number, index, defaultState);

        const baseBlock = cloneBlock(block);
        const hookedBlock = options.annotationHook?.(baseBlock, appliedAnnotation);
        const annotatedBlock: AnnotatedHtmlContentBlock = hookedBlock ? { ...hookedBlock } : baseBlock;

        type RelevanceMeta = NonNullable<AnnotatedHtmlContentBlock['relevance']>;
        const existingRelevance: Partial<RelevanceMeta> = annotatedBlock.relevance ?? {};
        annotatedBlock.relevance = {
          ...existingRelevance,
          state: appliedAnnotation.state,
          summary: appliedAnnotation.summary ?? existingRelevance.summary,
          rewrittenText: appliedAnnotation.rewrittenText ?? existingRelevance.rewrittenText,
          rationale: appliedAnnotation.rationale ?? existingRelevance.rationale,
          confidence:
            appliedAnnotation.confidence ?? existingRelevance.confidence ?? (annotation ? undefined : 0),
          matchRanges: appliedAnnotation.matchRanges ?? existingRelevance.matchRanges
        };

        return annotatedBlock;
      });

      const { content: _ignored, ...pageRest } = page;
      return {
        ...pageRest,
        content
      } as AnnotatedHtmlPageLayout;
    });

    return {
      pages: annotatedPages,
      query: options.query,
      querySummary: response.querySummary,
      model: response.model
    };
  }
}

function groupAnnotations(annotations: BlockRelevanceAnnotation[]): Map<string, BlockRelevanceAnnotation> {
  const map = new Map<string, BlockRelevanceAnnotation>();
  for (const annotation of annotations ?? []) {
    const key = makeKey(annotation.pageNumber, annotation.blockIndex);
    if (!map.has(key)) {
      map.set(key, annotation);
    }
  }
  return map;
}

function makeKey(pageNumber: number, blockIndex: number): string {
  return `${pageNumber}:${blockIndex}`;
}

function createDefaultAnnotation(
  pageNumber: number,
  blockIndex: number,
  state: BlockRelevanceAnnotation['state']
): BlockRelevanceAnnotation {
  return {
    pageNumber,
    blockIndex,
    state,
    confidence: state === 'highlight' ? 0.5 : 0
  };
}

function cloneBlock(block: HtmlContentBlock): AnnotatedHtmlContentBlock {
  return { ...block } as AnnotatedHtmlContentBlock;
}
