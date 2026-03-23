import type { DocumentAnswerCitation, DocumentCitedAnswerResponse } from 'pdf-layout-parser';
import { renderMarkdownToHtml } from '../utils/markdownRenderer';

interface CitedAnswerMessageProps {
  answer: DocumentCitedAnswerResponse;
  onCitationClick?: (citation: DocumentAnswerCitation) => void;
}

export function CitedAnswerMessage({ answer, onCitationClick }: CitedAnswerMessageProps): JSX.Element {
  const citationById = new Map(answer.citations.map((citation) => [citation.id, citation] as const));
  const hasInlineCitations = answer.segments.some((segment) => segment.citationIds.length > 0);

  if (!hasInlineCitations) {
    return (
      <div
        className="mini-chat-message-content mini-chat-markdown"
        dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(answer.answerText) }}
      />
    );
  }

  return (
    <div className="mini-chat-cited-answer">
      {answer.segments.map((segment, index) => {
        const citations = segment.citationIds
          .map((citationId) => citationById.get(citationId))
          .filter((citation): citation is DocumentAnswerCitation => Boolean(citation));

        return (
          <div key={`${index}-${segment.text.slice(0, 24)}`} className="mini-chat-cited-segment">
            <span
              className="mini-chat-markdown"
              dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(segment.text) }}
            />
            {citations.length > 0 ? (
              <span className="mini-chat-inline-citations">
                {citations.map((citation) => (
                  <button
                    key={citation.id}
                    type="button"
                    className="mini-chat-citation-chip"
                    onClick={() => onCitationClick?.(citation)}
                    title={`${citation.quote} (page ${citation.anchor.pageNumber})`}
                  >
                    {citation.label}
                  </button>
                ))}
              </span>
            ) : null}
          </div>
        );
      })}
      {answer.citations.length > 0 ? (
        <div className="mini-chat-citation-list">
          {answer.citations.map((citation) => (
            <button
              key={citation.id}
              type="button"
              className="mini-chat-citation-row"
              onClick={() => onCitationClick?.(citation)}
              title={`Jump to page ${citation.anchor.pageNumber}`}
            >
              <span className="mini-chat-citation-row-label">{citation.label}</span>
              <span className="mini-chat-citation-row-page">p{citation.anchor.pageNumber}</span>
              <span className="mini-chat-citation-row-quote">"{citation.quote}"</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
