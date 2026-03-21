import type {
  HtmlContentBlock,
  HtmlDocumentLayout,
  HtmlHeadingBlock,
  HtmlParagraphBlock
} from './htmlLayoutConverter.js';
import type { PDFImageBounds } from '../types.js';
import type { StructuredExtractProvider } from '../query/structuredExtractApi.js';

type TextBlock = HtmlParagraphBlock | HtmlHeadingBlock;

export type HtmlLogicalUnitKind = 'section' | 'topic';

export interface HtmlLogicalBlockRef {
  pageNumber: number;
  blockIndex: number;
  type: TextBlock['type'];
}

export interface HtmlLogicalUnitPageSegment {
  pageNumber: number;
  blockIndexes: number[];
  bounds: PDFImageBounds;
  text: string;
}

export interface HtmlLogicalTextUnit {
  id: string;
  kind: HtmlLogicalUnitKind;
  title?: string;
  headingLevel?: number;
  parentId?: string;
  pageStart: number;
  pageEnd: number;
  blockRefs: HtmlLogicalBlockRef[];
  pageSegments: HtmlLogicalUnitPageSegment[];
  text: string;
  charLength: number;
  blockCount: number;
  paragraphCount: number;
}

export interface HtmlLogicalBlockAssignment {
  sectionId?: string;
  topicId?: string;
}

export type HtmlLogicalStructureStrategy = 'heuristic-v1' | 'llm-v1';

export interface HtmlLogicalStructureMetadata {
  provider?: StructuredExtractProvider;
  model?: string;
  promptVersion?: string;
  batchCount?: number;
}

export interface HtmlDocumentLogicalStructure {
  schemaVersion: number;
  strategy: HtmlLogicalStructureStrategy;
  metadata?: HtmlLogicalStructureMetadata;
  units: HtmlLogicalTextUnit[];
  blockAssignments: Record<string, HtmlLogicalBlockAssignment>;
}

export interface HtmlLogicalStructureOptions {
  minTopicChars?: number;
  maxTopicChars?: number;
  maxTopicParagraphs?: number;
}

interface FlatTextBlock {
  pageNumber: number;
  blockIndex: number;
  block: TextBlock;
}

interface UnitBuilder {
  id: string;
  kind: HtmlLogicalUnitKind;
  title?: string;
  headingLevel?: number;
  parentId?: string;
  blockRefs: HtmlLogicalBlockRef[];
  textParts: string[];
  paragraphCount: number;
}

interface TopicBuilder extends UnitBuilder {
  kind: 'topic';
  sectionId: string;
  sectionTitle?: string;
}

interface SectionStackEntry {
  unit: UnitBuilder;
  headingLevel: number;
}

const DEFAULT_OPTIONS: Required<HtmlLogicalStructureOptions> = {
  minTopicChars: 420,
  maxTopicChars: 1500,
  maxTopicParagraphs: 4
};

const LOGICAL_STRUCTURE_SCHEMA_VERSION = 1;
const ROOT_SECTION_ID = 'section-root';
const SHORT_SECTION_MAX_PARAGRAPHS = 6;
const SHORT_SECTION_MAX_CHARS = 3200;
const SHORT_SECTION_MAX_BLOCKS = 12;

const TRANSITION_PREFIXES = [
  'however',
  'moreover',
  'in contrast',
  'by contrast',
  'on the other hand',
  'to evaluate',
  'to test',
  'to verify',
  'to measure',
  'we also',
  'we further',
  'we then',
  'we finally',
  'finally',
  'next',
  'in addition',
  'additionally',
  'meanwhile',
  'for example',
  'for instance'
] as const;

const STANDALONE_PREFIX = /^(figure|fig\.|table|algorithm|lemma|theorem|proof|remark|example|references|appendix|keywords?)\b/i;
const LIST_PREFIX = /^(\(?\d+[\).]|[a-z][\).]|[ivxlcdm]+[\).]|[•·\-–—])\s+/i;

export function buildHtmlLogicalStructure(
  layout: HtmlDocumentLayout,
  options: HtmlLogicalStructureOptions = {}
): HtmlDocumentLogicalStructure {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const flatBlocks = flattenTextBlocks(layout);
  const units: HtmlLogicalTextUnit[] = [];
  const blockAssignments: Record<string, HtmlLogicalBlockAssignment> = {};

  let sectionCounter = 0;
  let topicCounter = 0;

  const createSectionBuilder = (input: {
    title?: string;
    headingLevel?: number;
    parentId?: string;
  }): UnitBuilder => ({
    id: input.headingLevel === 0 ? ROOT_SECTION_ID : `section-${++sectionCounter}`,
    kind: 'section',
    title: input.title,
    headingLevel: input.headingLevel,
    parentId: input.parentId,
    blockRefs: [],
    textParts: [],
    paragraphCount: 0
  });

  const createTopicBuilder = (section: UnitBuilder): TopicBuilder => ({
    id: `topic-${++topicCounter}`,
    kind: 'topic',
    title: section.title,
    parentId: section.id,
    sectionId: section.id,
    sectionTitle: section.title,
    blockRefs: [],
    textParts: [],
    paragraphCount: 0
  });

  const sectionBuilders: UnitBuilder[] = [];
  const rootSection = createSectionBuilder({ title: 'Document', headingLevel: 0 });
  sectionBuilders.push(rootSection);
  const sectionStack: SectionStackEntry[] = [{ unit: rootSection, headingLevel: 0 }];

  let activeTopic: TopicBuilder | null = null;

  const finalizeTopic = (): void => {
    if (!activeTopic || activeTopic.blockRefs.length === 0) {
      activeTopic = null;
      return;
    }
    units.push(finalizeUnit(activeTopic, layout));
    activeTopic = null;
  };

  for (const entry of flatBlocks) {
    const blockKey = buildLogicalBlockKey(entry.pageNumber, entry.blockIndex);
    const normalizedText = normalizeLogicalText(entry.block.text);
    if (normalizedText.length === 0) {
      continue;
    }

    if (entry.block.type === 'heading') {
      finalizeTopic();
      while (sectionStack.length > 1 && sectionStack[sectionStack.length - 1].headingLevel >= entry.block.level) {
        sectionStack.pop();
      }

      for (const ancestor of sectionStack) {
        appendBlockToUnit(ancestor.unit, entry, normalizedText);
      }

      const parent = sectionStack[sectionStack.length - 1]?.unit;
      const sectionUnit = createSectionBuilder({
        title: normalizedText,
        headingLevel: entry.block.level,
        parentId: parent?.id
      });
      appendBlockToUnit(sectionUnit, entry, normalizedText);
      sectionBuilders.push(sectionUnit);
      sectionStack.push({ unit: sectionUnit, headingLevel: entry.block.level });

      blockAssignments[blockKey] = {
        sectionId: sectionUnit.id
      };
      continue;
    }

    for (const ancestor of sectionStack) {
      appendBlockToUnit(ancestor.unit, entry, normalizedText);
    }

    const activeSection = sectionStack[sectionStack.length - 1]?.unit ?? rootSection;
    if (!activeTopic || activeTopic.sectionId !== activeSection.id) {
      finalizeTopic();
      activeTopic = createTopicBuilder(activeSection);
    } else if (shouldBreakTopic(activeTopic, entry, layout, config)) {
      finalizeTopic();
      activeTopic = createTopicBuilder(activeSection);
    }

    appendBlockToUnit(activeTopic, entry, normalizedText);
    blockAssignments[blockKey] = {
      sectionId: activeSection.id,
      topicId: activeTopic.id
    };
  }

  finalizeTopic();
  for (const builder of sectionBuilders) {
    if (builder.id === ROOT_SECTION_ID) {
      continue;
    }
    units.push(finalizeUnit(builder, layout));
  }

  units.sort(compareUnits);

  return {
    schemaVersion: LOGICAL_STRUCTURE_SCHEMA_VERSION,
    strategy: 'heuristic-v1',
    units,
    blockAssignments
  };
}

export function findHtmlLogicalUnitById(
  structure: HtmlDocumentLogicalStructure | null | undefined,
  unitId: string | null | undefined
): HtmlLogicalTextUnit | null {
  if (!structure || !unitId) {
    return null;
  }
  return structure.units.find((unit) => unit.id === unitId) ?? null;
}

export function getHtmlLogicalBlockAssignment(
  structure: HtmlDocumentLogicalStructure | null | undefined,
  pageNumber: number,
  blockIndex: number
): HtmlLogicalBlockAssignment | null {
  if (!structure) {
    return null;
  }
  return structure.blockAssignments[buildLogicalBlockKey(pageNumber, blockIndex)] ?? null;
}

export function getHtmlLogicalUnitPageSegment(
  unit: HtmlLogicalTextUnit | null | undefined,
  pageNumber: number
): HtmlLogicalUnitPageSegment | null {
  if (!unit) {
    return null;
  }
  return unit.pageSegments.find((segment) => segment.pageNumber === pageNumber) ?? null;
}

export function resolveHtmlLogicalUnitForSelection(
  structure: HtmlDocumentLogicalStructure | null | undefined,
  payload: {
    pageNumber: number;
    blockIndex: number;
    blockType: TextBlock['type'];
  }
): {
  scope: 'block' | 'topic' | 'section';
  logicalUnit: HtmlLogicalTextUnit | null;
  sectionUnit: HtmlLogicalTextUnit | null;
} {
  const assignment = getHtmlLogicalBlockAssignment(structure, payload.pageNumber, payload.blockIndex);
  const sectionUnit = findHtmlLogicalUnitById(structure, assignment?.sectionId);
  if (payload.blockType === 'heading') {
    return {
      scope: sectionUnit ? 'section' : 'block',
      logicalUnit: sectionUnit,
      sectionUnit
    };
  }

  const topicUnit = findHtmlLogicalUnitById(structure, assignment?.topicId);
  if (topicUnit) {
    if (shouldPreferSectionForParagraphSelection(sectionUnit, topicUnit)) {
      return {
        scope: 'section',
        logicalUnit: sectionUnit,
        sectionUnit
      };
    }
    return {
      scope: 'topic',
      logicalUnit: topicUnit,
      sectionUnit
    };
  }

  return {
    scope: sectionUnit ? 'section' : 'block',
    logicalUnit: sectionUnit,
    sectionUnit
  };
}

function flattenTextBlocks(layout: HtmlDocumentLayout): FlatTextBlock[] {
  const flat: FlatTextBlock[] = [];
  for (const page of layout.pages) {
    page.content.forEach((block, blockIndex) => {
      if (!isTextBlock(block)) {
        return;
      }
      flat.push({
        pageNumber: page.number,
        blockIndex,
        block
      });
    });
  }
  return flat;
}

function appendBlockToUnit(unit: UnitBuilder, entry: FlatTextBlock, text: string): void {
  unit.blockRefs.push({
    pageNumber: entry.pageNumber,
    blockIndex: entry.blockIndex,
    type: entry.block.type
  });
  unit.textParts.push(text);
  if (entry.block.type === 'paragraph') {
    unit.paragraphCount += 1;
  }
}

function finalizeUnit(builder: UnitBuilder, layout: HtmlDocumentLayout): HtmlLogicalTextUnit {
  const pageSegments = buildPageSegments(builder.blockRefs, layout);
  const pageStart = pageSegments[0]?.pageNumber ?? 0;
  const pageEnd = pageSegments[pageSegments.length - 1]?.pageNumber ?? pageStart;
  const text = builder.textParts.join('\n\n').trim();
  return {
    id: builder.id,
    kind: builder.kind,
    title: builder.title,
    headingLevel: builder.headingLevel,
    parentId: builder.parentId,
    pageStart,
    pageEnd,
    blockRefs: builder.blockRefs.slice(),
    pageSegments,
    text,
    charLength: text.length,
    blockCount: builder.blockRefs.length,
    paragraphCount: builder.paragraphCount
  };
}

function buildPageSegments(blockRefs: HtmlLogicalBlockRef[], layout: HtmlDocumentLayout): HtmlLogicalUnitPageSegment[] {
  const grouped = new Map<number, HtmlLogicalBlockRef[]>();
  for (const ref of blockRefs) {
    const existing = grouped.get(ref.pageNumber);
    if (existing) {
      existing.push(ref);
    } else {
      grouped.set(ref.pageNumber, [ref]);
    }
  }

  return [...grouped.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([pageNumber, refs]) => {
      const page = layout.pages.find((candidate) => candidate.number === pageNumber);
      const textBlocks = refs
        .map((ref) => {
          const block = page?.content[ref.blockIndex];
          return isTextBlock(block) ? block : null;
        })
        .filter((block): block is TextBlock => block !== null);
      const bounds = mergeBounds(textBlocks.map((block) => block.bounds));
      return {
        pageNumber,
        blockIndexes: refs.map((ref) => ref.blockIndex),
        bounds,
        text: textBlocks.map((block) => normalizeLogicalText(block.text)).filter(Boolean).join('\n\n')
      };
    })
    .filter((segment) => segment.blockIndexes.length > 0);
}

function shouldBreakTopic(
  topic: TopicBuilder,
  nextEntry: FlatTextBlock,
  layout: HtmlDocumentLayout,
  config: Required<HtmlLogicalStructureOptions>
): boolean {
  if (topic.blockRefs.length === 0) {
    return false;
  }

  const nextText = normalizeLogicalText(nextEntry.block.text);
  const currentText = topic.textParts.join('\n\n').trim();
  if (currentText.length >= config.maxTopicChars || topic.paragraphCount >= config.maxTopicParagraphs) {
    return true;
  }

  const previousRef = topic.blockRefs[topic.blockRefs.length - 1];
  const previousBlock = getTextBlock(layout, previousRef.pageNumber, previousRef.blockIndex);
  if (!previousBlock) {
    return false;
  }

  if (isStandaloneParagraph(nextText)) {
    return topic.paragraphCount > 0;
  }
  if (isStandaloneParagraph(normalizeLogicalText(previousBlock.text))) {
    return true;
  }

  if (nextEntry.pageNumber !== previousRef.pageNumber && currentText.length >= config.minTopicChars) {
    return true;
  }

  const gapRatio = computeVerticalGapRatio(previousBlock, nextEntry.block);
  if (gapRatio >= 1.85 && currentText.length >= Math.round(config.minTopicChars * 0.6)) {
    return true;
  }

  if (hasColumnShift(previousBlock, nextEntry.block) && currentText.length >= Math.round(config.minTopicChars * 0.7)) {
    return true;
  }

  if (
    currentText.length >= config.minTopicChars &&
    topic.paragraphCount >= 2 &&
    startsWithTransition(nextText) &&
    !endsWithContinuationCue(normalizeLogicalText(previousBlock.text))
  ) {
    return true;
  }

  return false;
}

function getTextBlock(
  layout: HtmlDocumentLayout,
  pageNumber: number,
  blockIndex: number
): TextBlock | null {
  const page = layout.pages.find((candidate) => candidate.number === pageNumber);
  const block = page?.content[blockIndex];
  return isTextBlock(block) ? block : null;
}

function computeVerticalGapRatio(previous: TextBlock, current: TextBlock): number {
  const gap = Math.max(0, previous.bounds.minY - current.bounds.maxY);
  const referenceHeight = Math.max(
    previous.bounds.maxY - previous.bounds.minY,
    current.bounds.maxY - current.bounds.minY,
    1
  );
  return gap / referenceHeight;
}

function hasColumnShift(previous: TextBlock, current: TextBlock): boolean {
  const minXDelta = Math.abs(previous.bounds.minX - current.bounds.minX);
  const widthDelta = Math.abs(
    (previous.bounds.maxX - previous.bounds.minX) - (current.bounds.maxX - current.bounds.minX)
  );
  return minXDelta >= 42 || widthDelta >= 120;
}

function startsWithTransition(text: string): boolean {
  const normalized = text.toLowerCase();
  return TRANSITION_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function endsWithContinuationCue(text: string): boolean {
  return /[:;]\s*$/.test(text);
}

function isStandaloneParagraph(text: string): boolean {
  return STANDALONE_PREFIX.test(text) || LIST_PREFIX.test(text);
}

function compareUnits(left: HtmlLogicalTextUnit, right: HtmlLogicalTextUnit): number {
  const byPage = left.pageStart - right.pageStart;
  if (byPage !== 0) {
    return byPage;
  }
  const leftIndex = left.blockRefs[0]?.blockIndex ?? 0;
  const rightIndex = right.blockRefs[0]?.blockIndex ?? 0;
  if (leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }
  if (left.kind === right.kind) {
    return 0;
  }
  return left.kind === 'section' ? -1 : 1;
}

function mergeBounds(boundsList: PDFImageBounds[]): PDFImageBounds {
  if (boundsList.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  return boundsList.reduce(
    (merged, bounds) => ({
      minX: Math.min(merged.minX, bounds.minX),
      minY: Math.min(merged.minY, bounds.minY),
      maxX: Math.max(merged.maxX, bounds.maxX),
      maxY: Math.max(merged.maxY, bounds.maxY)
    }),
    {
      minX: boundsList[0].minX,
      minY: boundsList[0].minY,
      maxX: boundsList[0].maxX,
      maxY: boundsList[0].maxY
    }
  );
}

function normalizeLogicalText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function buildLogicalBlockKey(pageNumber: number, blockIndex: number): string {
  return `${pageNumber}:${blockIndex}`;
}

function isTextBlock(block: HtmlContentBlock | undefined | null): block is TextBlock {
  return block !== null && block !== undefined && (block.type === 'paragraph' || block.type === 'heading');
}

function shouldPreferSectionForParagraphSelection(
  sectionUnit: HtmlLogicalTextUnit | null,
  topicUnit: HtmlLogicalTextUnit | null
): boolean {
  if (!sectionUnit || !topicUnit || topicUnit.parentId !== sectionUnit.id) {
    return false;
  }

  const isCompactSubsection =
    (sectionUnit.headingLevel ?? 0) >= 2 ||
    (!!sectionUnit.parentId && sectionUnit.parentId !== ROOT_SECTION_ID);
  const topicIsNotLarger = topicUnit.paragraphCount <= sectionUnit.paragraphCount;

  return (
    isCompactSubsection &&
    topicIsNotLarger &&
    sectionUnit.paragraphCount > 0 &&
    sectionUnit.paragraphCount <= SHORT_SECTION_MAX_PARAGRAPHS &&
    sectionUnit.charLength <= SHORT_SECTION_MAX_CHARS &&
    sectionUnit.blockCount <= SHORT_SECTION_MAX_BLOCKS
  );
}
