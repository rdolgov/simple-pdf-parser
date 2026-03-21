import {
  buildHtmlLogicalStructure,
  buildHtmlLogicalStructureFromTopicGroups,
  collectHtmlLogicalSectionBatches,
  isOpenAiCompatibleProvider,
  normalizeHtmlLogicalTopicGroups,
  parseHtmlLogicalTopicProposals,
  type HtmlDocumentLayout,
  type HtmlDocumentLogicalStructure,
  type StructuredExtractProvider
} from 'pdf-layout-parser';
import { createTransportedGeminiApi, createTransportedOpenAiApi, hasRuntimeProviderAccess } from './llmClients';
import { getLlmProxyBaseUrl, getLlmTransportMode, type LlmTransportMode } from './llmTransportSettings';
import {
  getStructuredExtractApiKey,
  getStructuredExtractModel,
  getStructuredExtractProvider
} from './structuredExtractSettings';

export const LOGICAL_STRUCTURE_LLM_PROMPT_VERSION = 'v2';

export interface LogicalStructureRuntimeSettings {
  provider: StructuredExtractProvider;
  directApiKey: string;
  model: string;
  transportMode: LlmTransportMode;
  proxyBaseUrl: string;
}

export function loadLogicalStructureRuntimeSettings(): LogicalStructureRuntimeSettings {
  const provider = getStructuredExtractProvider();
  return {
    provider,
    directApiKey: normalizeNonEmpty(getStructuredExtractApiKey(provider)),
    model: normalizeNonEmpty(getStructuredExtractModel(provider)),
    transportMode: getLlmTransportMode(),
    proxyBaseUrl: normalizeNonEmpty(getLlmProxyBaseUrl())
  };
}

export function canExtractLogicalStructureWithLlm(settings: LogicalStructureRuntimeSettings): boolean {
  return hasRuntimeProviderAccess(settings.provider, settings.directApiKey);
}

export function createLogicalStructureCacheFingerprint(settings: LogicalStructureRuntimeSettings): string {
  return [
    'llm-logical-structure',
    LOGICAL_STRUCTURE_LLM_PROMPT_VERSION,
    settings.provider,
    settings.model || 'default-model',
    settings.transportMode,
    settings.proxyBaseUrl || 'default-proxy'
  ].join('|');
}

export async function extractLlmLogicalStructure(
  layout: HtmlDocumentLayout,
  settings: LogicalStructureRuntimeSettings
): Promise<HtmlDocumentLogicalStructure> {
  const baseStructure = buildHtmlLogicalStructure(layout);
  const batches = collectHtmlLogicalSectionBatches(layout, baseStructure);
  const topicGroups = [];

  for (const batch of batches) {
    const responseText = await requestLogicalStructureBatch(batch, settings);
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
  settings: LogicalStructureRuntimeSettings
): Promise<string> {
  const prompt = buildLogicalStructurePrompt(batch);

  if (isOpenAiCompatibleProvider(settings.provider)) {
    const client = createTransportedOpenAiApi({
      apiKey: settings.directApiKey,
      ...(settings.model ? { model: settings.model } : {})
    }, settings.provider);
    const response = await client.generateText(prompt, {
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1800
      }
    });
    return response.text;
  }

  const client = createTransportedGeminiApi({
    apiKey: settings.directApiKey,
    ...(settings.model ? { model: settings.model } : {})
  });
  const response = await client.generateText(prompt, {
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1800,
      responseMimeType: 'application/json'
    }
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
    '- Prefer semantically coherent units over raw paragraph boundaries.',
    '- A short lead-in paragraph followed by its bullet list should usually stay in the same group.',
    '- A group may be one paragraph, several paragraphs, an entire short subsection, or a whole short section when that is the most coherent unit.',
    '- If a headed subsection is compact, prefer one group covering the whole subsection instead of splitting it into smaller paragraph-level groups.',
    '- Treat a headed subsection as compact when it has about 1 to 3 short paragraphs and no strong internal topic shift.',
    '- Do not split a compact headed subsection unless there is a clear semantic break, such as a new experiment, a contrastive transition, or a distinct list/example block.',
    '- Do not invent ids, coordinates, or extra fields.',
    '- Keep titles short and optional.',
    `Section context: ${sectionLabel}`,
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
