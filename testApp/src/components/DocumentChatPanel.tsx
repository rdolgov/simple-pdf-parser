import { useCallback, useEffect, useRef } from 'react';
import type { SemanticSearchResult } from '../search';
import type { ChatMessage } from '../storage/annotationStorage';
import { MiniChatView } from './MiniChatView';
import {
  buildDocumentChatPrompt,
  buildDocumentChatRetrievalQuery,
  formatDocumentChatContext
} from '../utils/documentChatPrompt';

interface DocumentChatPanelProps {
  documentId: string;
  taskDocumentId?: string | null;
  fullDocumentContext: string;
  isIndexed: boolean;
  isIndexing: boolean;
  onStartIndexing?: () => Promise<void>;
  retrieveRelevantChunks: (query: string) => Promise<SemanticSearchResult[]>;
  enableWebSearch: boolean;
  onClose: () => void;
  onChatActivityChange?: (delta: number) => void;
}

export function DocumentChatPanel({
  documentId,
  taskDocumentId,
  fullDocumentContext,
  isIndexed,
  isIndexing,
  onStartIndexing,
  retrieveRelevantChunks,
  enableWebSearch,
  onClose,
  onChatActivityChange
}: DocumentChatPanelProps): JSX.Element {
  const hasRequestedIndexRef = useRef(false);

  useEffect(() => {
    if (isIndexed || isIndexing || !onStartIndexing || hasRequestedIndexRef.current) {
      return;
    }
    hasRequestedIndexRef.current = true;
    void onStartIndexing();
  }, [isIndexed, isIndexing, onStartIndexing]);

  const buildPrompt = useCallback(async (input: {
    query: string;
    messages: ChatMessage[];
    contextText: string;
    enableWebSearch: boolean;
    provider: 'gemini' | 'openai' | 'codex';
  }) => {
    const results = isIndexed
      ? await retrieveRelevantChunks(buildDocumentChatRetrievalQuery(input.messages, input.query))
      : [];

    return {
      prompt: buildDocumentChatPrompt({
        query: input.query,
        messages: input.messages,
        fullDocumentContext,
        results,
        enableWebSearch: input.enableWebSearch,
        provider: input.provider
      }),
      contextText: formatDocumentChatContext(results)
    };
  }, [fullDocumentContext, isIndexed, retrieveRelevantChunks]);

  return (
    <MiniChatView
      contextText="Whole-document chat using semantic retrieval over the current PDF."
      documentId={documentId}
      taskDocumentId={taskDocumentId}
      onClose={onClose}
      enableWebSearch={enableWebSearch}
      onChatActivityChange={onChatActivityChange}
      chatScope="document"
      variant="docked"
      title="Document Chat - PDF-wide answers"
      emptyStateMessage={
        isIndexed
          ? 'Ask a question about the full document...'
          : isIndexing
            ? 'Ask now. Semantic search is still indexing the document.'
            : 'Ask a question about the full document...'
      }
      inputPlaceholder={isIndexed ? 'Ask about the whole document...' : 'Ask while indexing continues...'}
      buildPrompt={buildPrompt}
    />
  );
}
