const ANSWER_MARKER = 'ANSWER:';
export class DocumentAnswerPreviewStream {
  private readonly rawChunks: string[] = [];
  private emittedLength = 0;

  push(delta: string): string {
    if (delta.length === 0) {
      return '';
    }
    this.rawChunks.push(delta);
    const answer = extractDocumentAnswerPreview(this.rawChunks.join(''));
    if (answer.length <= this.emittedLength) {
      return '';
    }
    const next = answer.slice(this.emittedLength);
    this.emittedLength = answer.length;
    return next;
  }

  getText(): string {
    return extractDocumentAnswerPreview(this.rawChunks.join(''));
  }
}

export function extractDocumentAnswerPreview(text: string): string {
  const answerStart = text.indexOf(ANSWER_MARKER);
  if (answerStart < 0) {
    return '';
  }

  const contentStart = answerStart + ANSWER_MARKER.length;
  const afterMarker = text.slice(contentStart);
  const normalizedStart = afterMarker.startsWith('\r\n')
    ? 2
    : afterMarker.startsWith('\n')
      ? 1
      : 0;
  const body = afterMarker.slice(normalizedStart);
  const jsonIndex = findJsonMarkerIndex(body);
  return (jsonIndex >= 0 ? body.slice(0, jsonIndex) : body).trimStart();
}

function findJsonMarkerIndex(text: string): number {
  const match = /(?:\r?\n)+JSON:/.exec(text);
  return typeof match?.index === 'number' ? match.index : -1;
}
