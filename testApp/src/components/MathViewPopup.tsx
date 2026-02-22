import { useState, useCallback, useRef, useEffect } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { GeminiAPI } from 'pdf-layout-parser';
import {
  type FormulaExplanation,
  getCachedExplanation,
  setCachedExplanation
} from '../storage/mathCache';


interface MathViewPopupProps {
  latex: string;
  position: { top: number; left: number };
  onClose: () => void;
  isLoading?: boolean;
  error?: string | null;
  apiKey?: string;
}

export function MathViewPopup({
  latex,
  position,
  onClose,
  isLoading = false,
  error = null,
  apiKey
}: MathViewPopupProps): JSX.Element {
  const [dragPosition, setDragPosition] = useState<{ top: number; left: number } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<FormulaExplanation | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mathContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; elemX: number; elemY: number } | null>(null);

  // Reset drag position when click position changes (new formula clicked)
  // This ensures the popup appears at the click location, not the previously dragged location
  useEffect(() => {
    setDragPosition(null);
  }, [position.top, position.left]);

  // Load cached explanation or reset when latex changes
  useEffect(() => {
    setExplanation(null);
    setExplainError(null);

    if (!latex) return;

    // Try to load from cache
    getCachedExplanation(latex)
      .then((cached) => {
        if (cached) {
          setExplanation(cached);
        }
      })
      .catch(() => {
        // Ignore cache errors
      });
  }, [latex]);

  // Render LaTeX with KaTeX
  useEffect(() => {
    if (!mathContainerRef.current || !latex || isLoading) return;

    try {
      katex.render(latex, mathContainerRef.current, {
        throwOnError: false,
        displayMode: true,
        trust: true,
        strict: false
      });
      setRenderError(null);
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : 'Failed to render LaTeX');
    }
  }, [latex, isLoading]);


  const handleDragStart = useCallback((e: ReactMouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.math-view-drag-handle')) {
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

  const handleExplainFormula = useCallback(async () => {
    if (!apiKey || !latex || isExplaining) return;

    setIsExplaining(true);
    setExplainError(null);

    try {
      const client = new GeminiAPI({ apiKey, model: 'gemini-3-pro-preview' });
      const prompt = `Analyze this mathematical formula and provide a structured explanation.

LaTeX formula: ${latex}

Respond with valid JSON in this exact format:
{
  "summary": "A clear, concise explanation of what this formula represents and its purpose (2-3 sentences)",
  "parameters": [
    {"symbol": "x", "meaning": "Description of what x represents"},
    {"symbol": "y", "meaning": "Description of what y represents"}
  ],
  "behavior": "Describe how the formula behaves - what happens when parameters increase/decrease, any special cases, asymptotes, or interesting properties",
  "example": "A concrete numerical example showing the formula in action"
}

Important:
- Only include parameters that appear in the formula
- Keep explanations accessible but accurate
- If it's a well-known formula, mention its name
- For the behavior section, describe the mathematical relationship
- Only return the JSON, no markdown code blocks`;

      const response = await client.generateText(prompt);
      let jsonText = response.text.trim();

      // Clean up potential markdown code blocks
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      const parsed = JSON.parse(jsonText) as FormulaExplanation;
      setExplanation(parsed);

      // Cache the explanation
      await setCachedExplanation(latex, parsed).catch(() => {});
    } catch (err) {
      setExplainError(err instanceof Error ? err.message : 'Failed to explain formula');
    } finally {
      setIsExplaining(false);
    }
  }, [apiKey, latex, isExplaining]);

  const currentPosition = dragPosition ?? position;
  const positionStyle = {
    top: `${currentPosition.top}px`,
    left: `${currentPosition.left}px`
  };

  const displayError = error || renderError;
  const hasFormula = !isLoading && !displayError && latex;

  return (
    <div
      ref={containerRef}
      className="math-view-popup"
      style={positionStyle}
      onClick={handleContainerClick}
      onMouseDown={handleDragStart}
    >
      <div className="math-view-drag-handle">
        <DragIcon />
      </div>
      <button
        type="button"
        className="math-view-close"
        onClick={onClose}
        aria-label="Close math view"
      >
        <CloseIcon />
      </button>

      <div className="math-view-content">
        {isLoading && (
          <div className="math-view-loading">
            <LoadingDots />
            <span>Detecting formula...</span>
          </div>
        )}

        {!isLoading && displayError && (
          <div className="math-view-error">
            {displayError}
          </div>
        )}

        {hasFormula && (
          <>
            <div className="math-view-rendered" ref={mathContainerRef} />

            {!explanation && !isExplaining && (
              <button
                type="button"
                className="math-view-explain-btn"
                onClick={handleExplainFormula}
                disabled={!apiKey}
                title={apiKey ? 'Explain this formula' : 'API key required'}
              >
                <ExplainIcon />
                <span>Explain Formula</span>
              </button>
            )}

            {isExplaining && (
              <div className="math-view-explaining">
                <LoadingDots />
                <span>Analyzing formula...</span>
              </div>
            )}

            {explainError && (
              <div className="math-view-error">
                {explainError}
              </div>
            )}

            {explanation && (
              <div className="math-view-explanation">
                <div className="math-view-explanation-section">
                  <h4>Summary</h4>
                  <p>{explanation.summary}</p>
                </div>

                {explanation.parameters.length > 0 && (
                  <div className="math-view-explanation-section">
                    <h4>Parameters</h4>
                    <ul className="math-view-params">
                      {explanation.parameters.map((param, idx) => (
                        <li key={idx}>
                          <span className="math-view-param-symbol">{param.symbol}</span>
                          <span className="math-view-param-meaning">{param.meaning}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {explanation.behavior && (
                  <div className="math-view-explanation-section">
                    <h4>Behavior</h4>
                    <p>{explanation.behavior}</p>
                  </div>
                )}

                {explanation.example && (
                  <div className="math-view-explanation-section">
                    <h4>Example</h4>
                    <p className="math-view-example">{explanation.example}</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {!isLoading && !displayError && !latex && (
          <div className="math-view-no-math">
            No mathematical formula detected in the selected text.
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

function CloseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3.5 3.5l9 9M12.5 3.5l-9 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ExplainIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M7.5 8a2.5 2.5 0 1 1 3.5 2.3v1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="10" cy="14" r="0.8" fill="currentColor" />
    </svg>
  );
}

function LoadingDots(): JSX.Element {
  return (
    <span className="loading-dots">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}
