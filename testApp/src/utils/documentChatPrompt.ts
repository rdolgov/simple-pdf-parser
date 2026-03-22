import type { SemanticSearchResult } from '../search';
import type { ChatMessage } from '../storage/annotationStorage';

const MAX_RETRIEVAL_HISTORY_MESSAGES = 4;
const MAX_PROMPT_EXCERPTS = 6;
const MAX_EXCERPT_CHARS = 900;

function truncateExcerpt(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_EXCERPT_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_EXCERPT_CHARS - 1).trimEnd()}…`;
}

function formatConversationHistory(messages: ChatMessage[]): string {
  return messages
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n');
}

export function buildDocumentChatRetrievalQuery(
  messages: ChatMessage[],
  query: string
): string {
  const retrievalHistory = messages.slice(-MAX_RETRIEVAL_HISTORY_MESSAGES);
  if (retrievalHistory.length === 0) {
    return query;
  }

  return `${formatConversationHistory(retrievalHistory)}\nCurrent question: ${query}`;
}

export function formatDocumentChatContext(results: SemanticSearchResult[]): string {
  if (results.length === 0) {
    return 'Complete document context was provided without additional semantic excerpts.';
  }

  return results
    .slice(0, MAX_PROMPT_EXCERPTS)
    .map((result, index) => {
      const excerpt = truncateExcerpt(result.chunk.text);
      return `Excerpt ${index + 1} (page ${result.chunk.pageNumber}, score ${result.score.toFixed(3)}): ${excerpt}`;
    })
    .join('\n');
}

export function buildDocumentChatPrompt(input: {
  query: string;
  messages: ChatMessage[];
  fullDocumentContext: string;
  results: SemanticSearchResult[];
  enableWebSearch: boolean;
  provider: 'gemini' | 'openai' | 'codex';
}): string {
  const conversationHistory = formatConversationHistory(input.messages);
  const excerptSection = input.results.length > 0
    ? input.results
        .slice(0, MAX_PROMPT_EXCERPTS)
        .map((result, index) => {
          const excerpt = truncateExcerpt(result.chunk.text);
          return [
            `Excerpt ${index + 1}`,
            `Page: ${result.chunk.pageNumber}`,
            `Relevance score: ${result.score.toFixed(3)}`,
            excerpt
          ].join('\n');
        })
        .join('\n\n')
    : 'No relevant document excerpts were retrieved for this question.';
  const webSearchHint = input.enableWebSearch
    ? input.provider === 'gemini'
      ? '\n\nYou may use web search only as supplemental background. Separate any web-derived claims from document-grounded claims.'
      : '\n\nIf the excerpts do not answer the question, say that the document context is insufficient.'
    : '';

  return `You are a helpful assistant answering questions about an entire PDF document.
You are given the complete document context for the whole PDF as structured JSON.
You are also given retrieved excerpts that may help you find the most relevant parts faster.
The full document context is authoritative; do not conclude that context is insufficient just because the retrieved excerpts are sparse or mostly headings/table labels.
Use the full document context first, then use the retrieved excerpts as navigational hints.
Cite page numbers in your answer when you rely on the document.
If the excerpts do not support an answer, clearly say that the available document context is insufficient instead of guessing.${webSearchHint}

Complete document context:
${input.fullDocumentContext}

Retrieved document excerpts:
${excerptSection}${conversationHistory ? `\n\nPrevious conversation:\n${conversationHistory}` : ''}

Current question: ${input.query}

Answer:`;
}
