import { useCallback, useMemo } from 'react';
import type { StructuredDataDocument } from 'pdf-layout-parser';
import type { AiDetectionSupport } from '../utils/aiDetectionSupport';
import type { ExtractState } from './useDocumentLoader';
import type { GeminiDocumentExtraction } from '../storage/geminiExtractionStorage';
import { deriveGeminiExtractionFromStructuredData } from '../utils/structuredExtractToGemini';

export interface GeminiExtractionState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  extraction: GeminiDocumentExtraction | null;
  error?: string;
}

export interface UseGeminiExtractionOptions {
  documentHash: string | null;
  extractDocument: StructuredDataDocument | null;
  extractState: ExtractState;
  aiDetectionSupport?: AiDetectionSupport;
}

export interface UseGeminiExtractionResult {
  state: GeminiExtractionState;
  triggerExtraction: () => Promise<void>;
  clearExtraction: () => void;
}

export function useGeminiExtraction({
  documentHash,
  extractDocument,
  extractState,
  aiDetectionSupport = { supported: true }
}: UseGeminiExtractionOptions): UseGeminiExtractionResult {
  const derivedExtraction = useMemo(() => {
    if (!extractDocument) {
      return null;
    }
    return deriveGeminiExtractionFromStructuredData(extractDocument);
  }, [extractDocument]);

  const state = useMemo<GeminiExtractionState>(() => {
    if (!documentHash || !aiDetectionSupport.supported) {
      return { status: 'idle', extraction: null };
    }

    if (extractState.status === 'loading') {
      return { status: 'loading', extraction: null };
    }

    if (extractState.status === 'error') {
      return {
        status: 'error',
        extraction: null,
        error: extractState.message ?? 'AI extraction failed.'
      };
    }

    if (derivedExtraction) {
      return {
        status: 'ready',
        extraction: derivedExtraction
      };
    }

    return { status: 'idle', extraction: null };
  }, [aiDetectionSupport.supported, derivedExtraction, documentHash, extractState.message, extractState.status]);

  const triggerExtraction = useCallback(async () => {
    return;
  }, []);

  const clearExtraction = useCallback(() => {
    return;
  }, []);

  return { state, triggerExtraction, clearExtraction };
}
