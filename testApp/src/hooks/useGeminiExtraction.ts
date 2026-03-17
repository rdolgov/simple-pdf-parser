import { useState, useEffect, useCallback } from 'react';
import type { StructuredExtractProvider } from 'pdf-layout-parser';
import {
  type GeminiDocumentExtraction,
  type GeminiExtractionRecord,
  getGeminiExtraction,
  saveGeminiExtraction,
  parseGeminiExtractionResponse
} from '../storage/geminiExtractionStorage';
import { getRewriteApiKey, getRewriteModel, getRewriteProvider, setRewriteApiKey } from '../utils/rewriteProviderSettings';
import type { AiDetectionSupport } from '../utils/aiDetectionSupport';
import { createTransportedGeminiApi, createTransportedOpenAiApi } from '../utils/llmClients';
import { isProxyTransportEnabled } from '../utils/llmTransportSettings';

const EXTRACTION_PROMPT = `Convert this PDF to JSON format with the following structure:
{
  "document_title": "...",
  "pages": [
    {
      "page_number": 1,
      "elements": [
        {
          "type": "title|heading|paragraph|reference|image|table|formula|caption|list|footnote|authors",
          "content": "text content or description",
          "bounding_box": [x, y, width, height]
        }
      ]
    }
  ]
}

Important instructions:
- Extract ALL text paragraphs, tables, images, formulas, and references
- The bounding_box should be [x, y, width, height] as ratios (0-1) of page dimensions
- x is the left position, y is the top position (from top of page)
- Detect reference citations (e.g., [1] Author. Title...) and mark them as type "reference"
- Include accurate bounding boxes for EACH element
- Return ONLY the JSON, no additional text`;

export interface GeminiExtractionState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  extraction: GeminiDocumentExtraction | null;
  error?: string;
}

export interface UseGeminiExtractionOptions {
  documentHash: string | null;
  pdfData: ArrayBuffer | null;
  autoExtract?: boolean;
  aiDetectionSupport?: AiDetectionSupport;
}

export interface UseGeminiExtractionResult {
  state: GeminiExtractionState;
  triggerExtraction: () => Promise<void>;
  clearExtraction: () => void;
}

export function useGeminiExtraction({
  documentHash,
  pdfData,
  autoExtract = false,
  aiDetectionSupport = { supported: true }
}: UseGeminiExtractionOptions): UseGeminiExtractionResult {
  const [state, setState] = useState<GeminiExtractionState>({
    status: 'idle',
    extraction: null
  });

  // Load cached extraction when document hash changes
  useEffect(() => {
    if (!documentHash) {
      setState({ status: 'idle', extraction: null });
      return;
    }

    if (!aiDetectionSupport.supported) {
      setState({ status: 'idle', extraction: null });
      return;
    }

    let cancelled = false;

    async function loadCached() {
      try {
        const cached = await getGeminiExtraction(documentHash!);
        if (cancelled) return;

        const activeProvider = getRewriteProvider();
        const configuredModel = getRewriteModel(activeProvider);
        const cacheCompatible = cached
          ? isExtractionCacheCompatible(cached, activeProvider, configuredModel)
          : false;

        if (cached && cacheCompatible) {
          console.log('[GeminiExtraction] Loaded cached extraction for', documentHash);
          setState({ status: 'ready', extraction: cached.extraction });
        } else if (cached && !cacheCompatible) {
          console.log('[GeminiExtraction] Ignoring cached extraction due to provider/model mismatch');
          setState({ status: 'idle', extraction: null });
        } else if (autoExtract && pdfData) {
          // Auto-extract if enabled and no cache exists
          void triggerExtraction();
        } else {
          setState({ status: 'idle', extraction: null });
        }
      } catch (err) {
        if (cancelled) return;
        console.error('[GeminiExtraction] Error loading cached extraction:', err);
        setState({ status: 'idle', extraction: null });
      }
    }

    void loadCached();

    return () => {
      cancelled = true;
    };
  }, [aiDetectionSupport.supported, autoExtract, documentHash, pdfData]);

  const triggerExtraction = useCallback(async () => {
    if (!aiDetectionSupport.supported) {
      setState({
        status: 'error',
        extraction: null,
        error: aiDetectionSupport.message ?? 'AI detection is not supported for this PDF.'
      });
      return;
    }

    if (!documentHash || !pdfData) {
      setState({ status: 'error', extraction: null, error: 'No document loaded' });
      return;
    }

    const provider = getRewriteProvider();
    let apiKey = getRewriteApiKey(provider);

    if (!apiKey && !isProxyTransportEnabled()) {
      apiKey = window.prompt(
        `Enter your ${provider === 'openai' ? 'OpenAI' : 'Gemini'} API key to extract document structure:`
      );
      if (!apiKey) {
        setState({ status: 'error', extraction: null, error: 'API key required' });
        return;
      }
      setRewriteApiKey(provider, apiKey);
    }

    setState({ status: 'loading', extraction: null });

    try {
      // Convert PDF data to base64
      const pdfBase64 = arrayBufferToBase64(pdfData);
      const configuredModel = getRewriteModel(provider)?.trim();

      // Send request with PDF file
      const result = provider === 'openai'
        ? await (async () => {
            const openAiModel =
              configuredModel && !/^(gemini-|models\/gemini|gpt-image-|dall-e-)/i.test(configuredModel)
                ? configuredModel
                : undefined;
            const client = createTransportedOpenAiApi({
              apiKey,
              ...(openAiModel ? { model: openAiModel } : {})
            });
            return client.generateContent({
              contents: {
                parts: [
                  { text: EXTRACTION_PROMPT },
                  {
                    inlineData: {
                      mimeType: 'application/pdf',
                      data: pdfBase64
                    }
                  }
                ]
              }
            });
          })()
        : await (async () => {
            const geminiModel =
              configuredModel && !/^gpt-/i.test(configuredModel)
                ? configuredModel
                : 'gemini-3-pro-image-preview';
            const client = createTransportedGeminiApi({ apiKey, model: geminiModel });
            return client.generateContent({
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      inlineData: {
                        mimeType: 'application/pdf',
                        data: pdfBase64
                      }
                    },
                    { text: EXTRACTION_PROMPT }
                  ]
                }
              ]
            });
          })();

      // Parse the response
      const extraction = parseGeminiExtractionResponse(result.text);

      // Cache the result
      const record: GeminiExtractionRecord = {
        documentHash,
        extraction,
        createdAt: Date.now(),
        provider,
        model: result.model
      };
      await saveGeminiExtraction(record);

      console.log('[GeminiExtraction] Extraction complete:', extraction.pages.length, 'pages', 'provider:', provider);
      setState({ status: 'ready', extraction });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to extract document';
      console.error('[GeminiExtraction] Error:', message);
      setState({ status: 'error', extraction: null, error: message });
    }
  }, [aiDetectionSupport, documentHash, pdfData]);

  const clearExtraction = useCallback(() => {
    setState({ status: 'idle', extraction: null });
  }, []);

  return { state, triggerExtraction, clearExtraction };
}

function isExtractionCacheCompatible(
  cached: GeminiExtractionRecord,
  provider: StructuredExtractProvider,
  configuredModel: string | null
): boolean {
  const cachedProvider = cached.provider;
  const normalizedConfiguredModel = configuredModel?.trim() ?? '';

  // Legacy records (before provider support) were Gemini-only.
  if (!cachedProvider) {
    if (provider !== 'gemini') {
      return false;
    }
    if (normalizedConfiguredModel.length === 0 || !cached.model) {
      return true;
    }
    return cached.model.trim() === normalizedConfiguredModel;
  }

  if (cachedProvider !== provider) {
    return false;
  }

  if (normalizedConfiguredModel.length === 0) {
    return true;
  }

  return (cached.model?.trim() ?? '') === normalizedConfiguredModel;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
