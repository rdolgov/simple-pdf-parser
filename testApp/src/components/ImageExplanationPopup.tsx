import { useState, useCallback, useRef, useEffect } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { OverlayToolbar, OverlayToolbarButton } from './OverlayToolbar';
import { createTransportedGeminiApi, createTransportedOpenAiApi } from '../utils/llmClients';
import { getProviderDisplayName, isOpenAiCompatibleAppProvider } from '../utils/providerMetadata';


export interface ImageExplanationData {
  explanation: string;
  timestamp: number;
}

interface ImageExplanationPopupProps {
  imageDataUri: string;
  position: { top: number; left: number };
  onClose: () => void;
  apiKey?: string;
  provider?: 'gemini' | 'openai' | 'codex';
  model?: string | null;
  savedExplanation?: ImageExplanationData | null;
  onSaveExplanation: (explanation: string) => void;
  onDeleteExplanation?: () => void;
}

export function ImageExplanationPopup({
  imageDataUri,
  position,
  onClose,
  apiKey,
  provider = 'openai',
  model,
  savedExplanation,
  onSaveExplanation,
  onDeleteExplanation
}: ImageExplanationPopupProps): JSX.Element {
  const [dragPosition, setDragPosition] = useState<{ top: number; left: number } | null>(null);
  const [explanation, setExplanation] = useState<string | null>(savedExplanation?.explanation ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; elemX: number; elemY: number } | null>(null);

  // Reset drag position when click position changes (always open next to clicked button)
  useEffect(() => {
    setDragPosition(null);
  }, [position.top, position.left]);


  const handleDragStart = useCallback((e: ReactMouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.image-explanation-drag-handle')) {
      return;
    }
    e.preventDefault();
    isDraggingRef.current = true;

    const container = containerRef.current;
    if (container) {
      const style = container.style;
      const currentTop = parseFloat(style.top) || 0;
      const currentLeft = parseFloat(style.left) || 0;

      dragStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        elemX: currentLeft,
        elemY: currentTop
      };
    }
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !dragStartRef.current) return;

      const deltaX = e.clientX - dragStartRef.current.mouseX;
      const deltaY = e.clientY - dragStartRef.current.mouseY;

      const newLeft = dragStartRef.current.elemX + deltaX;
      const newTop = dragStartRef.current.elemY + deltaY;

      setDragPosition({ top: newTop, left: newLeft });
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
      }
      dragStartRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleContainerClick = useCallback((e: ReactMouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleExplain = useCallback(async () => {
    if (!apiKey) {
      setError(`${getProviderDisplayName(provider)} API key is required`);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Extract base64 data from data URI
      const [header, base64Data] = imageDataUri.split(',');
      const mimeMatch = header.match(/data:([^;]+)/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

      const prompt = `Please analyze this image from an academic/scientific document and provide a clear, comprehensive explanation. Include:

1. **What the image shows**: Describe the visual content (diagram, chart, figure, photograph, etc.)
2. **Key elements**: Identify and explain important components, labels, or data points
3. **Purpose**: What is this image trying to illustrate or communicate?
4. **Context**: How might this relate to the surrounding document content?

      Keep the explanation concise but thorough, suitable for someone trying to understand the document.`;
      const result = isOpenAiCompatibleAppProvider(provider)
        ? await createTransportedOpenAiApi({
            apiKey,
            ...(model && model.trim().length > 0 ? { model: model.trim() } : {})
          }, provider).generateFromImage(base64Data, mimeType, prompt)
        : await createTransportedGeminiApi({
            apiKey,
            ...(model && model.trim().length > 0 ? { model: model.trim() } : {})
          }).generateFromImage(base64Data, mimeType, prompt, { mediaResolution: 'high' });

      setExplanation(result.text);
      onSaveExplanation(result.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to explain image');
    } finally {
      setIsLoading(false);
    }
  }, [apiKey, imageDataUri, onSaveExplanation, provider, model]);

  const handleDelete = useCallback(() => {
    setExplanation(null);
    onDeleteExplanation?.();
  }, [onDeleteExplanation]);

  const currentPosition = dragPosition ?? position;
  const positionStyle = {
    top: `${currentPosition.top}px`,
    left: `${currentPosition.left}px`
  };

  return (
    <div
      ref={containerRef}
      className="image-explanation-popup"
      style={positionStyle}
      onClick={handleContainerClick}
      onMouseDown={handleDragStart}
    >
      <div className="image-explanation-drag-handle">
        <DragIcon />
      </div>
      <OverlayToolbar onClose={onClose} position="left">
        <OverlayToolbarButton
          onClick={handleExplain}
          icon={isLoading ? <LoadingIcon /> : <ExplainIcon />}
          label="Explain image"
          title={explanation ? 'Re-explain this image' : 'Explain this image with AI'}
          disabled={isLoading || !apiKey}
        />
      </OverlayToolbar>
      <div className="image-explanation-content">
        <div className="image-explanation-image">
          <img src={imageDataUri} alt="Document image" />
        </div>
        {error && (
          <div className="image-explanation-error">{error}</div>
        )}
        {isLoading && (
          <div className="image-explanation-loading">
            <LoadingIcon />
            <span>Analyzing image...</span>
          </div>
        )}
        {explanation && !isLoading && (
          <div className="image-explanation-note">
            <div className="image-explanation-note-header">
              <NoteIcon />
              <span>AI Explanation</span>
              {savedExplanation && (
                <span className="image-explanation-saved-badge">Saved</span>
              )}
              {savedExplanation && onDeleteExplanation && (
                <button
                  type="button"
                  className="image-explanation-delete-btn"
                  onClick={handleDelete}
                  title="Delete this explanation"
                >
                  <TrashIcon />
                </button>
              )}
            </div>
            <div className="image-explanation-note-text">{explanation}</div>
          </div>
        )}
        {!explanation && !isLoading && !error && (
          <div className="image-explanation-hint">
            Click the <strong>?</strong> button to get an AI explanation of this image
          </div>
        )}
      </div>
    </div>
  );
}

function DragIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 6" width="16" height="6" aria-hidden="true">
      <circle cx="4" cy="1.5" r="1.2" fill="currentColor" />
      <circle cx="8" cy="1.5" r="1.2" fill="currentColor" />
      <circle cx="12" cy="1.5" r="1.2" fill="currentColor" />
      <circle cx="4" cy="4.5" r="1.2" fill="currentColor" />
      <circle cx="8" cy="4.5" r="1.2" fill="currentColor" />
      <circle cx="12" cy="4.5" r="1.2" fill="currentColor" />
    </svg>
  );
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

function LoadingIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" className="spin" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="28"
        strokeDashoffset="8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function NoteIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3 2h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M5 5h6M5 8h6M5 11h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M5.5 2V1.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V2M2 4h12M4 4v9.5a1.5 1.5 0 0 0 1.5 1.5h5a1.5 1.5 0 0 0 1.5-1.5V4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6.5 7v4M9.5 7v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
