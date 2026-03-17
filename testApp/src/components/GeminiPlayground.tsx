import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeminiGeneratedImage } from 'pdf-layout-parser';
import { canUseLocalStorage } from '../utils/storage';
import { createTransportedGeminiApi, hasRuntimeProviderAccess } from '../utils/llmClients';

type GeminiMode = 'text' | 'image';

type GeminiResultState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; model: string; text?: string; images: GeminiGeneratedImage[] };

const DEFAULT_TEXT_MODEL = 'gemini-3-pro-preview';
const DEFAULT_IMAGE_MODEL = 'gemini-3-pro-image-preview';

const STORAGE_KEYS = {
  apiKey: 'gemini-api-key',
  textModel: 'gemini-text-model',
  imageModel: 'gemini-image-model'
} as const;

export function GeminiPlayground(): JSX.Element {
  const [apiKey, setApiKey] = useState('');
  const [prompt, setPrompt] = useState(
    'Summarize what the PDF Layout Parser project does in two short sentences.'
  );
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
      const storedApiKey = window.localStorage.getItem(STORAGE_KEYS.apiKey);
      const storedTextModel = window.localStorage.getItem(STORAGE_KEYS.textModel);
      const storedImageModel = window.localStorage.getItem(STORAGE_KEYS.imageModel);
      if (storedApiKey) {
        setApiKey(storedApiKey);
      }
      if (storedTextModel) {
        setTextModel(storedTextModel);
      }
      if (storedImageModel) {
        setImageModel(storedImageModel);
      }
    } catch (error) {
      console.warn('Unable to restore Gemini credentials from storage', error);
    }
  }, []);

  useEffect(() => {
    if (!canUseLocalStorage()) {
      return;
    }
    try {
      if (apiKey.trim().length > 0) {
        window.localStorage.setItem(STORAGE_KEYS.apiKey, apiKey.trim());
      }
    } catch (error) {
      console.warn('Unable to persist Gemini API key', error);
    }
  }, [apiKey]);

  useEffect(() => {
    if (!canUseLocalStorage()) {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEYS.textModel, textModel.trim() || DEFAULT_TEXT_MODEL);
      window.localStorage.setItem(STORAGE_KEYS.imageModel, imageModel.trim() || DEFAULT_IMAGE_MODEL);
    } catch (error) {
      console.warn('Unable to persist Gemini models', error);
    }
  }, [textModel, imageModel]);

  const handleSubmit = useCallback(async () => {
    const key = apiKey.trim();
    const trimmedPrompt = prompt.trim();

    if (!hasRuntimeProviderAccess('gemini', key)) {
      setResult({ status: 'error', message: 'Provide a Gemini API key to continue.' });
      return;
    }
    if (trimmedPrompt.length === 0) {
      setResult({ status: 'error', message: 'Enter a prompt to send to Gemini.' });
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setResult({ status: 'loading' });

    try {
      const client = createTransportedGeminiApi({
        apiKey: key,
        model: textModel.trim() || undefined,
        imageModel: imageModel.trim() || undefined
      });

      if (mode === 'image') {
        const response = await client.generateImage(trimmedPrompt, {
          model: imageModel.trim() || undefined
        });
        if (requestIdRef.current === requestId) {
          setResult({
            status: 'ready',
            text: response.text,
            images: response.images,
            model: response.model
          });
        }
      } else {
        const response = await client.generateText(trimmedPrompt, {
          model: textModel.trim() || undefined
        });
        if (requestIdRef.current === requestId) {
          setResult({
            status: 'ready',
            text: response.text,
            images: [],
            model: response.model
          });
        }
      }
    } catch (error) {
      if (requestIdRef.current === requestId) {
        setResult({
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to reach Gemini.'
        });
      }
    }
  }, [apiKey, prompt, mode, textModel, imageModel]);

  const canSubmit = hasRuntimeProviderAccess('gemini', apiKey) && prompt.trim().length > 0 && result.status !== 'loading';
  const submitLabel = mode === 'image' ? 'Generate Image' : 'Generate Text';

  return (
    <div className="gemini-playground">
      <div className="gemini-header">
        <div className="gemini-title">
          <p className="gemini-kicker">Gemini API Sandbox</p>
          <h2>Send prompts to Gemini</h2>
          <p className="gemini-subtitle">
            Choose text or image mode and see raw responses from the shared Gemini helper with the current direct/proxy transport.
          </p>
        </div>
        <div className="gemini-mode-toggle" role="group" aria-label="Gemini mode">
          <button
            type="button"
            className={mode === 'text' ? 'active' : ''}
            onClick={() => setMode('text')}
            disabled={result.status === 'loading'}
          >
            Text
          </button>
          <button
            type="button"
            className={mode === 'image' ? 'active' : ''}
            onClick={() => setMode('image')}
            disabled={result.status === 'loading'}
          >
            Image
          </button>
        </div>
      </div>

      <div className="gemini-grid">
        <div className="gemini-card">
          <div className="gemini-field">
            <label htmlFor="gemini-api-key">Gemini API key</label>
            <input
              id="gemini-api-key"
              type="password"
              autoComplete="off"
              placeholder="Paste your API key"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <p className="gemini-help">Stored locally in this browser for quick iteration.</p>
          </div>

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
                  ? 'Describe the image you want Gemini to render.'
                  : 'Ask Gemini to summarize, answer a question, or rewrite text.'
              }
            />
            <p className="gemini-help">
              {mode === 'image'
                ? 'Example: Create a picture of a nano banana dish in a fancy restaurant with a Gemini theme.'
                : 'Example: Summarize the latest PDF you uploaded in three bullet points.'}
            </p>
          </div>

          <div className="gemini-actions">
            <button type="button" onClick={handleSubmit} disabled={!canSubmit}>
              {result.status === 'loading' ? 'Sending…' : submitLabel}
            </button>
            <div className="gemini-footnote">
              Requests run through the shared Gemini helper exported by the library.
            </div>
          </div>
        </div>

        <div className="gemini-card gemini-response">
          {result.status === 'idle' && (
            <div className="gemini-placeholder">
              Enter a prompt and click "{submitLabel}" to see Gemini responses here.
            </div>
          )}
          {result.status === 'loading' && <div className="gemini-placeholder">Contacting Gemini…</div>}
          {result.status === 'error' && <div className="gemini-error">{result.message}</div>}
          {result.status === 'ready' && (
            <div className="gemini-output">
              <div className="gemini-output-meta">
                <span className="gemini-chip">Model: {result.model}</span>
                {result.text && <span className="gemini-chip">{mode === 'image' ? 'Image + Text' : 'Text response'}</span>}
                {result.images.length > 0 && <span className="gemini-chip">{`${result.images.length} image${result.images.length === 1 ? '' : 's'}`}</span>}
              </div>

              {result.text && (
                <div className="gemini-text">
                  <h4>Text</h4>
                  <p>{result.text}</p>
                </div>
              )}

              {result.images.length > 0 && (
                <div className="gemini-images">
                  {result.images.map((image, index) => {
                    const mimeType = image.mimeType ?? 'image/png';
                    const dataUri = `data:${mimeType};base64,${image.data}`;
                    return (
                      <div key={index} className="gemini-image">
                        <img src={dataUri} alt={`Gemini render ${index + 1}`} />
                        <div className="gemini-image-meta">
                          <span>{mimeType}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
