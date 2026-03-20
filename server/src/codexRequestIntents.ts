import { parseCodexResponsesRequest, type ParsedCodexResponsesRequest } from './codexResponses.js';

export type CodexRequestIntent = 'interactive-widget' | 'logical-structure' | 'generic';

export interface CodexRequestSummary {
  intent: CodexRequestIntent;
  model?: string;
  textChars: number;
  attachmentCount: number;
  messageCount: number;
}

const INTERACTIVE_WIDGET_MARKER = 'interactive_widget_v1';
const LOGICAL_STRUCTURE_MARKERS = [
  'You are segmenting ordered PDF paragraphs into logical reading units for a reader UI.',
  'Schema: {"groups":[{"title":"short optional label","blockIds":["id1","id2"]}]}'
];

export function summarizeCodexResponsesBody(body: Buffer): CodexRequestSummary {
  return summarizeCodexRequest(parseCodexResponsesRequest(body));
}

export function summarizeCodexRequest(request: ParsedCodexResponsesRequest): CodexRequestSummary {
  const combinedText = collectRequestText(request);
  const attachmentCount = request.messages.reduce((sum, message) => sum + message.attachments.length, 0);

  return {
    intent: detectCodexRequestIntent(combinedText),
    model: request.model,
    textChars: combinedText.length,
    attachmentCount,
    messageCount: request.messages.length
  };
}

function collectRequestText(request: ParsedCodexResponsesRequest): string {
  const sections: string[] = [];
  if (request.instructions) {
    sections.push(request.instructions);
  }
  request.messages.forEach((message) => {
    if (message.textParts.length > 0) {
      sections.push(message.textParts.join('\n'));
    }
  });
  return sections.join('\n\n');
}

function detectCodexRequestIntent(text: string): CodexRequestIntent {
  if (text.includes(INTERACTIVE_WIDGET_MARKER)) {
    return 'interactive-widget';
  }

  if (LOGICAL_STRUCTURE_MARKERS.some((marker) => text.includes(marker))) {
    return 'logical-structure';
  }

  return 'generic';
}
