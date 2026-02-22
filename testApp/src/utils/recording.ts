import type { HtmlDocumentLayout } from 'pdf-layout-parser';
import type { FocusRecording, RecordingParams } from '../types';

let recordingCounter = 0;

export function createFocusRecording(params: RecordingParams): FocusRecording {
  return {
    id: generateRecordingId(),
    provider: params.provider,
    query: params.query,
    createdAt: new Date().toISOString(),
    prompt: params.exchange.prompt,
    requestPayload: params.exchange.requestPayload,
    responsePayload: params.exchange.responsePayload,
    responseModel: params.response.model,
    responseCreatedAt: params.response.createdAt,
    querySummary: params.response.querySummary,
    annotations: params.response.annotations,
    document: cloneHtmlLayout(params.layout)
  };
}

export function cloneHtmlLayout(layout: HtmlDocumentLayout): HtmlDocumentLayout {
  return JSON.parse(JSON.stringify(layout)) as HtmlDocumentLayout;
}

export function generateRecordingId(): string {
  recordingCounter += 1;
  return `focus-recording-${Date.now()}-${recordingCounter}`;
}

export function formatRecordingLabel(recording: FocusRecording): string {
  const timestamp = formatRecordingTimestamp(recording.createdAt);
  return `${recording.query} (${timestamp})`;
}

export function formatRecordingTimestamp(value?: string): string {
  if (!value) {
    return 'unknown time';
  }
  try {
    const date = new Date(value);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  } catch {
    return value;
  }
}

export function formatJsonOutput(value: unknown): string {
  if (value === undefined) {
    return '[undefined]';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
