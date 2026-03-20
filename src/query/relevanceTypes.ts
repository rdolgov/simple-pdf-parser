import type { HtmlDocumentLayout, HtmlContentBlock, HtmlPageLayout } from '../html/htmlLayoutConverter.js';
import type { OpenAiCompatibleProvider } from './openAiCompatibleProvider.js';

export type RelevanceState = 'highlight' | 'dim' | 'hidden';

export interface BlockRelevanceAnnotation {
  pageNumber: number;
  blockIndex: number;
  state: RelevanceState;
  summary?: string;
  rewrittenText?: string;
  rationale?: string;
  confidence?: number;
  matchRanges?: MatchRange[];
}

export interface RelevanceResponse {
  annotations: BlockRelevanceAnnotation[];
  model?: string;
  createdAt?: string;
  querySummary?: string;
}

export interface RelevanceQueryInput {
  query: string;
  document: HtmlDocumentLayout;
  maxContextTokens?: number;
}

export interface RelevanceServiceConfig {
  provider: OpenAiCompatibleProvider | 'anthropic' | 'custom';
  apiKey?: string;
  model?: string;
  endpoint?: string;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  roleHint?: string;
  dangerouslyAllowBrowser?: boolean;
  debugRecorder?: (exchange: RelevanceDebugExchange) => void;
}

export interface RelevanceService {
  analyze(input: RelevanceQueryInput): Promise<RelevanceResponse>;
}

export type AnnotatedHtmlContentBlock = HtmlContentBlock & {
  relevance?: {
    state: RelevanceState;
    summary?: string;
    rewrittenText?: string;
    rationale?: string;
    confidence?: number;
    matchRanges?: MatchRange[];
  };
};

export type AnnotatedHtmlPageLayout = Omit<HtmlPageLayout, 'content'> & {
  content: AnnotatedHtmlContentBlock[];
};

export interface AnnotatedHtmlDocumentLayout {
  pages: AnnotatedHtmlPageLayout[];
  query?: string;
  querySummary?: string;
  model?: string;
}

export type AnnotationHook = (
  block: HtmlContentBlock,
  annotation: BlockRelevanceAnnotation
) => AnnotatedHtmlContentBlock;

export interface RelevanceAugmenterOptions {
  defaultState?: RelevanceState;
  annotationHook?: AnnotationHook;
  query?: string;
}

export interface RelevanceAugmenter {
  augment(
    base: HtmlDocumentLayout,
    annotations: RelevanceResponse,
    options?: RelevanceAugmenterOptions
  ): AnnotatedHtmlDocumentLayout;
}

export interface MatchRange {
  start: number;
  end: number;
}

export interface RelevanceDebugExchange {
  provider: string;
  query: string;
  prompt?: string;
  requestPayload: Record<string, unknown>;
  responsePayload: unknown;
}
