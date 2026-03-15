import { useRef, useCallback, useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import type { HtmlPageLayout, PDFImageBounds, PDFPage } from 'pdf-layout-parser';
import { GeminiAPI, OpenAiAPI } from 'pdf-layout-parser';
import type { CanvasHighlightSelection, FocusProvider, ExtractedTable } from '../types';
import type { SemanticSearchResult } from '../search';
import { TableViewer, type TableSortState } from './TableViewer';
import { OverlayToolbar, OverlayToolbarButton } from './OverlayToolbar';
import { ExploreIcon, ImageIcon, LoadingIcon, MathIcon, WidgetIcon } from './OverlayIcons';
import { MiniChatView } from './MiniChatView';
import { ImagePreviewPopup } from './ImagePreviewPopup';
import { MathViewPopup } from './MathViewPopup';
import { InteractiveWidgetPopup } from './InteractiveWidgetPopup';
import { ImageExplanationPopup, type ImageExplanationData } from './ImageExplanationPopup';
import { getCachedImageExplanation, setCachedImageExplanation, deleteCachedImageExplanation } from '../storage/imageExplanationCache';
import {
  type AnnotationBounds,
  type AnnotationSummary,
  type ChatAnnotationContent,
  type ImageAnnotationContent,
  type WidgetAnnotationContent,
  getAnnotation,
  getAnnotationsByPage,
  saveOrUpdateImageAnnotation,
  saveOrUpdateWidgetAnnotation,
  deleteAnnotation
} from '../storage/annotationStorage';
import { getCachedLatex, setCachedLatex } from '../storage/mathCache';
import {
  type HighlightLineData,
  type HighlightBlockData,
  type ExtractTableHit,
  buildHighlightBlockData,
  buildHighlightBlockKey,
  findParagraphBlockAtPoint,
  detectExtractedTableAtPoint,
  getOverrideLineHeight
} from '../utils/highlightUtils';
import { refineTextBlockForSelection } from '../utils/textBlockSelection';
import {
  type GeminiDocumentExtraction,
  type GeminiElement,
  type GeminiElementType,
  findElementAtPoint,
  findNearestElementOfType,
  hasAnyElementAtPoint,
  findReferenceByCitation,
  convertBoundsToCoordinates
} from '../storage/geminiExtractionStorage';
import {
  type AlignedElement,
  type PageAlignedElements,
  alignElementBounds
} from '../utils/elementBoundsAligner';
import { buildRewriteHighlightPrompt, loadRewriteProfileSettings } from '../utils/rewriteProfileSettings';
import {
  getRewriteApiKey,
  getRewriteModel,
  getRewriteProvider,
  setRewriteApiKey
} from '../utils/rewriteProviderSettings';
import { buildSectionContext } from '../utils/sectionContext';
import {
  buildInteractiveWidgetPrompt,
  buildInteractiveWidgetSrcDoc,
  parseInteractiveWidgetSpec
} from '../utils/interactiveWidget';
import { buildMathDetectionPrompt, parseMathDetectionResponse } from '../utils/mathDetection';
import { parsePopupTextSegments } from '../utils/popupTextSegments';

const HIGHLIGHT_PADDING = 12;
const TABLE_HIT_TOLERANCE = 6;
const GEMINI_STORAGE_KEY = 'gemini-overlay-api-key';
const IMAGE_PANEL_WIDTH = 500;
const DEFAULT_PAGE_WIDTH = 612;
const DEFAULT_PAGE_HEIGHT = 792;
const FORMULA_SUGGESTION_LOG_PREFIX = '[FormulaSuggestion]';

interface CanvasPageWithOverlayProps {
  page: PDFPage;
  pageNumber: number;
  documentId: string;
  documentTitle?: string;
  getCanvasRef: (pageNumber: number) => (element: HTMLCanvasElement | null) => void;
  zoom: number;
  htmlPage: HtmlPageLayout | null;
  canvasHighlight: CanvasHighlightSelection | null;
  onCanvasHighlight: (selection: CanvasHighlightSelection | null) => void;
  focusMode: boolean;
  focusLayout: any;
  focusProvider: FocusProvider;
  extractedTables: ExtractedTable[];
  semanticSearchResults?: SemanticSearchResult[];
  activeSemanticResultId?: string;
  geminiExtraction?: GeminiDocumentExtraction | null;
  enableFormulaHighlight?: boolean;
  enableTableHighlight?: boolean;
  enableImageHighlight?: boolean;
  enableWebSearch?: boolean;
  onInlineImageGenerationActivityChange?: (delta: number) => void;
  onInteractiveWidgetGenerationActivityChange?: (delta: number) => void;
  onInlineSuggestionAnalysisActivityChange?: (delta: number) => void;
}

export function CanvasPageWithOverlay({
  page,
  pageNumber,
  documentId,
  documentTitle,
  getCanvasRef,
  zoom,
  htmlPage,
  canvasHighlight,
  onCanvasHighlight,
  focusMode,
  focusLayout,
  focusProvider,
  extractedTables,
  semanticSearchResults = [],
  activeSemanticResultId,
  geminiExtraction,
  enableFormulaHighlight = true,
  enableTableHighlight = true,
  enableImageHighlight = true,
  enableWebSearch = false,
  onInlineImageGenerationActivityChange,
  onInteractiveWidgetGenerationActivityChange,
  onInlineSuggestionAnalysisActivityChange
}: CanvasPageWithOverlayProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const formulaSuggestionAttentionTimeoutRef = useRef<number | null>(null);
  const previousFormulaSuggestionSignatureRef = useRef<Record<string, string>>({});
  const [highlightTextOverrides, setHighlightTextOverrides] = useState<Record<string, string>>({});
  const [rewriteLoading, setRewriteLoading] = useState<Record<string, boolean>>({});
  const [rewriteError, setRewriteError] = useState<Record<string, string>>({});
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [imageMap, setImageMap] = useState<Record<string, { dataUri: string; mimeType?: string; text?: string }>>({});
  const [imageLoading, setImageLoading] = useState<Record<string, boolean>>({});
  const [imageError, setImageError] = useState<Record<string, string>>({});
  const [tableOverlay, setTableOverlay] = useState<{
    bounds: PDFImageBounds;
    model: ExtractedTable;
  } | null>(null);
  const [tableSortState, setTableSortState] = useState<Record<string, TableSortState>>({});
  // Support multiple chat popups simultaneously - keyed by bounds string
  const [miniChatStates, setMiniChatStates] = useState<Map<string, {
    contextText: string;
    position: { top: number; left: number };
    bounds: AnnotationBounds;
  }>>(new Map());
  const [pageAnnotations, setPageAnnotations] = useState<AnnotationSummary[]>([]);
  const [annotationVersion, setAnnotationVersion] = useState(0);
  const [imagePreview, setImagePreview] = useState<{
    dataUri: string;
    prompt?: string;
    position: { top: number; left: number };
    annotationId?: string;
  } | null>(null);
  const [referencePopup, setReferencePopup] = useState<{
    content: string;
    citationNumber: string;
    paragraphText: string;
    position: { top: number; left: number };
    bounds: AnnotationBounds;
  } | null>(null);
  const [connectionChatState, setConnectionChatState] = useState<{
    isOpen: boolean;
    contextText: string;
    initialQuery: string;
    position: { top: number; left: number };
    bounds: AnnotationBounds;
  } | null>(null);
  const [mathViewState, setMathViewState] = useState<{
    latex: string;
    position: { top: number; left: number };
    isLoading: boolean;
    error: string | null;
  } | null>(null);
  const [hoveredElement, setHoveredElement] = useState<{
    type: GeminiElementType;
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
  } | null>(null);
  const [alignedElements, setAlignedElements] = useState<PageAlignedElements | null>(null);
  const [imageExplanationState, setImageExplanationState] = useState<{
    imageDataUri: string;
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    position: { top: number; left: number };
    savedExplanation: ImageExplanationData | null;
  } | null>(null);
  const [interactiveWidgetState, setInteractiveWidgetState] = useState<{
    title: string;
    srcDoc: string;
    position: { top: number; left: number };
    isLoading: boolean;
    error: string | null;
  } | null>(null);
  const [formulaSuggestionAttentionKey, setFormulaSuggestionAttentionKey] = useState<string | null>(null);
  const [formulaSuggestionState, setFormulaSuggestionState] = useState<
    Record<string, { status: 'loading' | 'ready' | 'error'; hasMath: boolean }>
  >({});

  useEffect(() => {
    setHighlightTextOverrides({});
    setRewriteLoading({});
    setRewriteError({});
    setImageMap({});
    setImageError({});
    setImageLoading({});
    setTableOverlay(null);
    setTableSortState({});
    setMiniChatStates(new Map());
    setImagePreview(null);
    setReferencePopup(null);
    setConnectionChatState(null);
    setMathViewState(null);
    setHoveredElement(null);
    setImageExplanationState(null);
    setInteractiveWidgetState(null);
    setFormulaSuggestionAttentionKey(null);
  }, [focusLayout, canvasHighlight]);

  useEffect(() => {
    return () => {
      if (formulaSuggestionAttentionTimeoutRef.current !== null) {
        window.clearTimeout(formulaSuggestionAttentionTimeoutRef.current);
      }
    };
  }, []);

  // Compute aligned elements when gemini extraction or page changes
  useEffect(() => {
    if (!geminiExtraction || !page.textItems || page.textItems.length === 0) {
      setAlignedElements(null);
      return;
    }

    // Find the gemini page data for this page
    const geminiPage = geminiExtraction.pages.find(p => p.page_number === pageNumber);
    if (!geminiPage) {
      setAlignedElements(null);
      return;
    }

    // Build text items map for just this page
    const textItemsByPage = new Map<number, typeof page.textItems>();
    textItemsByPage.set(pageNumber, page.textItems);

    // Compute alignment
    try {
      const result = alignElementBounds(
        { ...geminiExtraction, pages: [geminiPage] },
        [page],
        textItemsByPage
      );
      if (result.pages.length > 0) {
        setAlignedElements(result.pages[0]);
        console.debug('[AlignedElements] Aligned', result.pages[0].elements.length, 'elements on page', pageNumber);
      }
    } catch (err) {
      console.error('[AlignedElements] Alignment failed:', err);
      setAlignedElements(null);
    }
  }, [geminiExtraction, page, pageNumber]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(GEMINI_STORAGE_KEY);
      if (stored) {
        setGeminiApiKey(stored);
      }
    } catch (error) {
      console.warn('Unable to load Gemini API key from storage', error);
    }
  }, []);

  // Load annotations for this page
  useEffect(() => {
    if (!documentId) return;

    async function loadAnnotations() {
      try {
        const annotations = await getAnnotationsByPage(documentId, pageNumber);
        setPageAnnotations(annotations.map((ann) => ({
          id: ann.id,
          type: ann.type,
          pageNumber: ann.pageNumber,
          bounds: ann.bounds,
          createdAt: ann.createdAt,
          updatedAt: ann.updatedAt
        })));
      } catch (err) {
        console.error('Failed to load page annotations:', err);
      }
    }

    void loadAnnotations();
  }, [documentId, pageNumber, annotationVersion]);

  const handleCanvasRef = useCallback((element: HTMLCanvasElement | null) => {
    canvasRef.current = element;
    getCanvasRef(page.number)(element);
  }, [getCanvasRef, page.number]);

  const handleOpenMiniChat = useCallback(
    (contextText: string, blockLeft: number, blockTop: number, blockWidth: number, bounds: AnnotationBounds) => {
      // Position the chat panel next to the toolbar (which is at top-right of block)
      // Toolbar is at: top: -10px, right: 8px relative to the highlight block
      // The highlight block has HIGHLIGHT_PADDING added, so account for that
      const chatLeft = blockLeft + blockWidth + HIGHLIGHT_PADDING + 16;
      const chatTop = blockTop - HIGHLIGHT_PADDING - 20; // Align with toolbar position
      const boundsKey = `${bounds.minX}-${bounds.minY}-${bounds.maxX}-${bounds.maxY}`;
      setMiniChatStates((prev) => {
        const next = new Map(prev);
        next.set(boundsKey, {
          contextText,
          position: { top: chatTop, left: chatLeft },
          bounds
        });
        return next;
      });
    },
    []
  );

  const handleAnnotationChange = useCallback(() => {
    setAnnotationVersion((v) => v + 1);
  }, []);

  const handleAnnotationMarkerClick = useCallback(
    async (annotationId: string, bounds: AnnotationBounds) => {
      try {
        const annotation = await getAnnotation(annotationId);
        if (!annotation || annotation.type !== 'chat') return;

        const chatContent = annotation.content as ChatAnnotationContent;
        const canvasPadding = 16 * zoom;
        const blockLeft = bounds.minX * zoom + canvasPadding;
        const blockTop = (page.size.height - bounds.maxY) * zoom + canvasPadding;
        const blockWidth = (bounds.maxX - bounds.minX) * zoom;

        // Position chat panel to the right of the block
        const chatLeft = blockLeft + blockWidth + 20;
        const chatTop = blockTop;

        const boundsKey = `${bounds.minX}-${bounds.minY}-${bounds.maxX}-${bounds.maxY}`;
        setMiniChatStates((prev) => {
          const next = new Map(prev);
          next.set(boundsKey, {
            contextText: chatContent.contextText,
            position: { top: chatTop, left: chatLeft },
            bounds
          });
          return next;
        });
      } catch (err) {
        console.error('Failed to load annotation:', err);
      }
    },
    [zoom, page.size.height]
  );

  const handleCloseMiniChat = useCallback((boundsKey: string) => {
    setMiniChatStates((prev) => {
      const next = new Map(prev);
      next.delete(boundsKey);
      return next;
    });
  }, []);

  const getWidgetPopupPosition = useCallback(
    (bounds: AnnotationBounds) => {
      const canvasPadding = 16 * zoom;
      const blockLeft = bounds.minX * zoom + canvasPadding;
      const blockTop = (page.size.height - bounds.maxY) * zoom + canvasPadding;
      const blockWidth = (bounds.maxX - bounds.minX) * zoom;

      return {
        top: blockTop - HIGHLIGHT_PADDING - 20,
        left: blockLeft + blockWidth + HIGHLIGHT_PADDING + 16
      };
    },
    [zoom, page.size.height]
  );

  const handleImageMarkerClick = useCallback(
    async (annotationId: string, bounds: AnnotationBounds) => {
      try {
        const annotation = await getAnnotation(annotationId);
        if (!annotation || annotation.type !== 'image') return;

        const imageContent = annotation.content as ImageAnnotationContent;
        const canvasPadding = 16 * zoom;
        const blockLeft = bounds.minX * zoom + canvasPadding;
        const blockTop = (page.size.height - bounds.maxY) * zoom + canvasPadding;
        const blockWidth = (bounds.maxX - bounds.minX) * zoom;

        // Position preview to the right of the block
        const previewLeft = blockLeft + blockWidth + 20;
        const previewTop = blockTop;

        setImagePreview({
          dataUri: imageContent.dataUri,
          prompt: imageContent.prompt,
          position: { top: previewTop, left: previewLeft },
          annotationId
        });
      } catch (err) {
        console.error('Failed to load image annotation:', err);
      }
    },
    [zoom, page.size.height]
  );

  const handleWidgetMarkerClick = useCallback(
    async (annotationId: string, bounds: AnnotationBounds) => {
      try {
        const annotation = await getAnnotation(annotationId);
        if (!annotation || annotation.type !== 'widget') return;

        const widgetContent = annotation.content as WidgetAnnotationContent;
        setInteractiveWidgetState({
          title: widgetContent.title?.trim() || 'Interactive explainer',
          srcDoc: buildInteractiveWidgetSrcDoc({
            title: widgetContent.title?.trim() || 'Interactive explainer',
            html: widgetContent.html,
            css: widgetContent.css,
            js: widgetContent.js
          }),
          position: getWidgetPopupPosition(bounds),
          isLoading: false,
          error: null
        });
      } catch (err) {
        console.error('Failed to load widget annotation:', err);
      }
    },
    [getWidgetPopupPosition]
  );

  const handleDeleteImageAnnotation = useCallback(async () => {
    if (!imagePreview?.annotationId) return;

    try {
      await deleteAnnotation(imagePreview.annotationId);
      setAnnotationVersion((v) => v + 1);
      setImagePreview(null);
    } catch (err) {
      console.error('Failed to delete image annotation:', err);
    }
  }, [imagePreview?.annotationId]);

  const handleCloseImagePreview = useCallback(() => {
    setImagePreview(null);
  }, []);

  const handleCitationClick = useCallback(
    (citationNumber: string, clickEvent: React.MouseEvent, paragraphText: string, bounds: AnnotationBounds) => {
      console.debug('Citation clicked:', citationNumber, 'hasExtraction:', Boolean(geminiExtraction));

      // Position popup near the click within the overlay
      const target = clickEvent.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      const containerRect = target.closest('.canvas-page')?.getBoundingClientRect();

      if (!containerRect) {
        console.debug('No container rect found');
        return;
      }

      const popupLeft = rect.left - containerRect.left + rect.width + 10;
      const popupTop = rect.top - containerRect.top;

      if (!geminiExtraction) {
        // Show a message that extraction is needed
        setReferencePopup({
          content: `Reference [${citationNumber}] - Run Gemini extraction to see reference details`,
          citationNumber,
          paragraphText,
          position: { top: popupTop, left: popupLeft },
          bounds
        });
        return;
      }

      const reference = findReferenceByCitation(geminiExtraction, citationNumber);
      console.debug('Found reference:', reference);

      if (reference) {
        const content = typeof reference.content === 'string'
          ? reference.content
          : JSON.stringify(reference.content, null, 2);
        setReferencePopup({
          content,
          citationNumber,
          paragraphText,
          position: { top: popupTop, left: popupLeft },
          bounds
        });
      } else {
        // Reference not found in extraction
        setReferencePopup({
          content: `Reference [${citationNumber}] not found in document`,
          citationNumber,
          paragraphText,
          position: { top: popupTop, left: popupLeft },
          bounds
        });
      }
    },
    [geminiExtraction]
  );

  const handleExplainConnection = useCallback(() => {
    if (!referencePopup) return;

    const docTitle = documentTitle || geminiExtraction?.document_title || documentId || 'this document';
    const contextText = `Current paragraph from the paper "${docTitle}":\n${referencePopup.paragraphText}\n\nCited reference [${referencePopup.citationNumber}]:\n${referencePopup.content}`;
    const initialQuery = `How does the cited reference [${referencePopup.citationNumber}] connect to and support the arguments in this paragraph from "${docTitle}"? Please explain the relationship and why the authors cited this reference.`;

    setReferencePopup(null);
    setConnectionChatState({
      isOpen: true,
      contextText,
      initialQuery,
      position: referencePopup.position,
      bounds: referencePopup.bounds
    });
  }, [referencePopup, documentTitle, geminiExtraction?.document_title, documentId]);

  const handleCloseConnectionChat = useCallback(() => {
    setConnectionChatState(null);
  }, []);

  const ensureGeminiApiKey = useCallback((): string | null => {
    const trimmed = geminiApiKey.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
    const storedRewriteKey = getRewriteApiKey('gemini');
    if (storedRewriteKey && storedRewriteKey.trim().length > 0) {
      setGeminiApiKey(storedRewriteKey.trim());
      return storedRewriteKey.trim();
    }
    const entered = window.prompt('Enter your Gemini API key to use Gemini features on this PDF:');
    if (entered && entered.trim().length > 0) {
      const value = entered.trim();
      setGeminiApiKey(value);
      try {
        window.localStorage.setItem(GEMINI_STORAGE_KEY, value);
      } catch (error) {
        console.warn('Unable to persist Gemini API key', error);
      }
      setRewriteApiKey('gemini', value);
      return value;
    }
    return null;
  }, [geminiApiKey]);

  const ensureOpenAiApiKey = useCallback((): string | null => {
    const stored = getRewriteApiKey('openai');
    if (stored && stored.trim().length > 0) {
      return stored.trim();
    }
    const entered = window.prompt('Enter your OpenAI API key to use OpenAI features on this PDF:');
    if (entered && entered.trim().length > 0) {
      const value = entered.trim();
      setRewriteApiKey('openai', value);
      return value;
    }
    return null;
  }, []);

  const handleRewriteHighlight = useCallback(
    async (blockKey: string, paragraphText: string) => {
      const trimmedParagraph = paragraphText.trim();
      if (trimmedParagraph.length === 0) {
        setRewriteError((current) => ({ ...current, [blockKey]: 'No paragraph text available to rewrite.' }));
        return;
      }

      setRewriteError((current) => {
        const { [blockKey]: _ignored, ...rest } = current;
        return rest;
      });
      setRewriteLoading((current) => ({ ...current, [blockKey]: true }));

      try {
        const profile = loadRewriteProfileSettings();
        const prompt = buildRewriteHighlightPrompt({
          paragraphText: trimmedParagraph,
          documentTitle,
          profile
        });
        const rewriteProvider = getRewriteProvider();
        const response =
          rewriteProvider === 'openai'
            ? await (async () => {
                const openAiKey = ensureOpenAiApiKey();
                if (!openAiKey) {
                  throw new Error('OpenAI API key required for rewrite.');
                }
                const configuredModel = getRewriteModel('openai')?.trim();
                const openAiModel =
                  configuredModel && !/^gemini-/i.test(configuredModel)
                    ? configuredModel
                    : undefined;
                const client = new OpenAiAPI({
                  apiKey: openAiKey,
                  ...(openAiModel ? { model: openAiModel } : {})
                });
                return client.generateText(prompt);
              })()
            : await (async () => {
                const key = (getRewriteApiKey('gemini')?.trim() || ensureGeminiApiKey()) ?? null;
                if (!key) {
                  throw new Error('Gemini API key required for rewrite.');
                }
                const configuredModel = getRewriteModel('gemini')?.trim();
                const geminiModel =
                  configuredModel && !/^gpt-/i.test(configuredModel)
                    ? configuredModel
                    : 'gemini-3-pro-preview';
                const client = new GeminiAPI({ apiKey: key, model: geminiModel });
                return client.generateText(prompt);
              })();
        const rewritten = response.text.trim();
        if (!rewritten) {
          throw new Error('Empty rewrite response');
        }
        setHighlightTextOverrides((current) => ({
          ...current,
          [blockKey]: rewritten
        }));
      } catch (error) {
        setRewriteError((current) => ({
          ...current,
          [blockKey]: error instanceof Error ? error.message : 'Failed to rewrite paragraph.'
        }));
      } finally {
        setRewriteLoading((current) => {
          const { [blockKey]: _ignored, ...rest } = current;
          return rest;
        });
      }
    },
    [documentTitle, ensureGeminiApiKey, ensureOpenAiApiKey]
  );

  const handleGenerateImage = useCallback(
    async (blockKey: string, promptText: string, bounds: AnnotationBounds) => {
      const trimmedPrompt = promptText.trim();
      if (trimmedPrompt.length === 0) {
        setImageError((current) => ({ ...current, [blockKey]: 'No text available to describe this block.' }));
        return;
      }

      setImageError((current) => {
        const { [blockKey]: _ignored, ...rest } = current;
        return rest;
      });

      setImageLoading((current) => ({ ...current, [blockKey]: true }));
      let tracksInlineActivity = false;

      try {
        onInlineImageGenerationActivityChange?.(1);
        tracksInlineActivity = true;
        const provider = getRewriteProvider();
        const response = provider === 'openai'
          ? await (async () => {
              const openAiKey = ensureOpenAiApiKey();
              if (!openAiKey) {
                throw new Error('OpenAI API key required for image generation.');
              }
              const configuredModel = getRewriteModel('openai')?.trim();
              const imageModel = configuredModel && /^(gpt-image-|dall-e-)/i.test(configuredModel)
                ? configuredModel
                : undefined;
              const client = new OpenAiAPI({
                apiKey: openAiKey,
                ...(imageModel ? { model: imageModel } : {})
              });
              return client.generateImage(trimmedPrompt);
            })()
          : await (async () => {
              const key = (getRewriteApiKey('gemini')?.trim() || ensureGeminiApiKey()) ?? null;
              if (!key) {
                throw new Error('Gemini API key required for image generation.');
              }
              const configuredModel = getRewriteModel('gemini')?.trim();
              const geminiModel = configuredModel && !/^gpt-/i.test(configuredModel) ? configuredModel : undefined;
              const client = new GeminiAPI({ apiKey: key, ...(geminiModel ? { model: geminiModel } : {}) });
              return client.generateImage(trimmedPrompt);
            })();

        const image = response.images[0];
        const mimeType = image?.mimeType ?? 'image/png';
        const dataUri = image?.data
          ? `data:${mimeType};base64,${image.data}`
          : image?.url;
        if (!dataUri) {
          throw new Error('Image response did not include image data');
        }
        setImageMap((current) => ({ ...current, [blockKey]: { dataUri, mimeType, text: response.text } }));
        // Save to storage
        try {
          await saveOrUpdateImageAnnotation(documentId, pageNumber, bounds, dataUri, mimeType, trimmedPrompt);
          setAnnotationVersion((v) => v + 1);
        } catch (err) {
          console.error('Failed to save image annotation:', err);
        }
      } catch (error) {
        setImageError((current) => ({
          ...current,
          [blockKey]: error instanceof Error ? error.message : 'Failed to generate image.'
        }));
      } finally {
        if (tracksInlineActivity) {
          onInlineImageGenerationActivityChange?.(-1);
        }
        setImageLoading((current) => {
          const { [blockKey]: _ignored, ...rest } = current;
          return rest;
        });
      }
    },
    [ensureGeminiApiKey, ensureOpenAiApiKey, documentId, pageNumber, onInlineImageGenerationActivityChange]
  );

  const getCachedMathResult = useCallback(async (trimmedText: string): Promise<{ found: boolean; latex: string | null }> => {
    try {
      const cached = await getCachedLatex(trimmedText);
      if (cached === null) {
        return { found: false, latex: null };
      }
      const normalized = cached.trim();
      return { found: true, latex: normalized.length > 0 ? normalized : null };
    } catch {
      return { found: false, latex: null };
    }
  }, []);

  const requestMathLatexFromModel = useCallback(
    async (trimmedText: string): Promise<string | null> => {
      const prompt = buildMathDetectionPrompt(trimmedText);
      const provider = getRewriteProvider();
      console.debug(`${FORMULA_SUGGESTION_LOG_PREFIX} sending LLM math analysis request`, {
        pageNumber,
        provider,
        excerpt: summarizeForLog(trimmedText)
      });
      const response = provider === 'openai'
        ? await (async () => {
            const openAiKey = ensureOpenAiApiKey();
            if (!openAiKey) {
              throw new Error('OpenAI API key required');
            }
            const configuredModel = getRewriteModel('openai')?.trim();
            const textModel = configuredModel && !/^(gpt-image-|dall-e-|gemini-)/i.test(configuredModel)
              ? configuredModel
              : undefined;
            const client = new OpenAiAPI({
              apiKey: openAiKey,
              ...(textModel ? { model: textModel } : {})
            });
            return client.generateText(prompt);
          })()
        : await (async () => {
            const key = (getRewriteApiKey('gemini')?.trim() || ensureGeminiApiKey()) ?? null;
            if (!key) {
              throw new Error('Gemini API key required');
            }
            const configuredModel = getRewriteModel('gemini')?.trim();
            const geminiModel =
              configuredModel && !/^gpt-/i.test(configuredModel)
                ? configuredModel
                : 'gemini-3-pro-preview';
            const client = new GeminiAPI({ apiKey: key, model: geminiModel });
            return client.generateText(prompt);
          })();
      const latex = parseMathDetectionResponse(response.text);
      console.debug(`${FORMULA_SUGGESTION_LOG_PREFIX} received LLM math analysis response`, {
        pageNumber,
        provider,
        hasMath: Boolean(latex),
        excerpt: summarizeForLog(trimmedText),
        latexPreview: latex ? summarizeForLog(latex) : null
      });
      return latex;
    },
    [ensureGeminiApiKey, ensureOpenAiApiKey, pageNumber]
  );

  const handleDetectMath = useCallback(
    async (text: string, positionTop: number, positionLeft: number) => {
      const trimmedText = text.trim();
      if (trimmedText.length === 0) {
        return;
      }

      console.debug(`${FORMULA_SUGGESTION_LOG_PREFIX} explicit formula widget requested`, {
        pageNumber,
        excerpt: summarizeForLog(trimmedText),
        positionTop,
        positionLeft
      });

      // Open the popup immediately in loading state
      setMathViewState({
        latex: '',
        position: { top: positionTop, left: positionLeft },
        isLoading: true,
        error: null
      });

      try {
        const cached = await getCachedMathResult(trimmedText);
        if (cached.found) {
          console.debug(`${FORMULA_SUGGESTION_LOG_PREFIX} explicit formula widget resolved from cache`, {
            pageNumber,
            hasMath: Boolean(cached.latex),
            excerpt: summarizeForLog(trimmedText)
          });
          setMathViewState((prev) =>
            prev ? { ...prev, latex: cached.latex ?? '', isLoading: false, error: null } : null
          );
          return;
        }

        const latex = await requestMathLatexFromModel(trimmedText);
        await setCachedLatex(trimmedText, latex ?? '').catch(() => {});
        console.debug(`${FORMULA_SUGGESTION_LOG_PREFIX} explicit formula widget stored fresh result`, {
          pageNumber,
          hasMath: Boolean(latex),
          excerpt: summarizeForLog(trimmedText)
        });
        if (!latex) {
          setMathViewState((prev) =>
            prev ? { ...prev, latex: '', isLoading: false, error: null } : null
          );
        } else {
          setMathViewState((prev) =>
            prev ? { ...prev, latex, isLoading: false, error: null } : null
          );
        }
      } catch (error) {
        console.error(`${FORMULA_SUGGESTION_LOG_PREFIX} explicit formula widget failed`, {
          pageNumber,
          excerpt: summarizeForLog(trimmedText),
          error
        });
        setMathViewState((prev) =>
          prev
            ? {
                ...prev,
                isLoading: false,
                error: error instanceof Error ? error.message : 'Failed to detect formula'
              }
            : null
        );
      }
    },
    [getCachedMathResult, pageNumber, requestMathLatexFromModel]
  );

  const handleCloseMathView = useCallback(() => {
    setMathViewState(null);
  }, []);

  const handleCloseImageExplanation = useCallback(() => {
    setImageExplanationState(null);
  }, []);

  const handleCloseInteractiveWidget = useCallback(() => {
    setInteractiveWidgetState(null);
  }, []);

  const handleGenerateInteractiveWidget = useCallback(
    async (
      selectedText: string,
      position: { top: number; left: number },
      bounds: AnnotationBounds,
      selectedBlock: Extract<CanvasHighlightSelection, { kind: 'text' }> | null
    ) => {
      const trimmedText = selectedText.trim();
      if (trimmedText.length === 0) {
        return;
      }

      const textSelection =
        selectedBlock && selectedBlock.kind === 'text'
          ? selectedBlock.block
          : null;
      const sectionContext = buildSectionContext(htmlPage, textSelection);
      const defaultTitle = sectionContext.sectionHeading?.trim() || 'Interactive explainer';

      setInteractiveWidgetState({
        title: defaultTitle,
        srcDoc: '',
        position,
        isLoading: true,
        error: null
      });

      let tracksInlineActivity = false;

      try {
        onInteractiveWidgetGenerationActivityChange?.(1);
        tracksInlineActivity = true;

        const prompt = buildInteractiveWidgetPrompt({
          documentTitle,
          selectedText: trimmedText,
          sectionHeading: sectionContext.sectionHeading,
          sectionText: sectionContext.sectionText
        });
        const provider = getRewriteProvider();
        const response = provider === 'openai'
          ? await (async () => {
              const openAiKey = ensureOpenAiApiKey();
              if (!openAiKey) {
                throw new Error('OpenAI API key required for interactive widgets.');
              }
              const configuredModel = getRewriteModel('openai')?.trim();
              const textModel = configuredModel && !/^(gpt-image-|dall-e-|gemini-)/i.test(configuredModel)
                ? configuredModel
                : undefined;
              const client = new OpenAiAPI({
                apiKey: openAiKey,
                ...(textModel ? { model: textModel } : {})
              });
              return client.generateText(prompt);
            })()
          : await (async () => {
              const key = (getRewriteApiKey('gemini')?.trim() || ensureGeminiApiKey()) ?? null;
              if (!key) {
                throw new Error('Gemini API key required for interactive widgets.');
              }
              const configuredModel = getRewriteModel('gemini')?.trim();
              const geminiModel =
                configuredModel && !/^gpt-/i.test(configuredModel)
                  ? configuredModel
                  : 'gemini-3-pro-preview';
              const client = new GeminiAPI({ apiKey: key, model: geminiModel });
              return client.generateText(prompt);
            })();

        const spec = parseInteractiveWidgetSpec(response.text);
        const srcDoc = buildInteractiveWidgetSrcDoc(spec);
        setInteractiveWidgetState({
          title: spec.title,
          srcDoc,
          position,
          isLoading: false,
          error: null
        });
        try {
          await saveOrUpdateWidgetAnnotation(
            documentId,
            pageNumber,
            bounds,
            spec.title,
            spec.html,
            spec.css,
            spec.js,
            trimmedText
          );
          setAnnotationVersion((current) => current + 1);
        } catch (saveError) {
          console.error('Failed to save widget annotation:', saveError);
        }
      } catch (error) {
        setInteractiveWidgetState((current) => ({
          title: current?.title ?? defaultTitle,
          srcDoc: current?.srcDoc ?? '',
          position,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to generate interactive widget.'
        }));
      } finally {
        if (tracksInlineActivity) {
          onInteractiveWidgetGenerationActivityChange?.(-1);
        }
      }
    },
    [
      documentId,
      documentTitle,
      ensureGeminiApiKey,
      ensureOpenAiApiKey,
      htmlPage,
      onInteractiveWidgetGenerationActivityChange,
      pageNumber
    ]
  );

  const overlayAiProvider = getRewriteProvider();
  const overlayAiModel = getRewriteModel(overlayAiProvider);
  const overlayAiKey = overlayAiProvider === 'openai'
    ? (getRewriteApiKey('openai') ?? '')
    : (getRewriteApiKey('gemini') ?? geminiApiKey ?? '');
  const activeTextSelection =
    !focusMode &&
    canvasHighlight?.pageNumber === page.number &&
    canvasHighlight.kind === 'text'
      ? canvasHighlight
      : null;
  const activeTextSelectionKey = activeTextSelection
    ? buildHighlightBlockKey(page.number, activeTextSelection.block.bounds)
    : null;
  const activeTextSelectionText = activeTextSelection?.block.text.trim() ?? '';
  const isGeneratingInteractiveWidget = interactiveWidgetState?.isLoading ?? false;

  useEffect(() => {
    if (!enableFormulaHighlight || !activeTextSelectionKey || activeTextSelectionText.length === 0) {
      if (activeTextSelectionKey && activeTextSelectionText.length > 0 && !enableFormulaHighlight) {
        console.debug(`${FORMULA_SUGGESTION_LOG_PREFIX} automatic suggestion skipped because formula highlights are disabled`, {
          pageNumber,
          blockKey: activeTextSelectionKey,
          excerpt: summarizeForLog(activeTextSelectionText)
        });
      }
      return;
    }

    const existing = formulaSuggestionState[activeTextSelectionKey];
    if (existing) {
      console.debug(`${FORMULA_SUGGESTION_LOG_PREFIX} reusing existing automatic suggestion state`, {
        pageNumber,
        blockKey: activeTextSelectionKey,
        status: existing.status,
        hasMath: existing.hasMath,
        excerpt: summarizeForLog(activeTextSelectionText)
      });
      return;
    }

    let isCurrent = true;

    console.debug(`${FORMULA_SUGGESTION_LOG_PREFIX} starting automatic suggestion analysis`, {
      pageNumber,
      blockKey: activeTextSelectionKey,
      excerpt: summarizeForLog(activeTextSelectionText)
    });

    setFormulaSuggestionState((current) => ({
      ...current,
      [activeTextSelectionKey]: { status: 'loading', hasMath: false }
    }));

    void (async () => {
      const cached = await getCachedMathResult(activeTextSelectionText);
      if (!isCurrent) {
        return;
      }

      if (cached.found) {
        console.debug(`${FORMULA_SUGGESTION_LOG_PREFIX} automatic suggestion resolved from cache`, {
          pageNumber,
          blockKey: activeTextSelectionKey,
          hasMath: Boolean(cached.latex),
          excerpt: summarizeForLog(activeTextSelectionText)
        });
        setFormulaSuggestionState((current) => ({
          ...current,
          [activeTextSelectionKey]: { status: 'ready', hasMath: Boolean(cached.latex) }
        }));
        return;
      }

      console.debug(`${FORMULA_SUGGESTION_LOG_PREFIX} automatic suggestion cache miss, requesting LLM analysis`, {
        pageNumber,
        blockKey: activeTextSelectionKey,
        excerpt: summarizeForLog(activeTextSelectionText)
      });

      let tracksInlineActivity = false;

      try {
        onInlineSuggestionAnalysisActivityChange?.(1);
        tracksInlineActivity = true;
        const latex = await requestMathLatexFromModel(activeTextSelectionText);
        await setCachedLatex(activeTextSelectionText, latex ?? '').catch(() => {});
        if (!isCurrent) {
          return;
        }
        console.debug(`${FORMULA_SUGGESTION_LOG_PREFIX} automatic suggestion stored fresh result`, {
          pageNumber,
          blockKey: activeTextSelectionKey,
          hasMath: Boolean(latex),
          excerpt: summarizeForLog(activeTextSelectionText)
        });
        setFormulaSuggestionState((current) => ({
          ...current,
          [activeTextSelectionKey]: { status: 'ready', hasMath: Boolean(latex) }
        }));
      } catch (error) {
        console.error(`${FORMULA_SUGGESTION_LOG_PREFIX} automatic suggestion failed`, {
          pageNumber,
          blockKey: activeTextSelectionKey,
          excerpt: summarizeForLog(activeTextSelectionText),
          error
        });
        if (!isCurrent) {
          return;
        }
        setFormulaSuggestionState((current) => ({
          ...current,
          [activeTextSelectionKey]: { status: 'error', hasMath: false }
        }));
      } finally {
        if (tracksInlineActivity) {
          onInlineSuggestionAnalysisActivityChange?.(-1);
        }
      }
    })();

    return () => {
      isCurrent = false;
      console.debug(`${FORMULA_SUGGESTION_LOG_PREFIX} automatic suggestion effect cleaned up`, {
        pageNumber,
        blockKey: activeTextSelectionKey
      });
    };
  }, [
    activeTextSelectionKey,
    activeTextSelectionText,
    enableFormulaHighlight,
    getCachedMathResult,
    pageNumber,
    onInlineSuggestionAnalysisActivityChange,
    requestMathLatexFromModel
  ]);

  useEffect(() => {
    if (!activeTextSelectionKey) {
      setFormulaSuggestionAttentionKey(null);
      return;
    }

    const entry = formulaSuggestionState[activeTextSelectionKey];
    const nextSignature = entry ? `${entry.status}:${entry.hasMath ? '1' : '0'}` : 'none';
    const previousSignature = previousFormulaSuggestionSignatureRef.current[activeTextSelectionKey];
    previousFormulaSuggestionSignatureRef.current[activeTextSelectionKey] = nextSignature;

    if (entry?.status === 'ready' && entry.hasMath && previousSignature !== nextSignature) {
      setFormulaSuggestionAttentionKey(activeTextSelectionKey);
      if (formulaSuggestionAttentionTimeoutRef.current !== null) {
        window.clearTimeout(formulaSuggestionAttentionTimeoutRef.current);
      }
      formulaSuggestionAttentionTimeoutRef.current = window.setTimeout(() => {
        setFormulaSuggestionAttentionKey((current) => current === activeTextSelectionKey ? null : current);
        formulaSuggestionAttentionTimeoutRef.current = null;
      }, 1500);
    }
  }, [activeTextSelectionKey, formulaSuggestionState]);

  const handleSaveImageExplanation = useCallback(
    (explanation: string) => {
      if (!imageExplanationState) return;
      setCachedImageExplanation(
        documentId,
        pageNumber,
        imageExplanationState.bounds,
        explanation
      ).then(() => {
        // Update the state to show it's saved
        setImageExplanationState(prev => prev ? {
          ...prev,
          savedExplanation: { explanation, timestamp: Date.now() }
        } : null);
      }).catch(err => {
        console.error('Failed to save image explanation:', err);
      });
    },
    [documentId, pageNumber, imageExplanationState]
  );

  const handleDeleteImageExplanation = useCallback(() => {
    if (!imageExplanationState) return;
    deleteCachedImageExplanation(
      documentId,
      pageNumber,
      imageExplanationState.bounds
    ).then(() => {
      setImageExplanationState(prev => prev ? {
        ...prev,
        savedExplanation: null
      } : null);
    }).catch(err => {
      console.error('Failed to delete image explanation:', err);
    });
  }, [documentId, pageNumber, imageExplanationState]);

  // Handle mouse move to detect hoverable elements
  const handleCanvasMouseMove = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (focusMode || !canvasRef.current || !geminiExtraction) {
      if (hoveredElement) setHoveredElement(null);
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const relativeX = event.clientX - rect.left;
    const relativeY = event.clientY - rect.top;

    if (relativeX < 0 || relativeY < 0 || relativeX > rect.width || relativeY > rect.height) {
      if (hoveredElement) setHoveredElement(null);
      return;
    }

    const padding = 16;
    const pdfX = relativeX / zoom - padding;
    const pdfY = page.size.height - (relativeY / zoom - padding);

    // Check for hoverable element types: formula, reference, table, image
    const hoverableTypes: GeminiElementType[] = ['formula', 'reference', 'table', 'image'];

    // Use aligned elements when available (more accurate bounds from PDF text items)
    // Only fall back to Gemini bounds for element types that don't have aligned data
    for (const elementType of hoverableTypes) {
      // Check aligned elements first
      if (alignedElements) {
        const alignedForType = alignedElements.elements.filter(el => el.type === elementType);
        if (alignedForType.length > 0) {
          // We have aligned data for this type - use ONLY aligned bounds, don't fall back to Gemini
          const aligned = alignedForType.find(el => {
            const { bounds } = el;
            const tolerance = elementType === 'formula' ? 20 : 15;
            return (
              pdfX >= bounds.minX - tolerance &&
              pdfX <= bounds.maxX + tolerance &&
              pdfY >= bounds.minY - tolerance &&
              pdfY <= bounds.maxY + tolerance
            );
          });
          if (aligned) {
            const { bounds } = aligned;
            if (!hoveredElement ||
                hoveredElement.type !== elementType ||
                hoveredElement.bounds.minX !== bounds.minX ||
                hoveredElement.bounds.minY !== bounds.minY) {
              setHoveredElement({ type: elementType as GeminiElementType, bounds });
            }
            return;
          }
          // Has aligned data but cursor not in bounds - skip to next type (don't use Gemini)
          continue;
        }
      }

      // No aligned data for this type - fall back to Gemini bounds
      const element = findElementAtPoint(
        geminiExtraction,
        pageNumber,
        pdfX,
        pdfY,
        page.size.width,
        page.size.height,
        elementType
      );
      if (element) {
        const bounds = convertBoundsToCoordinates(element.bounding_box, page.size.width, page.size.height);
        if (!hoveredElement ||
            hoveredElement.type !== elementType ||
            hoveredElement.bounds.minX !== bounds.minX ||
            hoveredElement.bounds.minY !== bounds.minY) {
          setHoveredElement({ type: elementType, bounds });
        }
        return;
      }
    }

    // Debug: Log formulas on this page if Alt key is held (for debugging detection issues)
    if (event.altKey) {
      const pageData = geminiExtraction.pages.find(p => p.page_number === pageNumber);
      const formulas = pageData?.elements.filter(e => e.type === 'formula') ?? [];
      const alignedFormulas = alignedElements?.elements.filter(e => e.type === 'formula') ?? [];
      console.debug(`[Hover Debug] Page ${pageNumber}, cursor at (${pdfX.toFixed(1)}, ${pdfY.toFixed(1)})`);
      if (alignedFormulas.length > 0) {
        console.debug('  Aligned formulas:');
        alignedFormulas.forEach((f, i) => {
          const { bounds } = f;
          const contentPreview = typeof f.content === 'string' ? f.content.substring(0, 40) : '';
          console.debug(`    ${i}: [${bounds.minX.toFixed(1)}, ${bounds.minY.toFixed(1)}] to [${bounds.maxX.toFixed(1)}, ${bounds.maxY.toFixed(1)}] (${bounds.source})`, contentPreview);
        });
      }
      if (formulas.length > 0) {
        console.debug('  Gemini formulas:');
        formulas.forEach((f, i) => {
          const bounds = convertBoundsToCoordinates(f.bounding_box, page.size.width, page.size.height);
          console.debug(`    ${i}: [${bounds.minX.toFixed(1)}, ${bounds.minY.toFixed(1)}] to [${bounds.maxX.toFixed(1)}, ${bounds.maxY.toFixed(1)}]`, f.content?.substring(0, 40));
        });
      }
    }

    // No element found, clear hover state
    if (hoveredElement) {
      setHoveredElement(null);
    }
  }, [focusMode, geminiExtraction, alignedElements, pageNumber, page.size.width, page.size.height, zoom, hoveredElement]);

  // Clear hover on mouse leave
  const handleCanvasMouseLeave = useCallback(() => {
    setHoveredElement(null);
  }, []);

  const handleCanvasClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (focusMode) {
      return;
    }
    if (!canvasRef.current || !htmlPage) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('.canvas-overlay-toolbar-button')) {
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const relativeX = event.clientX - rect.left;
    const relativeY = event.clientY - rect.top;

    if (relativeX < 0 || relativeY < 0 || relativeX > rect.width || relativeY > rect.height) {
      return;
    }

    // Use CSS dimensions for coordinate conversion (not buffer dimensions which include devicePixelRatio)
    // The padding value matches DEFAULT_OPTIONS.pagePadding in canvasRenderer.ts
    const padding = 16;
    // Convert CSS click coordinates to PDF coordinates
    // relativeX/relativeY are in CSS pixels, zoom is the current scale
    const pdfX = relativeX / zoom - padding;
    const pdfY = page.size.height - (relativeY / zoom - padding);

    // Check for reference or formula click if gemini extraction is available
    if (geminiExtraction) {
      // Helper to show formula popup
      const showFormulaPopup = (formulaElement: GeminiElement) => {
        console.debug('Formula clicked:', formulaElement);
        const formulaContent = typeof formulaElement.content === 'string'
          ? formulaElement.content
          : JSON.stringify(formulaElement.content);
        // Position popup near the click
        const popupLeft = relativeX + 20;
        const popupTop = relativeY;
        // Open MathViewPopup with the formula - the content might already be LaTeX
        setMathViewState({
          latex: formulaContent,
          position: { top: popupTop, left: popupLeft },
          isLoading: false,
          error: null
        });
        onCanvasHighlight(null);
        setTableOverlay(null);
        setReferencePopup(null);
      };

      // Check for exact formula match first
      const formulaElement = findElementAtPoint(
        geminiExtraction,
        pageNumber,
        pdfX,
        pdfY,
        page.size.width,
        page.size.height,
        'formula'
      );
      if (formulaElement) {
        showFormulaPopup(formulaElement);
        return;
      }

      // Check for reference click
      const referenceElement = findElementAtPoint(
        geminiExtraction,
        pageNumber,
        pdfX,
        pdfY,
        page.size.width,
        page.size.height,
        'reference'
      );
      if (referenceElement) {
        console.debug('Reference clicked:', referenceElement);
        const content = typeof referenceElement.content === 'string'
          ? referenceElement.content
          : JSON.stringify(referenceElement.content);
        // Position popup near the click
        const popupLeft = relativeX + 20;
        const popupTop = relativeY;
        setReferencePopup({
          content,
          position: { top: popupTop, left: popupLeft }
        });
        onCanvasHighlight(null);
        setTableOverlay(null);
        return;
      }

      // Check for image click
      if (enableImageHighlight) {
        const imageElement = findElementAtPoint(
          geminiExtraction,
          pageNumber,
          pdfX,
          pdfY,
          page.size.width,
          page.size.height,
          'image'
        );
        if (imageElement) {
          console.debug('Image clicked:', imageElement);
          const imageBounds = convertBoundsToCoordinates(imageElement.bounding_box, page.size.width, page.size.height);
          // Try to extract image from canvas
          const canvas = canvasRef.current;
          if (canvas) {
            const canvasPadding = 16 * zoom;
            const imgLeft = imageBounds.minX * zoom + canvasPadding;
            const imgTop = (page.size.height - imageBounds.maxY) * zoom + canvasPadding;
            const imgWidth = (imageBounds.maxX - imageBounds.minX) * zoom;
            const imgHeight = (imageBounds.maxY - imageBounds.minY) * zoom;

            // Create a temporary canvas to extract the image region
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = imgWidth * window.devicePixelRatio;
            tempCanvas.height = imgHeight * window.devicePixelRatio;
            const tempCtx = tempCanvas.getContext('2d');
            if (tempCtx) {
              tempCtx.drawImage(
                canvas,
                imgLeft * window.devicePixelRatio,
                imgTop * window.devicePixelRatio,
                imgWidth * window.devicePixelRatio,
                imgHeight * window.devicePixelRatio,
                0,
                0,
                tempCanvas.width,
                tempCanvas.height
              );
              const imageDataUri = tempCanvas.toDataURL('image/png');

              // Position popup next to the image
              const popupLeft = imgLeft + imgWidth + 20;
              const popupTop = imgTop;

              // Check for cached explanation
              getCachedImageExplanation(documentId, pageNumber, imageBounds).then(cached => {
                setImageExplanationState({
                  imageDataUri,
                  bounds: imageBounds,
                  position: { top: popupTop, left: popupLeft },
                  savedExplanation: cached
                });
              }).catch(() => {
                setImageExplanationState({
                  imageDataUri,
                  bounds: imageBounds,
                  position: { top: popupTop, left: popupLeft },
                  savedExplanation: null
                });
              });

              onCanvasHighlight(null);
              setTableOverlay(null);
              setReferencePopup(null);
              setMathViewState(null);
              return;
            }
          }
        }
      }

      // If no exact match found, check if we're clicking on empty space
      // Only use the nearest formula fallback when not clicking on another element
      const clickedOnElement = hasAnyElementAtPoint(
        geminiExtraction,
        pageNumber,
        pdfX,
        pdfY,
        page.size.width,
        page.size.height
      );

      if (!clickedOnElement) {
        // Try to find nearest formula (for cases where Gemini bounding boxes are inaccurate)
        const nearestFormula = findNearestElementOfType(
          geminiExtraction,
          pageNumber,
          pdfX,
          pdfY,
          page.size.width,
          page.size.height,
          'formula',
          400 // max distance in PDF points
        );
        if (nearestFormula) {
          showFormulaPopup(nearestFormula);
          return;
        }
      }
    }

    // Close reference popup if clicking elsewhere
    setReferencePopup(null);
    setMathViewState(null);

    const extractTableHit = detectExtractedTableAtPoint({
      tables: extractedTables,
      page,
      x: pdfX,
      y: pdfY
    });
    if (extractTableHit) {
      console.debug('Extracted table hit', extractTableHit);
      setTableOverlay(extractTableHit);
      onCanvasHighlight(null);
      return;
    }

    setTableOverlay(null);

    const block = findParagraphBlockAtPoint(htmlPage, pdfX, pdfY);

    if (!block) {
      onCanvasHighlight(null);
      return;
    }

    const refinedBlock = refineTextBlockForSelection(block, { x: pdfX, y: pdfY });
    console.debug(`${FORMULA_SUGGESTION_LOG_PREFIX} paragraph selected`, {
      pageNumber,
      excerpt: summarizeForLog(refinedBlock.text),
      bounds: refinedBlock.bounds
    });
    onCanvasHighlight({ kind: 'text', pageNumber: page.number, block: refinedBlock });
  }, [focusMode, htmlPage, onCanvasHighlight, page.number, page.size.height, page.size.width, extractedTables, geminiExtraction, pageNumber, zoom, documentId, enableImageHighlight]);

  const highlightBlocks: HighlightBlockData[] = [];

  if (focusMode && focusLayout) {
    const focusPage = focusLayout.pages?.find((p: any) => (p.pageNumber ?? p.number) === page.number);
    if (focusPage) {
      for (const block of focusPage.content) {
        if (block.relevance?.state === 'highlight') {
          const highlight = buildHighlightBlockData(block);
          if (highlight) {
            highlightBlocks.push(highlight);
          }
        }
      }
    } else {
      console.log('No focus page found for page', page.number);
    }
  }

  if (!focusMode && canvasHighlight?.pageNumber === page.number) {
    const manualHighlight = buildHighlightBlockData(canvasHighlight.block);
    if (manualHighlight) {
      highlightBlocks.push(manualHighlight);
    }
  }

  // Use zoom for scaling overlays (not canvas buffer dimensions which include devicePixelRatio)
  // The overlay is positioned in CSS coordinates, so we use the zoom factor directly
  const scaleX = zoom;
  const scaleY = zoom;
  const hasOverlayContent = highlightBlocks.length > 0 || Boolean(tableOverlay);
  const hasSemanticHighlights = semanticSearchResults.length > 0;
  const overlayClassName = hasOverlayContent ? 'canvas-overlay canvas-overlay--interactive' : 'canvas-overlay';
  const overlayLayerClassName = hasOverlayContent
    ? 'canvas-overlay-layer canvas-overlay-layer--interactive'
    : 'canvas-overlay-layer';

  return (
    <div
      className="canvas-page"
      onClick={handleCanvasClick}
      onMouseMove={handleCanvasMouseMove}
      onMouseLeave={handleCanvasMouseLeave}
      data-page-number={pageNumber}
      style={{
        cursor: hoveredElement && (
          (hoveredElement.type === 'formula' && enableFormulaHighlight) ||
          (hoveredElement.type === 'table' && enableTableHighlight) ||
          (hoveredElement.type === 'image' && enableImageHighlight) ||
          (hoveredElement.type === 'reference')
        ) ? 'pointer' : undefined
      }}
    >
      <canvas ref={handleCanvasRef} />
      {/* Semantic search highlights (non-interactive, always visible when present) */}
      {canvasRef.current && hasSemanticHighlights && (
        <div className="canvas-overlay-layer" aria-hidden="true">
          {semanticSearchResults.map((result, index) => {
            const { chunk, score } = result;
            const bounds = chunk.bounds;
            const canvasPadding = 16 * zoom;
            const highlightPadding = 6;
            const left = bounds.minX * scaleX + canvasPadding - highlightPadding;
            const top = (page.size.height - bounds.maxY) * scaleY + canvasPadding - highlightPadding;
            const width = (bounds.maxX - bounds.minX) * scaleX + highlightPadding * 2;
            const height = (bounds.maxY - bounds.minY) * scaleY + highlightPadding * 2;
            const isActive = chunk.id === activeSemanticResultId;
            return (
              <div
                key={`semantic-${chunk.id}-${index}`}
                className={`semantic-search-highlight${isActive ? ' semantic-search-highlight--active' : ''}`}
                style={{
                  left: `${left}px`,
                  top: `${top}px`,
                  width: `${width}px`,
                  height: `${height}px`
                }}
                title={`${chunk.text.substring(0, 100)}... (score: ${(score * 100).toFixed(1)}%)`}
              />
            );
          })}
        </div>
      )}
      {canvasRef.current && (highlightBlocks.length > 0 || tableOverlay) && (
        <div className={overlayLayerClassName} aria-hidden="true">
          <div className="canvas-overlay-full-dim" />
          <div className={overlayClassName}>
            {highlightBlocks.map((block, index) => {
              const bounds = block.bounds;
              const blockKey = buildHighlightBlockKey(page.number, bounds);
              const overrideText = highlightTextOverrides[blockKey];
              const lines: HighlightLineData[] = overrideText
                ? [
                    {
                      text: overrideText,
                      bounds,
                      lineHeight: getOverrideLineHeight(block)
                    }
                  ]
                : block.lines;
              const highlightText = lines.map((line) => line.text).join(' ').trim();
              const imageEntry = imageMap[blockKey];
              const isLoadingImage = Boolean(imageLoading[blockKey]);
              const imageErrorMessage = imageError[blockKey];
              const hasRequestedImage = isLoadingImage || Boolean(imageEntry) || Boolean(imageErrorMessage);
              const blockFontSizePx = block.fontSize ? block.fontSize * scaleY : undefined;
              // Account for canvas padding (16px matches DEFAULT_OPTIONS.pagePadding)
              const canvasPadding = 16 * zoom;
              const blockLeft = bounds.minX * scaleX + canvasPadding;
              const blockTop = (page.size.height - bounds.maxY) * scaleY + canvasPadding; // Flip Y coordinate
              const blockWidth = (bounds.maxX - bounds.minX) * scaleX;
              const blockHeight = (bounds.maxY - bounds.minY) * scaleY;
              const hasLineGeometry = lines.length > 0 && lines.every((line) => Boolean(line.bounds));
              const extraImageWidth = hasRequestedImage ? IMAGE_PANEL_WIDTH + HIGHLIGHT_PADDING : 0;
              const selectedBlockForWidget =
                activeTextSelection &&
                buildHighlightBlockKey(page.number, activeTextSelection.block.bounds) === blockKey
                  ? activeTextSelection
                  : null;
              const formulaSuggestionEntry = formulaSuggestionState[blockKey];
              const isDetectingInterestingStuff = formulaSuggestionEntry?.status === 'loading';
              const showFormulaSuggestion = formulaSuggestionEntry?.status === 'ready' && formulaSuggestionEntry?.hasMath;
              const highlightFormulaSuggestion = showFormulaSuggestion && formulaSuggestionAttentionKey === blockKey;

              return (
                <div
                  key={index}
                  className="canvas-overlay-highlight-block"
                  style={{
                    left: `${blockLeft - HIGHLIGHT_PADDING}px`,
                    top: `${blockTop - HIGHLIGHT_PADDING}px`,
                    width: `${blockWidth + HIGHLIGHT_PADDING * 2 + extraImageWidth}px`,
                    height: `${blockHeight + HIGHLIGHT_PADDING * 2}px`,
                    fontFamily: block.fontFamily
                  }}
                >
                  <OverlayToolbar onClose={() => onCanvasHighlight(null)}>
                    <OverlayToolbarButton
                      onClick={() => handleOpenMiniChat(highlightText, blockLeft, blockTop, blockWidth, bounds)}
                      icon={<ExploreIcon />}
                      label="Chat about this"
                      title="Ask questions about this text"
                    />
                    <OverlayToolbarButton
                      onClick={() => handleGenerateImage(blockKey, highlightText, bounds)}
                      icon={isLoadingImage ? <LoadingIcon /> : <ImageIcon />}
                      label="Generate Gemini image"
                      title="Generate Gemini image for this text"
                      disabled={isLoadingImage}
                    />
                    <OverlayToolbarButton
                      onClick={() =>
                        void handleGenerateInteractiveWidget(
                          highlightText,
                          getWidgetPopupPosition(bounds),
                          bounds,
                          selectedBlockForWidget
                        )
                      }
                      icon={isGeneratingInteractiveWidget ? <LoadingIcon /> : <WidgetIcon />}
                      label="Create interactive widget"
                      title="Generate a sandboxed interactive widget for this paragraph"
                      disabled={isGeneratingInteractiveWidget}
                    />
                    {isDetectingInterestingStuff && (
                      <OverlayToolbarButton
                        onClick={() => {}}
                        icon={<LoadingIcon />}
                        label="Detecting interesting stuff"
                        title="Detecting interesting stuff inside this selection..."
                        ariaDisabled
                        className="overlay-toolbar-btn--busy"
                      />
                    )}
                    {showFormulaSuggestion && (
                      <OverlayToolbarButton
                        onClick={() => handleDetectMath(highlightText, blockTop + blockHeight + 10, blockLeft)}
                        icon={<MathIcon />}
                        label="Formula widget"
                        title="Open the detected formula widget for this text"
                        variant="primary"
                        className={highlightFormulaSuggestion ? 'overlay-toolbar-btn--suggested' : ''}
                      />
                    )}
                  </OverlayToolbar>
                  <div className="canvas-overlay-highlight-inner">
                    <div
                      className="canvas-overlay-highlight-content"
                      style={
                        hasRequestedImage
                          ? { gridTemplateColumns: `minmax(0, 1fr) ${IMAGE_PANEL_WIDTH}px` }
                          : { gridTemplateColumns: '1fr' }
                      }
                    >
                      <div className="canvas-overlay-highlight-text">
                        {hasLineGeometry ? (
                          lines.map((line, lineIndex) => {
                            const lineBounds = line.bounds!;
                            const relativeLeft = (lineBounds.minX - bounds.minX) * scaleX + HIGHLIGHT_PADDING;
                            const relativeTop = (bounds.maxY - lineBounds.maxY) * scaleY + HIGHLIGHT_PADDING;
                            const lineWidthPx = (lineBounds.maxX - lineBounds.minX) * scaleX;
                            const measuredHeight = (lineBounds.maxY - lineBounds.minY) * scaleY;
                            const scaledLineHeight = typeof line.lineHeight === 'number' ? line.lineHeight * scaleY : undefined;
                            const computedLineHeight = Math.max(10, scaledLineHeight ?? measuredHeight ?? blockFontSizePx ?? 14);
                            const computedFontSize = Math.min(
                              computedLineHeight,
                              Math.max(10, blockFontSizePx ?? computedLineHeight * 0.85)
                            );

                            return (
                              <div
                                key={`${index}-${lineIndex}`}
                                className="canvas-overlay-highlight-line"
                                style={{
                                  left: `${relativeLeft}px`,
                                  top: `${relativeTop}px`,
                                  width: `${lineWidthPx}px`,
                                  height: `${computedLineHeight}px`,
                                  fontSize: `${computedFontSize}px`,
                                  lineHeight: `${computedLineHeight}px`
                                }}
                              >
                                <CitationText
                                  text={line.text}
                                  onCitationClick={handleCitationClick}
                                  hasExtraction={Boolean(geminiExtraction)}
                                  paragraphText={highlightText}
                                  bounds={bounds}
                                />
                              </div>
                            );
                          })
                        ) : lines.length > 0 ? (
                          <div
                            className="canvas-overlay-highlight-flow"
                            style={{
                              padding: `${HIGHLIGHT_PADDING}px`,
                              fontSize: `${Math.max(12, blockFontSizePx ?? 14)}px`,
                              lineHeight: 1.4
                            }}
                          >
                            {lines.map((line, lineIndex) => (
                              <span key={`${index}-flow-${lineIndex}`}>
                                <CitationText
                                  text={line.text}
                                  onCitationClick={handleCitationClick}
                                  hasExtraction={Boolean(geminiExtraction)}
                                  paragraphText={highlightText}
                                  bounds={bounds}
                                />
                                {lineIndex < lines.length - 1 && <br />}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      {hasRequestedImage && (
                        <div className="canvas-overlay-image-panel" style={{ width: `${IMAGE_PANEL_WIDTH}px` }}>
                          {imageEntry ? (
                            <div className="canvas-overlay-image">
                              <img src={imageEntry.dataUri} alt="Gemini generated" />
                              {imageEntry.text && <div className="canvas-overlay-image-caption">{imageEntry.text}</div>}
                            </div>
                          ) : isLoadingImage ? (
                            <div className="canvas-overlay-image canvas-overlay-image--loading">
                              <LoadingIcon />
                              <span>Generating image…</span>
                            </div>
                          ) : imageErrorMessage ? (
                            <div className="canvas-overlay-image canvas-overlay-image--error">{imageErrorMessage}</div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {tableOverlay && (
              <TableViewer
                table={tableOverlay.model}
                bounds={tableOverlay.bounds}
                pageHeight={page.size.height}
                scaleX={scaleX}
                scaleY={scaleY}
                sortState={tableSortState[tableOverlay.model.id] ?? null}
                onSortChange={(tableId, next) =>
                  setTableSortState((current) => ({
                    ...current,
                    [tableId]: next
                  }))
                }
                ensureGeminiApiKey={ensureGeminiApiKey}
                focusProvider={focusProvider}
                onClose={() => setTableOverlay(null)}
              />
            )}
          </div>
        </div>
      )}

      {/* Mini Chat Views for contextual questions - supports multiple simultaneous chats */}
      {miniChatStates.size > 0 && Array.from(miniChatStates.entries()).map(([boundsKey, chatState]) => (
        <MiniChatView
          key={boundsKey}
          contextText={chatState.contextText}
          apiKey={overlayAiKey}
          provider={overlayAiProvider}
          model={overlayAiModel}
          onClose={() => handleCloseMiniChat(boundsKey)}
          position={chatState.position}
          documentId={documentId}
          pageNumber={pageNumber}
          bounds={chatState.bounds}
          onAnnotationChange={handleAnnotationChange}
          enableWebSearch={enableWebSearch}
        />
      ))}

      {/* Annotation markers for saved chats, images, and widgets */}
      {pageAnnotations.length > 0 && canvasRef.current && (
        <div className="canvas-overlay-layer">
          {pageAnnotations
            .filter((annotation) => annotation.bounds && typeof annotation.bounds.maxX === 'number')
            .map((annotation) => {
            const canvasPadding = 16 * zoom;
            const markerLeft = annotation.bounds.maxX * scaleX + canvasPadding + 4;
            const markerTop = (page.size.height - annotation.bounds.maxY) * scaleY + canvasPadding;
            const isChat = annotation.type === 'chat';
            const isImage = annotation.type === 'image';
            const isWidget = annotation.type === 'widget';
            const handleClick = isChat
              ? () => handleAnnotationMarkerClick(annotation.id, annotation.bounds)
              : isImage
              ? () => handleImageMarkerClick(annotation.id, annotation.bounds)
              : isWidget
              ? () => handleWidgetMarkerClick(annotation.id, annotation.bounds)
              : undefined;
            const title = isChat
              ? 'Click to open chat'
              : isImage
              ? 'Click to view generated image'
              : isWidget
              ? 'Click to reopen interactive widget'
              : annotation.type;
            return (
              <button
                type="button"
                key={annotation.id}
                className={`annotation-marker annotation-marker--${annotation.type}`}
                style={{
                  left: `${markerLeft}px`,
                  top: `${markerTop}px`
                }}
                title={title}
                onClick={handleClick}
              >
                {isChat && <ChatMarkerIcon />}
                {isImage && <ImageMarkerIcon />}
                {isWidget && <WidgetMarkerIcon />}
              </button>
            );
          })}
        </div>
      )}

      {/* Reference Popup */}
      {referencePopup && (
        <div
          className="reference-popup"
          style={{
            top: `${referencePopup.position.top}px`,
            left: `${referencePopup.position.left}px`
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="reference-popup-header">
            <span className="reference-popup-title">Reference [{referencePopup.citationNumber}]</span>
            <button
              type="button"
              className="reference-popup-close"
              onClick={() => setReferencePopup(null)}
              aria-label="Close reference"
            >
              ×
            </button>
          </div>
          <div className="reference-popup-content">
            {referencePopup.content}
          </div>
          <div className="reference-popup-actions">
            <button
              type="button"
              className="reference-popup-explain-btn"
              onClick={handleExplainConnection}
              disabled={!overlayAiKey.trim()}
              title={
                overlayAiKey.trim()
                  ? 'Explain how this reference connects to the paragraph'
                  : `${overlayAiProvider === 'openai' ? 'OpenAI' : 'Gemini'} API key required`
              }
            >
              <ConnectionIcon /> Explain Connection
            </button>
          </div>
        </div>
      )}

      {/* Connection Chat View */}
      {connectionChatState && (
        <MiniChatView
          contextText={connectionChatState.contextText}
          apiKey={overlayAiKey}
          provider={overlayAiProvider}
          model={overlayAiModel}
          onClose={handleCloseConnectionChat}
          position={connectionChatState.position}
          documentId={documentId}
          pageNumber={pageNumber}
          bounds={connectionChatState.bounds}
          onAnnotationChange={handleAnnotationChange}
          initialQuery={connectionChatState.initialQuery}
          enableWebSearch={enableWebSearch}
        />
      )}

      {/* Image Preview Popup */}
      {imagePreview && (
        <ImagePreviewPopup
          dataUri={imagePreview.dataUri}
          position={imagePreview.position}
          onClose={handleCloseImagePreview}
          onDelete={imagePreview.annotationId ? handleDeleteImageAnnotation : undefined}
        />
      )}

      {/* Math View Popup */}
      {mathViewState && (
        <MathViewPopup
          latex={mathViewState.latex}
          position={mathViewState.position}
          onClose={handleCloseMathView}
          isLoading={mathViewState.isLoading}
          error={mathViewState.error}
          apiKey={overlayAiKey || undefined}
          provider={overlayAiProvider}
          model={overlayAiModel}
        />
      )}

      {/* Image Explanation Popup */}
      {imageExplanationState && (
        <ImageExplanationPopup
          imageDataUri={imageExplanationState.imageDataUri}
          position={imageExplanationState.position}
          onClose={handleCloseImageExplanation}
          apiKey={overlayAiKey || undefined}
          provider={overlayAiProvider}
          model={overlayAiModel}
          savedExplanation={imageExplanationState.savedExplanation}
          onSaveExplanation={handleSaveImageExplanation}
          onDeleteExplanation={handleDeleteImageExplanation}
        />
      )}

      {interactiveWidgetState && (
        <InteractiveWidgetPopup
          title={interactiveWidgetState.title}
          position={interactiveWidgetState.position}
          srcDoc={interactiveWidgetState.srcDoc}
          isLoading={interactiveWidgetState.isLoading}
          error={interactiveWidgetState.error}
          onClose={handleCloseInteractiveWidget}
        />
      )}
    </div>
  );
}

function summarizeForLog(value: string, maxLength = 120): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function ExplainIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10.4 9a1.6 1.6 0 1 1 2.6 1.2c-.6.45-1 .73-1 .98v1.45"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="16.3" r="0.85" fill="currentColor" />
    </svg>
  );
}

function ChatMarkerIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v7a1.5 1.5 0 0 1-1.5 1.5H5l-3 2v-2H1.5A1.5 1.5 0 0 1 0 10.5v-7A1.5 1.5 0 0 1 1.5 2h.5v1.5z"
        fill="currentColor"
      />
      <circle cx="5" cy="7" r="1" fill="white" />
      <circle cx="8" cy="7" r="1" fill="white" />
      <circle cx="11" cy="7" r="1" fill="white" />
    </svg>
  );
}

function ImageMarkerIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <rect x="1" y="2" width="14" height="12" rx="2" fill="currentColor" />
      <circle cx="5" cy="6" r="1.5" fill="white" />
      <path d="M3 12l3-4 2 2 4-5 3 7H3z" fill="white" />
    </svg>
  );
}

function WidgetMarkerIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <rect x="1.5" y="2" width="13" height="11.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.2 5.3h3.2M4.2 8h2.2M4.2 10.7h3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path
        d="M10.2 6.2l1 1 1.8-2M10.2 10l1 1 1.8-2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ConnectionIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <circle cx="4" cy="8" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="8" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 8h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Renders paragraph popup text with clickable citations and URLs.
 */
interface CitationTextProps {
  text: string;
  onCitationClick: (citationNumber: string, event: React.MouseEvent, paragraphText: string, bounds: AnnotationBounds) => void;
  hasExtraction: boolean;
  paragraphText: string;
  bounds: AnnotationBounds;
}

function CitationText({ text, onCitationClick, hasExtraction, paragraphText, bounds }: CitationTextProps): JSX.Element {
  const parts = parsePopupTextSegments(text);

  if (parts.length === 0) {
    return <>{text}</>;
  }

  return (
    <>
      {parts.map((part, index) => {
        if (part.type === 'text') {
          return <span key={index}>{part.content}</span>;
        }
        if (part.type === 'url') {
          return (
            <a
              key={index}
              className="popup-url-link"
              href={part.href}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              title={part.href}
            >
              {part.content}
            </a>
          );
        }
        // For citations, make them clickable
        // If multiple numbers, clicking shows the first one for now
        const firstNumber = part.numbers[0] ?? '';
        return (
          <span
            key={index}
            className="citation-link"
            onClick={(e) => {
              e.stopPropagation();
              onCitationClick(firstNumber, e, paragraphText, bounds);
            }}
            title={hasExtraction ? `View reference ${part.content}` : `View citation ${part.content} (run extraction for reference details)`}
          >
            {part.content}
          </span>
        );
      })}
    </>
  );
}

function renderTableOverlay(
  overlay: ExtractTableHit,
  page: PDFPage,
  scaleX: number,
  scaleY: number,
  onClose: () => void,
  sortState: TableSortState,
  onSort: (column: number) => void
): JSX.Element {
  const bounds = overlay.bounds;
  const left = bounds.minX * scaleX - HIGHLIGHT_PADDING;
  const top = (page.size.height - bounds.maxY) * scaleY - HIGHLIGHT_PADDING;
  const width = (bounds.maxX - bounds.minX) * scaleX + HIGHLIGHT_PADDING * 2;
  const height = (bounds.maxY - bounds.minY) * scaleY + HIGHLIGHT_PADDING * 2;

  const rows: Array<Array<{ text: string; kind: 'td' | 'th' }>> = [];
  if (overlay.model.cells && overlay.model.cells.length > 0) {
    const maxRow = Math.max(...overlay.model.cells.map((cell) => cell.row), 0);
    const maxCol = Math.max(...overlay.model.cells.map((cell) => cell.col), 0);
    for (let rowIndex = 1; rowIndex <= maxRow; rowIndex += 1) {
      const row: Array<{ text: string; kind: 'td' | 'th' }> = [];
      for (let colIndex = 1; colIndex <= maxCol; colIndex += 1) {
        const cell = overlay.model.cells.find((candidate) => candidate.row === rowIndex && candidate.col === colIndex);
        row.push({
          text: cell?.text ?? '',
          kind: rowIndex === 1 ? 'th' : 'td'
        });
      }
      rows.push(row);
    }
  }

  const sortedRows = sortTableRows(rows, sortState);

  return (
    <div
      className="canvas-overlay-highlight-block canvas-overlay-table-block"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        minWidth: `${width}px`,
        minHeight: `${height}px`
      }}
    >
      <div className="canvas-overlay-highlight-toolbar" role="toolbar" aria-label="Table overlay">
        <button type="button" className="canvas-overlay-toolbar-button" onClick={onClose}>
          <span className="canvas-overlay-toolbar-icon" aria-hidden="true">
            ×
          </span>
        </button>
      </div>
      <div className="canvas-overlay-highlight-inner">
        <div className="canvas-overlay-table-shell">
          <div className="canvas-overlay-table-title">Extracted table preview</div>
          <div className="canvas-overlay-table-scroll">
            {rows.length === 0 ? (
              <div className="canvas-overlay-table-placeholder">Table detected (no cell data available).</div>
            ) : (
              <table className="canvas-overlay-table">
                <tbody>
                  {sortedRows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, colIndex) => {
                        const CellTag = cell.kind === 'th' ? 'th' : 'td';
                        const isHeader = cell.kind === 'th';
                        return (
                          <CellTag
                            key={`${rowIndex}-${colIndex}`}
                            className={isHeader ? 'table-sortable-header' : undefined}
                            onClick={isHeader ? () => onSort(colIndex) : undefined}
                          >
                            {cell.text || '\u00A0'}
                            {isHeader && sortState?.column === colIndex && (
                              <span className="table-sort-indicator">{sortState.direction === 'asc' ? '▲' : '▼'}</span>
                            )}
                          </CellTag>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
