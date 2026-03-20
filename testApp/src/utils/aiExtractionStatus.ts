import type { ExtractState, GeminiExtractionState } from '../hooks';
import type { AiDetectionSupport } from './aiDetectionSupport';

export interface AiExtractionStatusView {
  label: string;
  title: string;
  tone: 'neutral' | 'loading' | 'ready' | 'partial' | 'unsupported' | 'error';
}

export function getAiExtractionStatusView(input: {
  extractState: ExtractState;
  geminiExtractionState: GeminiExtractionState;
  aiDetectionSupport: AiDetectionSupport;
}): AiExtractionStatusView {
  const { extractState, geminiExtractionState, aiDetectionSupport } = input;

  if (!aiDetectionSupport.supported) {
    return {
      label: 'AI unsupported',
      title: aiDetectionSupport.message ?? 'This PDF does not support AI extraction.',
      tone: 'unsupported'
    };
  }

  if (extractState.status === 'loading' || geminiExtractionState.status === 'loading') {
    return {
      label: 'AI detecting',
      title: 'AI extraction is currently running for this document.',
      tone: 'loading'
    };
  }

  if (extractState.status === 'error' || geminiExtractionState.status === 'error') {
    return {
      label: 'AI error',
      title: extractState.message ?? geminiExtractionState.error ?? 'AI extraction failed for this document.',
      tone: 'error'
    };
  }

  const structuredReady = extractState.status === 'ready';
  const layoutReady = geminiExtractionState.status === 'ready';

  if (structuredReady && layoutReady) {
    return {
      label: 'AI extracted',
      title: 'Structured extract and layout detection are both available for this document.',
      tone: 'ready'
    };
  }

  if (structuredReady) {
    return {
      label: 'AI tables/images',
      title: 'Structured extract is available, but layout detection has not been run for this document.',
      tone: 'partial'
    };
  }

  if (layoutReady) {
    return {
      label: 'AI layout',
      title: 'Layout detection is available, but structured extract has not been run for this document.',
      tone: 'partial'
    };
  }

  return {
    label: 'Parser only',
    title: 'This document is currently using only local PDF parsing. AI extraction has not been run yet.',
    tone: 'neutral'
  };
}
