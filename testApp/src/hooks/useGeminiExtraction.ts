import { useState, useEffect, useCallback } from 'react';
import { GeminiAPI } from 'pdf-layout-parser';
import {
  type GeminiDocumentExtraction,
  type GeminiExtractionRecord,
  getGeminiExtraction,
  saveGeminiExtraction,
  parseGeminiExtractionResponse
} from '../storage/geminiExtractionStorage';

const GEMINI_API_KEY_STORAGE = 'gemini-overlay-api-key';
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
}

export interface UseGeminiExtractionResult {
  state: GeminiExtractionState;
  triggerExtraction: () => Promise<void>;
  clearExtraction: () => void;
}

export function useGeminiExtraction({
  documentHash,
  pdfData,
  autoExtract = false
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

    let cancelled = false;

    async function loadCached() {
      try {
        const cached = await getGeminiExtraction(documentHash!);
        if (cancelled) return;

        if (cached) {
          console.log('[GeminiExtraction] Loaded cached extraction for', documentHash);
          setState({ status: 'ready', extraction: cached.extraction });
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
  }, [documentHash]);

  const triggerExtraction = useCallback(async () => {
    if (!documentHash || !pdfData) {
      setState({ status: 'error', extraction: null, error: 'No document loaded' });
      return;
    }

    // Get API key from storage
    let apiKey: string | null = null;
    try {
      apiKey = window.localStorage.getItem(GEMINI_API_KEY_STORAGE);
    } catch {
      // Ignore storage errors
    }

    if (!apiKey) {
      apiKey = window.prompt('Enter your Gemini API key to extract document structure:');
      if (!apiKey) {
        setState({ status: 'error', extraction: null, error: 'API key required' });
        return;
      }
      try {
        window.localStorage.setItem(GEMINI_API_KEY_STORAGE, apiKey);
      } catch {
        // Ignore storage errors
      }
    }

    setState({ status: 'loading', extraction: null });

    try {
      const client = new GeminiAPI({ apiKey, model: 'gemini-3-pro-image-preview' });

      // Convert PDF data to base64
      const pdfBase64 = arrayBufferToBase64(pdfData);

      // Send request with PDF file
      const result = await client.generateContent({
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

      // Parse the response
      const extraction = parseGeminiExtractionResponse(result.text);

      // Cache the result
      const record: GeminiExtractionRecord = {
        documentHash,
        extraction,
        createdAt: Date.now(),
        model: result.model
      };
      await saveGeminiExtraction(record);

      console.log('[GeminiExtraction] Extraction complete:', extraction.pages.length, 'pages');
      setState({ status: 'ready', extraction });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to extract document';
      console.error('[GeminiExtraction] Error:', message);
      setState({ status: 'error', extraction: null, error: message });
    }
  }, [documentHash, pdfData]);

  const clearExtraction = useCallback(() => {
    setState({ status: 'idle', extraction: null });
  }, []);

  return { state, triggerExtraction, clearExtraction };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
