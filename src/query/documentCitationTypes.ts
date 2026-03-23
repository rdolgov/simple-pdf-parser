import type { PDFGlyphSpan, PDFImageBounds } from '../types.js';

export type DocumentCitationMatchStrategy = 'exact-quote' | 'normalized-quote' | 'block-fallback';

export interface DocumentCitationTextRun {
  text: string;
  bounds: PDFImageBounds;
  start: number;
  end: number;
  baselineStart?: { x: number; y: number };
  baselineEnd?: { x: number; y: number };
  glyphSpans?: PDFGlyphSpan[];
}

export interface DocumentCitationAnchor {
  documentId: string;
  pageNumber: number;
  quote: string;
  bounds: PDFImageBounds;
  evidenceId: string;
  matchStrategy: DocumentCitationMatchStrategy;
}

export interface DocumentAnswerCitation {
  id: string;
  evidenceId: string;
  label: string;
  quote: string;
  anchor: DocumentCitationAnchor;
}

export interface DocumentAnswerSegment {
  text: string;
  citationIds: string[];
}

export interface DocumentCitedAnswerResponse {
  answerText: string;
  segments: DocumentAnswerSegment[];
  citations: DocumentAnswerCitation[];
  model: string;
}

export type DocumentQuestionScope =
  | {
      kind: 'document';
      contextText?: string;
    }
  | {
      kind: 'selection';
      pageNumber: number;
      bounds: PDFImageBounds;
      contextText?: string;
    };

export interface AnswerDocumentQuestionRequest {
  documentId: string;
  question: string;
  provider?: 'gemini' | 'openai' | 'codex';
  model?: string | null;
  scope?: DocumentQuestionScope;
}
