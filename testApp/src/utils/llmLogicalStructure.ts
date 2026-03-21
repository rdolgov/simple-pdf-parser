import {
  buildHtmlLogicalStructure,
  buildHtmlLogicalStructureFromTopicGroups,
  collectHtmlLogicalSectionBatches,
  normalizeHtmlLogicalTopicGroups,
  parseHtmlLogicalTopicProposals,
  type HtmlDocumentLayout,
  type HtmlDocumentLogicalStructure,
  type StructuredExtractProvider
} from 'pdf-layout-parser';
import { generateLogicalStructureTask } from '../api/proxyTaskApi';
import { getStructuredExtractModel, getStructuredExtractProvider } from './structuredExtractSettings';

export const LOGICAL_STRUCTURE_LLM_PROMPT_VERSION = 'v3';

export interface LogicalStructureRuntimeSettings {
  provider: StructuredExtractProvider;
  model: string;
}

export function loadLogicalStructureRuntimeSettings(): LogicalStructureRuntimeSettings {
  const provider = getStructuredExtractProvider();
  return {
    provider,
    model: normalizeNonEmpty(getStructuredExtractModel(provider))
  };
}

export function canExtractLogicalStructureWithLlm(settings: LogicalStructureRuntimeSettings): boolean {
  return settings.provider === 'gemini' || settings.provider === 'openai' || settings.provider === 'codex';
}

export function createLogicalStructureCacheFingerprint(settings: LogicalStructureRuntimeSettings): string {
  return [
    'llm-logical-structure',
    LOGICAL_STRUCTURE_LLM_PROMPT_VERSION,
    settings.provider,
    settings.model || 'default-model'
  ].join('|');
}

export async function extractLlmLogicalStructure(
  layout: HtmlDocumentLayout,
  settings: LogicalStructureRuntimeSettings,
  taskDocumentId?: string
): Promise<HtmlDocumentLogicalStructure> {
  const baseStructure = buildHtmlLogicalStructure(layout);
  const batches = collectHtmlLogicalSectionBatches(layout, baseStructure);
  const topicGroups = [];

  for (const batch of batches) {
    const responseText = await requestLogicalStructureBatch(batch, settings, taskDocumentId);
    const proposals = parseHtmlLogicalTopicProposals(responseText);
    topicGroups.push(...normalizeHtmlLogicalTopicGroups(batch, proposals));
  }

  return buildHtmlLogicalStructureFromTopicGroups(layout, baseStructure, topicGroups, {
    provider: settings.provider,
    ...(settings.model ? { model: settings.model } : {}),
    promptVersion: LOGICAL_STRUCTURE_LLM_PROMPT_VERSION,
    batchCount: batches.length
  });
}

async function requestLogicalStructureBatch(
  batch: ReturnType<typeof collectHtmlLogicalSectionBatches>[number],
  settings: LogicalStructureRuntimeSettings,
  taskDocumentId?: string
): Promise<string> {
  const prompt = buildLogicalStructurePrompt(batch);
  const response = await generateLogicalStructureTask({
    ...(taskDocumentId ? { documentId: taskDocumentId } : {}),
    prompt,
    provider: settings.provider,
    ...(settings.model ? { model: settings.model } : {})
  });
  return response.text;
}

function buildLogicalStructurePrompt(batch: ReturnType<typeof collectHtmlLogicalSectionBatches>[number]): string {
  const sectionLabel = batch.sectionPath.length > 0 ? batch.sectionPath.join(' > ') : 'Document root';
  const blockLines = batch.paragraphs.map((paragraph) => {
    const kind = paragraph.isListLike ? 'list-item-or-bullet' : 'paragraph';
    return `${paragraph.id} | page ${paragraph.pageNumber} | ${kind} | ${paragraph.text}`;
  });

  return [
    'You are segmenting ordered PDF paragraphs into logical reading units for a reader UI.',
    'Return JSON only.',
    'Schema: {"groups":[{"title":"short optional label","blockIds":["id1","id2"]}]}',
    'Rules:',
    '- Cover every provided block exactly once.',
    '- Preserve the original order.',
    '- Each group must contain contiguous block ids from the provided order.',
    '- Prefer semantically coherent units over raw paragraph boundaries, but be conservative about splitting.',
    '- A short lead-in paragraph followed by its bullet list should usually stay in the same group.',
    '- The default should be one group for the whole section or whole batch unless it is clearly too large.',
    '- If the current section is about 20 paragraphs or fewer, prefer one group covering the whole section or whole batch.',
    '- If you split, do it only for a genuinely large section or a strong internal topic shift.',
    '- Each group should usually contain at least about 10 sentences, unless the whole section or the remaining tail is shorter.',
    '- If a headed subsection is compact, prefer one group covering the whole subsection instead of splitting it into smaller paragraph-level groups.',
    '- Do not split a compact headed subsection unless there is a clear semantic break, such as a new experiment, a contrastive transition, or a distinct list/example block.',
    '- Do not invent ids, coordinates, or extra fields.',
    '- Keep titles short and optional.',
    `Section context: ${sectionLabel}`,
    `Section stats: ${batch.totalParagraphCount} paragraphs, about ${batch.totalSentenceCount} sentences.`,
    `Batch stats: batch ${batch.batchIndex} of ${batch.batchCount}, ${batch.paragraphs.length} paragraphs, about ${batch.paragraphs.reduce((sum, paragraph) => sum + paragraph.sentenceCount, 0)} sentences.`,
    'Ordered blocks:',
    ...blockLines
  ].join('\n');
}

function normalizeNonEmpty(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}
