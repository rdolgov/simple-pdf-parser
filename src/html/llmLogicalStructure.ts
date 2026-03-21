import type { PDFImageBounds } from '../types.js';
import type { HtmlDocumentLayout, HtmlHeadingBlock, HtmlParagraphBlock } from './htmlLayoutConverter.js';
import { estimateLogicalSentenceCount } from './logicalSentenceCount.js';
import type {
  HtmlDocumentLogicalStructure,
  HtmlLogicalBlockAssignment,
  HtmlLogicalBlockRef,
  HtmlLogicalStructureMetadata,
  HtmlLogicalTextUnit,
  HtmlLogicalUnitPageSegment
} from './htmlLogicalStructure.js';

type TextBlock = HtmlParagraphBlock | HtmlHeadingBlock;

export interface HtmlLogicalParagraphCandidate {
  id: string;
  pageNumber: number;
  blockIndex: number;
  text: string;
  sentenceCount: number;
  sectionId?: string;
  sectionTitle?: string;
  sectionPath: string[];
  isListLike: boolean;
}

export interface HtmlLogicalSectionBatch {
  id: string;
  sectionId?: string;
  sectionTitle?: string;
  sectionPath: string[];
  batchIndex: number;
  batchCount: number;
  totalParagraphCount: number;
  totalSentenceCount: number;
  paragraphs: HtmlLogicalParagraphCandidate[];
}

export interface HtmlLogicalTopicProposal {
  title?: string;
  blockIds: string[];
}

export interface HtmlLogicalTopicGroup {
  title?: string;
  sectionId?: string;
  blockRefs: HtmlLogicalBlockRef[];
}

export interface HtmlLogicalBatchOptions {
  maxBatchChars?: number;
  maxBatchParagraphs?: number;
  wholeSectionMaxChars?: number;
  wholeSectionMaxParagraphs?: number;
  minTopicSentences?: number;
}

const DEFAULT_BATCH_OPTIONS: Required<HtmlLogicalBatchOptions> = {
  maxBatchChars: 6500,
  maxBatchParagraphs: 18,
  wholeSectionMaxChars: 14000,
  wholeSectionMaxParagraphs: 20,
  minTopicSentences: 10
};

const LIST_PREFIX = /^(\(?\d+[\).]|[a-z][\).]|[ivxlcdm]+[\).]|[•·\-–—])\s+/i;

export function collectHtmlLogicalSectionBatches(
  layout: HtmlDocumentLayout,
  baseStructure: HtmlDocumentLogicalStructure,
  options: HtmlLogicalBatchOptions = {}
): HtmlLogicalSectionBatch[] {
  const config = { ...DEFAULT_BATCH_OPTIONS, ...options };
  const sectionUnits = baseStructure.units.filter((unit) => unit.kind === 'section');
  const sectionUnitMap = new Map(sectionUnits.map((unit) => [unit.id, unit] as const));
  const paragraphBuckets = new Map<string, HtmlLogicalParagraphCandidate[]>();
  const bucketOrder: string[] = [];
  let paragraphCounter = 0;

  for (const page of layout.pages) {
    page.content.forEach((block, blockIndex) => {
      if (block.type !== 'paragraph') {
        return;
      }

      const text = normalizeLogicalText(block.text);
      if (text.length === 0) {
        return;
      }

      paragraphCounter += 1;
      const assignment = baseStructure.blockAssignments[buildLogicalBlockKey(page.number, blockIndex)] ?? null;
      const sectionUnit = assignment?.sectionId ? sectionUnitMap.get(assignment.sectionId) ?? null : null;
      const bucketKey = sectionUnit?.id ?? '__root__';
      if (!paragraphBuckets.has(bucketKey)) {
        paragraphBuckets.set(bucketKey, []);
        bucketOrder.push(bucketKey);
      }

      paragraphBuckets.get(bucketKey)?.push({
        id: `p${page.number}-${blockIndex}-${paragraphCounter}`,
        pageNumber: page.number,
        blockIndex,
        text,
        sentenceCount: estimateLogicalSentenceCount(text),
        sectionId: sectionUnit?.id,
        sectionTitle: sectionUnit?.title,
        sectionPath: buildSectionPath(sectionUnit, sectionUnitMap),
        isListLike: LIST_PREFIX.test(text)
      });
    });
  }

  const batches: HtmlLogicalSectionBatch[] = [];
  for (const bucketKey of bucketOrder) {
    const paragraphs = paragraphBuckets.get(bucketKey) ?? [];
    if (paragraphs.length === 0) {
      continue;
    }

    const sectionId = paragraphs[0]?.sectionId;
    const sectionTitle = paragraphs[0]?.sectionTitle;
    const sectionPath = paragraphs[0]?.sectionPath ?? [];
    const totalParagraphCount = paragraphs.length;
    const totalSentenceCount = paragraphs.reduce((sum, paragraph) => sum + paragraph.sentenceCount, 0);
    const totalChars = paragraphs.reduce((sum, paragraph) => sum + paragraph.text.length, 0);

    if (
      totalParagraphCount <= config.wholeSectionMaxParagraphs &&
      totalChars <= config.wholeSectionMaxChars
    ) {
      batches.push({
        id: `${bucketKey}-batch-1`,
        sectionId,
        sectionTitle,
        sectionPath,
        batchIndex: 1,
        batchCount: 1,
        totalParagraphCount,
        totalSentenceCount,
        paragraphs
      });
      continue;
    }

    let currentBatch: HtmlLogicalParagraphCandidate[] = [];
    let currentChars = 0;
    const pendingBatches: HtmlLogicalParagraphCandidate[][] = [];

    const flush = () => {
      if (currentBatch.length === 0) {
        return;
      }
      pendingBatches.push(currentBatch);
      currentBatch = [];
      currentChars = 0;
    };

    for (const paragraph of paragraphs) {
      const paragraphChars = paragraph.text.length;
      const wouldOverflow =
        currentBatch.length > 0 &&
        (currentBatch.length >= config.maxBatchParagraphs || currentChars + paragraphChars > config.maxBatchChars);
      if (wouldOverflow) {
        flush();
      }
      currentBatch.push(paragraph);
      currentChars += paragraphChars;
    }

    flush();

    pendingBatches.forEach((batchParagraphs, index) => {
      batches.push({
        id: `${bucketKey}-batch-${index + 1}`,
        sectionId,
        sectionTitle,
        sectionPath,
        batchIndex: index + 1,
        batchCount: pendingBatches.length,
        totalParagraphCount,
        totalSentenceCount,
        paragraphs: batchParagraphs
      });
    });
  }

  return batches;
}

export function parseHtmlLogicalTopicProposals(responseText: string): HtmlLogicalTopicProposal[] {
  const trimmed = stripCodeFences(responseText.trim());
  const jsonCandidate = extractJsonValue(trimmed);
  const parsed = JSON.parse(jsonCandidate) as unknown;

  if (Array.isArray(parsed)) {
    return normalizeProposalArray(parsed);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Logical structure extraction returned an invalid JSON payload.');
  }

  const groups = 'groups' in parsed ? (parsed as { groups?: unknown }).groups : undefined;
  if (!Array.isArray(groups)) {
    throw new Error('Logical structure extraction did not include a "groups" array.');
  }
  return normalizeProposalArray(groups);
}

export function normalizeHtmlLogicalTopicGroups(
  batch: HtmlLogicalSectionBatch,
  proposals: HtmlLogicalTopicProposal[]
): HtmlLogicalTopicGroup[] {
  const paragraphById = new Map(batch.paragraphs.map((paragraph) => [paragraph.id, paragraph] as const));
  const orderById = new Map(batch.paragraphs.map((paragraph, index) => [paragraph.id, index] as const));
  const consumed = new Set<string>();
  const proposedSpans: Array<{ startIndex: number; endIndex: number; title?: string; blockIds: string[] }> = [];

  for (const proposal of proposals) {
    const uniqueIds = [...new Set(proposal.blockIds)]
      .filter((blockId) => paragraphById.has(blockId))
      .filter((blockId) => !consumed.has(blockId))
      .sort((left, right) => (orderById.get(left) ?? 0) - (orderById.get(right) ?? 0));

    if (uniqueIds.length === 0) {
      continue;
    }

    let currentSpan: string[] = [];
    let previousIndex = -1;
    for (const blockId of uniqueIds) {
      const index = orderById.get(blockId);
      if (typeof index !== 'number') {
        continue;
      }
      if (currentSpan.length > 0 && index !== previousIndex + 1) {
        proposedSpans.push(createSpan(currentSpan, orderById, proposal.title));
        currentSpan = [];
      }
      currentSpan.push(blockId);
      consumed.add(blockId);
      previousIndex = index;
    }

    if (currentSpan.length > 0) {
      proposedSpans.push(createSpan(currentSpan, orderById, proposal.title));
    }
  }

  proposedSpans.sort((left, right) => left.startIndex - right.startIndex);

  const normalized: HtmlLogicalTopicGroup[] = [];
  let paragraphIndex = 0;
  let spanIndex = 0;

  while (paragraphIndex < batch.paragraphs.length) {
    const nextSpan = proposedSpans[spanIndex];
    if (nextSpan && nextSpan.startIndex === paragraphIndex) {
      normalized.push({
        title: normalizeNonEmpty(nextSpan.title),
        sectionId: batch.sectionId,
        blockRefs: nextSpan.blockIds.map((blockId) => {
          const paragraph = paragraphById.get(blockId);
          if (!paragraph) {
            throw new Error(`Unknown logical paragraph id: ${blockId}`);
          }
          return {
            pageNumber: paragraph.pageNumber,
            blockIndex: paragraph.blockIndex,
            type: 'paragraph' as const
          };
        })
      });
      paragraphIndex = nextSpan.endIndex + 1;
      spanIndex += 1;
      continue;
    }

    const fallbackStart = paragraphIndex;
    const fallbackIds: string[] = [];
    while (
      paragraphIndex < batch.paragraphs.length &&
      (!nextSpan || paragraphIndex < nextSpan.startIndex)
    ) {
      fallbackIds.push(batch.paragraphs[paragraphIndex].id);
      paragraphIndex += 1;
    }
    if (fallbackIds.length === 0) {
      paragraphIndex = fallbackStart + 1;
      continue;
    }

    normalized.push({
      sectionId: batch.sectionId,
      blockRefs: fallbackIds.map((blockId) => {
        const paragraph = paragraphById.get(blockId);
        if (!paragraph) {
          throw new Error(`Unknown logical paragraph id: ${blockId}`);
        }
        return {
          pageNumber: paragraph.pageNumber,
          blockIndex: paragraph.blockIndex,
          type: 'paragraph' as const
        };
      })
    });
  }

  return applyHierarchicalTopicPolicy(
    batch,
    normalized.filter((group) => group.blockRefs.length > 0),
    DEFAULT_BATCH_OPTIONS.minTopicSentences
  );
}

export function buildHtmlLogicalStructureFromTopicGroups(
  layout: HtmlDocumentLayout,
  baseStructure: HtmlDocumentLogicalStructure,
  topicGroups: HtmlLogicalTopicGroup[],
  metadata?: HtmlLogicalStructureMetadata
): HtmlDocumentLogicalStructure {
  const sectionUnits = baseStructure.units.filter((unit) => unit.kind === 'section');
  const sectionIds = new Set(sectionUnits.map((unit) => unit.id));
  const topicUnits = filterRedundantSectionTopicGroups(baseStructure, topicGroups)
    .filter((group) => group.blockRefs.length > 0)
    .map((group, index) => finalizeTopicUnit(layout, group, index + 1, sectionIds));

  const topicIdByBlockKey = new Map<string, string>();
  for (const unit of topicUnits) {
    for (const ref of unit.blockRefs) {
      topicIdByBlockKey.set(buildLogicalBlockKey(ref.pageNumber, ref.blockIndex), unit.id);
    }
  }

  const blockAssignments: Record<string, HtmlLogicalBlockAssignment> = {};
  for (const page of layout.pages) {
    page.content.forEach((block, blockIndex) => {
      if (!isTextBlock(block)) {
        return;
      }
      const key = buildLogicalBlockKey(page.number, blockIndex);
      const baseAssignment = baseStructure.blockAssignments[key];
      const assignment: HtmlLogicalBlockAssignment = {};
      if (baseAssignment?.sectionId && sectionIds.has(baseAssignment.sectionId)) {
        assignment.sectionId = baseAssignment.sectionId;
      }
      const topicId = topicIdByBlockKey.get(key);
      if (topicId) {
        assignment.topicId = topicId;
      }
      if (assignment.sectionId || assignment.topicId) {
        blockAssignments[key] = assignment;
      }
    });
  }

  return {
    schemaVersion: baseStructure.schemaVersion,
    strategy: 'llm-v1',
    ...(metadata ? { metadata } : {}),
    units: [...sectionUnits, ...topicUnits].sort(compareUnits),
    blockAssignments
  };
}

function buildSectionPath(
  sectionUnit: HtmlLogicalTextUnit | null,
  sectionUnitMap: Map<string, HtmlLogicalTextUnit>
): string[] {
  if (!sectionUnit) {
    return [];
  }

  const path: string[] = [];
  let cursor: HtmlLogicalTextUnit | null = sectionUnit;
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    if (normalizeNonEmpty(cursor.title)) {
      path.push(cursor.title as string);
    }
    cursor = cursor.parentId ? sectionUnitMap.get(cursor.parentId) ?? null : null;
  }

  return path.reverse();
}

function finalizeTopicUnit(
  layout: HtmlDocumentLayout,
  group: HtmlLogicalTopicGroup,
  topicIndex: number,
  sectionIds: Set<string>
): HtmlLogicalTextUnit {
  const pageSegments = buildPageSegments(group.blockRefs, layout);
  const pageStart = pageSegments[0]?.pageNumber ?? 0;
  const pageEnd = pageSegments[pageSegments.length - 1]?.pageNumber ?? pageStart;
  const text = pageSegments.map((segment) => segment.text).filter(Boolean).join('\n\n').trim();
  const validSectionId = group.sectionId && sectionIds.has(group.sectionId) ? group.sectionId : undefined;

  return {
    id: `topic-llm-${topicIndex}`,
    kind: 'topic',
    ...(normalizeNonEmpty(group.title) ? { title: normalizeNonEmpty(group.title) } : {}),
    ...(validSectionId ? { parentId: validSectionId } : {}),
    pageStart,
    pageEnd,
    blockRefs: group.blockRefs.slice(),
    pageSegments,
    text,
    charLength: text.length,
    blockCount: group.blockRefs.length,
    paragraphCount: group.blockRefs.length
  };
}

function applyHierarchicalTopicPolicy(
  batch: HtmlLogicalSectionBatch,
  groups: HtmlLogicalTopicGroup[],
  minTopicSentences: number
): HtmlLogicalTopicGroup[] {
  if (groups.length === 0) {
    return [];
  }

  if (batch.totalParagraphCount <= DEFAULT_BATCH_OPTIONS.wholeSectionMaxParagraphs) {
    return [buildWholeBatchGroup(batch)];
  }

  const sentenceCountByKey = new Map(
    batch.paragraphs.map((paragraph) => [buildLogicalBlockKey(paragraph.pageNumber, paragraph.blockIndex), paragraph.sentenceCount] as const)
  );
  const merged: HtmlLogicalTopicGroup[] = [];

  for (let index = 0; index < groups.length; index += 1) {
    let current = cloneGroup(groups[index]);
    while (countGroupSentences(current, sentenceCountByKey) < minTopicSentences && index < groups.length - 1) {
      index += 1;
      current = mergeTopicGroups(current, groups[index]);
    }

    if (countGroupSentences(current, sentenceCountByKey) < minTopicSentences && merged.length > 0) {
      merged[merged.length - 1] = mergeTopicGroups(merged[merged.length - 1], current);
      continue;
    }

    merged.push(current);
  }

  return merged.filter((group) => group.blockRefs.length > 0);
}

function buildWholeBatchGroup(batch: HtmlLogicalSectionBatch): HtmlLogicalTopicGroup {
  return {
    sectionId: batch.sectionId,
    blockRefs: batch.paragraphs.map((paragraph) => ({
      pageNumber: paragraph.pageNumber,
      blockIndex: paragraph.blockIndex,
      type: 'paragraph' as const
    }))
  };
}

function countGroupSentences(
  group: HtmlLogicalTopicGroup,
  sentenceCountByKey: Map<string, number>
): number {
  return group.blockRefs.reduce(
    (sum, ref) => sum + (sentenceCountByKey.get(buildLogicalBlockKey(ref.pageNumber, ref.blockIndex)) ?? 0),
    0
  );
}

function mergeTopicGroups(left: HtmlLogicalTopicGroup, right: HtmlLogicalTopicGroup): HtmlLogicalTopicGroup {
  return {
    title: normalizeNonEmpty(left.title) || normalizeNonEmpty(right.title),
    sectionId: left.sectionId ?? right.sectionId,
    blockRefs: [...left.blockRefs, ...right.blockRefs]
  };
}

function cloneGroup(group: HtmlLogicalTopicGroup): HtmlLogicalTopicGroup {
  return {
    title: group.title,
    sectionId: group.sectionId,
    blockRefs: group.blockRefs.slice()
  };
}

function filterRedundantSectionTopicGroups(
  baseStructure: HtmlDocumentLogicalStructure,
  topicGroups: HtmlLogicalTopicGroup[]
): HtmlLogicalTopicGroup[] {
  const sectionParagraphs = new Map<string, Set<string>>();
  for (const unit of baseStructure.units) {
    if (unit.kind !== 'section') {
      continue;
    }
    sectionParagraphs.set(
      unit.id,
      new Set(
        unit.blockRefs
          .filter((ref) => ref.type === 'paragraph')
          .map((ref) => buildLogicalBlockKey(ref.pageNumber, ref.blockIndex))
      )
    );
  }

  const groupsBySection = new Map<string, HtmlLogicalTopicGroup[]>();
  for (const group of topicGroups) {
    if (!group.sectionId) {
      continue;
    }
    const existing = groupsBySection.get(group.sectionId);
    if (existing) {
      existing.push(group);
    } else {
      groupsBySection.set(group.sectionId, [group]);
    }
  }

  return topicGroups.filter((group) => {
    if (!group.sectionId) {
      return true;
    }
    const sectionGroups = groupsBySection.get(group.sectionId) ?? [];
    if (sectionGroups.length !== 1) {
      return true;
    }
    const sectionKeys = sectionParagraphs.get(group.sectionId);
    if (!sectionKeys || sectionKeys.size === 0) {
      return true;
    }
    if (group.blockRefs.length !== sectionKeys.size) {
      return true;
    }

    for (const ref of group.blockRefs) {
      if (!sectionKeys.has(buildLogicalBlockKey(ref.pageNumber, ref.blockIndex))) {
        return true;
      }
    }

    return false;
  });
}

function buildPageSegments(blockRefs: HtmlLogicalBlockRef[], layout: HtmlDocumentLayout): HtmlLogicalUnitPageSegment[] {
  const refsByPage = new Map<number, HtmlLogicalBlockRef[]>();
  for (const ref of blockRefs) {
    const existing = refsByPage.get(ref.pageNumber);
    if (existing) {
      existing.push(ref);
    } else {
      refsByPage.set(ref.pageNumber, [ref]);
    }
  }

  return [...refsByPage.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([pageNumber, refs]) => {
      const page = layout.pages.find((candidate) => candidate.number === pageNumber);
      const textBlocks = refs
        .map((ref) => {
          const block = page?.content[ref.blockIndex];
          return isTextBlock(block) ? block : null;
        })
        .filter((block): block is TextBlock => block !== null);

      return {
        pageNumber,
        blockIndexes: refs.map((ref) => ref.blockIndex),
        bounds: mergeBounds(textBlocks.map((block) => block.bounds)),
        text: textBlocks.map((block) => normalizeLogicalText(block.text)).filter(Boolean).join('\n\n')
      };
    })
    .filter((segment) => segment.blockIndexes.length > 0);
}

function createSpan(
  blockIds: string[],
  orderById: Map<string, number>,
  title?: string
): { startIndex: number; endIndex: number; title?: string; blockIds: string[] } {
  const startIndex = orderById.get(blockIds[0]) ?? 0;
  const endIndex = orderById.get(blockIds[blockIds.length - 1]) ?? startIndex;
  return {
    startIndex,
    endIndex,
    title,
    blockIds
  };
}

function normalizeProposalArray(value: unknown[]): HtmlLogicalTopicProposal[] {
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const record = entry as { title?: unknown; blockIds?: unknown };
      if (!Array.isArray(record.blockIds)) {
        return null;
      }
      const blockIds = record.blockIds
        .map((blockId) => (typeof blockId === 'string' ? blockId.trim() : ''))
        .filter((blockId) => blockId.length > 0);
      if (blockIds.length === 0) {
        return null;
      }
      return {
        ...(typeof record.title === 'string' && record.title.trim().length > 0
          ? { title: record.title.trim() }
          : {}),
        blockIds
      } satisfies HtmlLogicalTopicProposal;
    })
    .filter((proposal): proposal is HtmlLogicalTopicProposal => proposal !== null);
}

function stripCodeFences(value: string): string {
  let result = value;
  if (result.startsWith('```json')) {
    result = result.slice(7);
  } else if (result.startsWith('```')) {
    result = result.slice(3);
  }
  if (result.endsWith('```')) {
    result = result.slice(0, -3);
  }
  return result.trim();
}

function extractJsonValue(value: string): string {
  const objectStart = value.indexOf('{');
  const objectEnd = value.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    return value.slice(objectStart, objectEnd + 1);
  }

  const arrayStart = value.indexOf('[');
  const arrayEnd = value.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return value.slice(arrayStart, arrayEnd + 1);
  }

  throw new Error('Logical structure extraction did not return JSON.');
}

function isTextBlock(block: unknown): block is TextBlock {
  return Boolean(
    block &&
    typeof block === 'object' &&
    'type' in block &&
    ((block as { type?: string }).type === 'paragraph' || (block as { type?: string }).type === 'heading')
  );
}

function buildLogicalBlockKey(pageNumber: number, blockIndex: number): string {
  return `${pageNumber}:${blockIndex}`;
}

function normalizeLogicalText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeNonEmpty(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
    { ...boundsList[0] }
  );
}
