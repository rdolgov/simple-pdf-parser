import { createHash } from 'node:crypto';
import {
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  type DocumentAnswerCitation,
  type DocumentAnswerSegment,
  type DocumentCitedAnswerResponse,
  type DocumentQuestionScope
} from '../../src/index.js';
import { executeTextTask, type TaskServerProvidersConfig, type TaskTextProvider } from './taskExecutors.js';
import { TaskStore, type StoredDocumentRecord } from './taskStore.js';
import {
  buildSemanticIndex,
  searchSemanticIndex,
  type StoredSemanticIndex,
  type TaskSemanticProvider
} from './taskSemanticSearch.js';
import { locateEvidenceQuote, resolveDocumentCitationAnchor } from './documentCitationAnchors.js';
import {
  loadOrBuildEvidenceIndex,
  normalizeSearchText,
  type DocumentEvidenceIndex,
  type DocumentEvidenceRecord
} from './documentEvidenceIndex.js';

interface RawCitationReference {
  evidenceId?: unknown;
  quote?: unknown;
}

interface RawAnswerSegment {
  text?: unknown;
  citations?: unknown;
}

const RETRIEVAL_LIMIT = 8;

export async function answerDocumentQuestion(
  input: {
    document: StoredDocumentRecord;
    question: string;
    provider?: TaskTextProvider;
    model?: string;
    scope?: DocumentQuestionScope;
  },
  config: TaskServerProvidersConfig,
  taskStore: TaskStore
): Promise<DocumentCitedAnswerResponse> {
  const provider = input.provider ?? 'gemini';
  const evidenceIndex = await loadOrBuildEvidenceIndex(input.document, taskStore);
  const retrievedEvidence = await retrieveRelevantEvidence(
    {
      document: input.document,
      question: input.question,
      scope: input.scope,
      provider,
      evidenceIndex
    },
    config,
    taskStore
  );

  if (retrievedEvidence.length === 0) {
    return buildUnsupportedAnswer(providerLabel(provider), 'The document does not provide enough text evidence to answer this question.');
  }

  const prompt = buildDocumentQuestionPrompt({
    question: input.question,
    scope: input.scope,
    evidence: retrievedEvidence
  });
  const response = await executeTextTask(
    {
      provider,
      ...(input.model?.trim() ? { model: input.model.trim() } : {}),
      prompt,
      responseFormat: 'json'
    },
    config
  );

  const parsed = parseStructuredAnswer(response.text);
  return materializeValidatedAnswer({
    documentId: input.document.id,
    model: response.model,
    evidence: retrievedEvidence,
    parsed
  });
}

async function retrieveRelevantEvidence(
  input: {
    document: StoredDocumentRecord;
    question: string;
    scope?: DocumentQuestionScope;
    provider: TaskTextProvider;
    evidenceIndex: DocumentEvidenceIndex;
  },
  config: TaskServerProvidersConfig,
  taskStore: TaskStore
): Promise<DocumentEvidenceRecord[]> {
  const normalizedQuestion = normalizeSearchText(input.question);
  const lexicalScores = new Map<string, number>();

  for (const record of input.evidenceIndex.records) {
    lexicalScores.set(record.evidenceId, computeLexicalScore(record, normalizedQuestion, input.scope));
  }

  const semanticProvider = resolveSemanticProvider(input.provider, config);
  const semanticScores = semanticProvider
    ? await searchEvidenceSemantically(input.document, input.evidenceIndex, input.question, semanticProvider, config, taskStore)
    : new Map<string, number>();

  return input.evidenceIndex.records
    .map((record) => ({
      record,
      score: (lexicalScores.get(record.evidenceId) ?? 0) + (semanticScores.get(record.evidenceId) ?? 0)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, RETRIEVAL_LIMIT)
    .map((entry) => entry.record);
}

async function searchEvidenceSemantically(
  document: StoredDocumentRecord,
  evidenceIndex: DocumentEvidenceIndex,
  query: string,
  provider: TaskSemanticProvider,
  config: TaskServerProvidersConfig,
  taskStore: TaskStore
): Promise<Map<string, number>> {
  const model = resolveSemanticModel(provider);
  const fingerprint = createHash('sha1')
    .update(`citation-evidence:v1:${provider}:${model}`)
    .digest('hex');
  let index = await taskStore.getSemanticIndex<StoredSemanticIndex>(document.id, fingerprint);

  if (!index) {
    index = await buildSemanticIndex(
      {
        documentId: document.id,
        documentHash: document.fileHash,
        provider,
        model,
        chunks: evidenceIndex.records.map((record, index) => ({
          id: record.evidenceId,
          text: record.text,
          pageNumber: record.pageNumber,
          bounds: record.bounds,
          sentenceIndex: index
        }))
      },
      config
    );
    await taskStore.setSemanticIndex(document.id, fingerprint, index);
  }

  const result = await searchSemanticIndex(
    {
      index,
      query,
      provider,
      model,
      topK: RETRIEVAL_LIMIT,
      minScore: 0.2
    },
    config
  );

  const scores = new Map<string, number>();
  for (const hit of result.results) {
    scores.set(hit.chunk.id, hit.score * 3);
  }
  return scores;
}

function buildDocumentQuestionPrompt(input: {
  question: string;
  scope?: DocumentQuestionScope;
  evidence: DocumentEvidenceRecord[];
}): string {
  const scopeText = input.scope?.kind === 'selection'
    ? [
        `The question came from a selected region on page ${input.scope.pageNumber}.`,
        `Selection bounds: x=${formatNumber(input.scope.bounds.minX)}-${formatNumber(input.scope.bounds.maxX)}, y=${formatNumber(input.scope.bounds.minY)}-${formatNumber(input.scope.bounds.maxY)}.`,
        input.scope.contextText ? `Selected context:\n"""${input.scope.contextText.trim()}"""` : ''
      ].filter(Boolean).join('\n')
    : input.scope?.contextText
      ? `Document context hint:\n"""${input.scope.contextText.trim()}"""`
      : 'The question is about the whole document.';

  const evidenceText = input.evidence
    .map((record) => [
      `Evidence ID: ${record.evidenceId}`,
      `Page: ${record.pageNumber}`,
      `Kind: ${record.kind}`,
      'Text:',
      `"""${record.text}"""`
    ].join('\n'))
    .join('\n\n');

  return `You answer questions about a PDF using only the provided evidence.
Return strict JSON with this shape:
{
  "segments": [
    {
      "text": "answer text",
      "citations": [
        {
          "evidenceId": "Evidence ID from the prompt",
          "quote": "short verbatim support quote copied from that evidence"
        }
      ]
    }
  ]
}

Rules:
- Use only the evidence provided below.
- Every grounded factual segment must include at least one citation.
- Every citation quote must be copied verbatim from the cited evidence block.
- Do not invent evidence ids.
- Do not output coordinates.
- If the evidence is insufficient, return one segment explaining that and use an empty citations array.

${scopeText}

Question:
${input.question}

Evidence:
${evidenceText}

JSON:`;
}

function materializeValidatedAnswer(input: {
  documentId: string;
  model: string;
  evidence: DocumentEvidenceRecord[];
  parsed: unknown;
}): DocumentCitedAnswerResponse {
  const evidenceById = new Map(input.evidence.map((record) => [record.evidenceId, record] as const));
  const rawSegments = normalizeRawSegments(input.parsed);
  const citations: DocumentAnswerCitation[] = [];
  const citationKeyToId = new Map<string, string>();
  const segments: DocumentAnswerSegment[] = [];

  for (const rawSegment of rawSegments) {
    const text = normalizeNonEmptyString(rawSegment.text);
    if (!text) {
      continue;
    }

    const citationIds: string[] = [];
    for (const rawCitation of normalizeRawCitations(rawSegment.citations)) {
      const evidenceId = normalizeNonEmptyString(rawCitation.evidenceId);
      const quote = normalizeNonEmptyString(rawCitation.quote);
      if (!evidenceId || !quote) {
        continue;
      }

      const record = evidenceById.get(evidenceId);
      if (!record) {
        continue;
      }

      const match = locateEvidenceQuote(record, quote);
      if (!match) {
        continue;
      }

      const citationKey = `${record.evidenceId}:${match.start}:${match.end}`;
      let citationId = citationKeyToId.get(citationKey);
      if (!citationId) {
        citationId = `c${citations.length + 1}`;
        citationKeyToId.set(citationKey, citationId);
        citations.push({
          id: citationId,
          evidenceId: record.evidenceId,
          label: `[${citations.length + 1}]`,
          quote: match.quote,
          anchor: resolveDocumentCitationAnchor(input.documentId, record, match, quote)
        });
      }
      citationIds.push(citationId);
    }

    const uniqueCitationIds = [...new Set(citationIds)];
    if (uniqueCitationIds.length === 0) {
      continue;
    }

    segments.push({
      text,
      citationIds: uniqueCitationIds
    });
  }

  if (segments.length === 0 || citations.length === 0) {
    return buildUnsupportedAnswer(input.model, resolveUnsupportedMessage(rawSegments));
  }

  return {
    answerText: segments.map((segment) => segment.text).join(' ').trim(),
    segments,
    citations,
    model: input.model
  };
}

function normalizeRawSegments(value: unknown): RawAnswerSegment[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord) as RawAnswerSegment[];
  }
  if (!isRecord(value)) {
    return [];
  }
  if (Array.isArray(value.segments)) {
    return value.segments.filter(isRecord) as RawAnswerSegment[];
  }
  if (isRecord(value.answer) && Array.isArray(value.answer.segments)) {
    return value.answer.segments.filter(isRecord) as RawAnswerSegment[];
  }
  return [];
}

function normalizeRawCitations(value: unknown): RawCitationReference[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord) as RawCitationReference[];
}

function parseStructuredAnswer(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const direct = safeParseJson(trimmed);
  if (direct !== null) {
    return direct;
  }

  const unwrapped = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const unwrappedParsed = safeParseJson(unwrapped);
  if (unwrappedParsed !== null) {
    return unwrappedParsed;
  }

  const start = unwrapped.indexOf('{');
  const end = unwrapped.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return safeParseJson(unwrapped.slice(start, end + 1));
  }

  return null;
}

function resolveUnsupportedMessage(rawSegments: RawAnswerSegment[]): string {
  const candidate = rawSegments
    .map((segment) => normalizeNonEmptyString(segment.text))
    .find((text) => text && /insufficient|not enough|cannot determine|does not provide|not provided/i.test(text));
  return candidate ?? 'The document does not provide enough supported evidence to answer this question.';
}

function buildUnsupportedAnswer(model: string, message: string): DocumentCitedAnswerResponse {
  const text = message.trim() || 'The document does not provide enough supported evidence to answer this question.';
  return {
    answerText: text,
    segments: [
      {
        text,
        citationIds: []
      }
    ],
    citations: [],
    model
  };
}

function computeLexicalScore(
  record: DocumentEvidenceRecord,
  normalizedQuestion: string,
  scope: DocumentQuestionScope | undefined
): number {
  if (!normalizedQuestion) {
    return 0;
  }

  let score = 0;
  if (record.normalizedText.includes(normalizedQuestion)) {
    score += 6;
  }

  const queryTokens = tokenize(normalizedQuestion);
  if (queryTokens.length === 0) {
    return score + computeScopeBias(record, scope);
  }

  const recordTokens = new Set(tokenize(record.normalizedText));
  let overlap = 0;
  for (const token of queryTokens) {
    if (recordTokens.has(token)) {
      overlap += 1;
    } else if (record.normalizedText.includes(token)) {
      overlap += 0.5;
    }
  }

  score += overlap;
  return score + computeScopeBias(record, scope);
}

function computeScopeBias(record: DocumentEvidenceRecord, scope: DocumentQuestionScope | undefined): number {
  if (!scope || scope.kind !== 'selection') {
    return 0;
  }

  if (scope.pageNumber !== record.pageNumber) {
    return 0;
  }

  if (boundsOverlap(record.bounds, scope.bounds)) {
    return 4;
  }

  return boundsDistance(record.bounds, scope.bounds) <= 72 ? 1.5 : 0.5;
}

function boundsOverlap(left: DocumentEvidenceRecord['bounds'], right: DocumentEvidenceRecord['bounds']): boolean {
  return !(
    left.maxX < right.minX ||
    left.minX > right.maxX ||
    left.maxY < right.minY ||
    left.minY > right.maxY
  );
}

function boundsDistance(left: DocumentEvidenceRecord['bounds'], right: DocumentEvidenceRecord['bounds']): number {
  const dx = left.maxX < right.minX
    ? right.minX - left.maxX
    : right.maxX < left.minX
      ? left.minX - right.maxX
      : 0;
  const dy = left.maxY < right.minY
    ? right.minY - left.maxY
    : right.maxY < left.minY
      ? left.minY - right.maxY
      : 0;
  return Math.hypot(dx, dy);
}

function tokenize(text: string): string[] {
  return text
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function resolveSemanticProvider(
  provider: TaskTextProvider,
  config: TaskServerProvidersConfig
): TaskSemanticProvider | null {
  if (provider === 'openai' && config.openAiApiKey) {
    return 'openai';
  }
  if (config.geminiApiKey) {
    return 'gemini';
  }
  if (config.openAiApiKey) {
    return 'openai';
  }
  return null;
}

function resolveSemanticModel(provider: TaskSemanticProvider): string {
  return provider === 'openai' ? DEFAULT_OPENAI_EMBEDDING_MODEL : DEFAULT_GEMINI_EMBEDDING_MODEL;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '0.0';
}

function providerLabel(provider: TaskTextProvider): string {
  return provider;
}
