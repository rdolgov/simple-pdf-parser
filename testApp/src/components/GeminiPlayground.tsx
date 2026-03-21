import { useCallback, useEffect, useRef, useState } from 'react';
import { canUseLocalStorage } from '../utils/storage';
import { askQuestionTask, generateImageTask } from '../api/proxyTaskApi';

type GeminiMode = 'text' | 'image';

type GeminiResultState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; model: string; text?: string; imageDataUri?: string };

const DEFAULT_TEXT_MODEL = 'gemini-3-flash-preview';
const DEFAULT_IMAGE_MODEL = 'gemini-3-pro-image-preview';

const STORAGE_KEYS = {
  textModel: 'gemini-text-model',
  imageModel: 'gemini-image-model'
} as const;

export function GeminiPlayground(): JSX.Element {
  const [prompt, setPrompt] = useState('Summarize what the PDF Layout Parser project does in two short sentences.');
  const [mode, setMode] = useState<GeminiMode>('text');
  const [textModel, setTextModel] = useState(DEFAULT_TEXT_MODEL);
  const [imageModel, setImageModel] = useState(DEFAULT_IMAGE_MODEL);
  const [result, setResult] = useState<GeminiResultState>({ status: 'idle' });
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!canUseLocalStorage()) {
      return;
    }
    try {
      const storedTextModel = window.localStorage.getItem(STORAGE_KEYS.textModel);
      const storedImageModel = window.localStorage.getItem(STORAGE_KEYS.imageModel);
      if (storedTextModel) {
        setTextModel(storedTextModel);
      }
      if (storedImageModel) {
        setImageModel(storedImageModel);
      }
    } catch (error) {
      console.warn('Unable to restore Gemini playground settings', error);
    }
  }, []);

  useEffect(() => {
    if (!canUseLocalStorage()) {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEYS.textModel, textModel.trim() || DEFAULT_TEXT_MODEL);
      window.localStorage.setItem(STORAGE_KEYS.imageModel, imageModel.trim() || DEFAULT_IMAGE_MODEL);
    } catch (error) {
      console.warn('Unable to persist Gemini playground settings', error);
    }
  }, [textModel, imageModel]);

  const handleSubmit = useCallback(async () => {
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt.length === 0) {
      setResult({ status: 'error', message: 'Enter a prompt to continue.' });
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setResult({ status: 'loading' });

    try {
      if (mode === 'image') {
        const response = await generateImageTask({
          prompt: trimmedPrompt,
          provider: 'gemini',
          model: imageModel.trim() || DEFAULT_IMAGE_MODEL
        });
        if (requestIdRef.current === requestId) {
          setResult({
            status: 'ready',
            model: response.model,
            text: response.prompt,
            imageDataUri: response.dataUri
          });
        }
        return;
      }

      const response = await askQuestionTask({
        prompt: trimmedPrompt,
        provider: 'gemini',
        model: textModel.trim() || DEFAULT_TEXT_MODEL
      });
      if (requestIdRef.current === requestId) {
        setResult({
          status: 'ready',
          model: response.model,
          text: response.text
        });
      }
    } catch (error) {
      if (requestIdRef.current === requestId) {
        setResult({
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to reach the proxy task API.'
        });
      }
    }
  }, [imageModel, mode, prompt, textModel]);

  const canSubmit = prompt.trim().length > 0 && result.status !== 'loading';
  const submitLabel = mode === 'image' ? 'Generate Image' : 'Generate Text';

  return (
    <div className="gemini-playground">
      <div className="gemini-header">
        <div className="gemini-title">
          <p className="gemini-kicker">Proxy Gemini Sandbox</p>
          <h2>Send Gemini tasks through the backend</h2>
          <p className="gemini-subtitle">
            This sandbox now uses the backend task API only. No browser-side Gemini requests or local API keys are used here.
          </p>
        </div>
        <div className="gemini-mode-toggle" role="group" aria-label="Gemini mode">
          <button type="button" className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')} disabled={result.status === 'loading'}>
            Text
          </button>
          <button type="button" className={mode === 'image' ? 'active' : ''} onClick={() => setMode('image')} disabled={result.status === 'loading'}>
            Image
          </button>
        </div>
      </div>

      <div className="gemini-grid">
        <div className="gemini-card">
          <div className="gemini-models">
            <div className="gemini-field">
              <label htmlFor="gemini-text-model">Text model</label>
              <input
                id="gemini-text-model"
                type="text"
                value={textModel}
                onChange={(event) => setTextModel(event.target.value)}
                placeholder={DEFAULT_TEXT_MODEL}
                disabled={mode === 'image'}
              />
            </div>
            <div className="gemini-field">
              <label htmlFor="gemini-image-model">Image model</label>
              <input
                id="gemini-image-model"
                type="text"
                value={imageModel}
                onChange={(event) => setImageModel(event.target.value)}
                placeholder={DEFAULT_IMAGE_MODEL}
                disabled={mode === 'text'}
              />
            </div>
          </div>

          <div className="gemini-field">
            <label htmlFor="gemini-prompt">Prompt</label>
            <textarea
              id="gemini-prompt"
              rows={6}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={
                mode === 'image'
                  ? 'Describe the image you want the backend to generate with Gemini.'
                  : 'Ask a question or request a summary.'
              }
            />
          </div>

          <div className="gemini-actions">
            <button type="button" onClick={handleSubmit} disabled={!canSubmit}>
              {result.status === 'loading' ? 'Sending…' : submitLabel}
            </button>
            <div className="gemini-footnote">Provider is fixed to Gemini; requests are routed through `/api/tasks`.</div>
          </div>
        </div>

        <div className="gemini-card gemini-response">
          {result.status === 'idle' && <div className="gemini-placeholder">Enter a prompt and click "{submitLabel}" to inspect the backend result here.</div>}
          {result.status === 'loading' && <div className="gemini-placeholder">Calling proxy task API…</div>}
          {result.status === 'error' && <div className="gemini-error">{result.message}</div>}
          {result.status === 'ready' && (
            <div className="gemini-output">
              <div className="gemini-output-meta">
                <span className="gemini-chip">Model: {result.model}</span>
                {result.text && <span className="gemini-chip">{mode === 'image' ? 'Image prompt/result' : 'Text response'}</span>}
              </div>
              {result.imageDataUri ? (
                <div className="gemini-images">
                  <img src={result.imageDataUri} alt="Generated" />
                </div>
              ) : null}
              {result.text ? <div className="gemini-text"><pre>{result.text}</pre></div> : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
