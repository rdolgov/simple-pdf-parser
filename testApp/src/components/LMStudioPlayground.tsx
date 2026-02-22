import { useCallback, useEffect, useRef, useState } from 'react';
import type { LMStudioEmbeddingResult } from 'pdf-layout-parser';
import { LMStudioAPI } from 'pdf-layout-parser';
import { canUseLocalStorage } from '../utils/storage';

type ResultState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; result: LMStudioEmbeddingResult };

const STORAGE_KEYS = {
  baseUrl: 'lmstudio-base-url',
  model: 'lmstudio-model',
  lastInput: 'lmstudio-input'
} as const;

const DEFAULT_BASE_URL = 'http://127.0.0.1:1234/v1';
const DEFAULT_MODEL = 'text-embedding-nomic-embed-text-v2-moe';

export function LMStudioPlayground(): JSX.Element {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [input, setInput] = useState('Some text to embed');
  const [result, setResult] = useState<ResultState>({ status: 'idle' });
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!canUseLocalStorage()) {
      return;
    }
    try {
      const storedBaseUrl = window.localStorage.getItem(STORAGE_KEYS.baseUrl);
      const storedModel = window.localStorage.getItem(STORAGE_KEYS.model);
      const storedInput = window.localStorage.getItem(STORAGE_KEYS.lastInput);
      if (storedBaseUrl) {
        setBaseUrl(storedBaseUrl);
      }
      if (storedModel) {
        setModel(storedModel);
      }
      if (storedInput) {
        setInput(storedInput);
      }
    } catch (error) {
      console.warn('Unable to restore LM Studio settings', error);
    }
  }, []);

  useEffect(() => {
    if (!canUseLocalStorage()) {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEYS.baseUrl, baseUrl.trim() || DEFAULT_BASE_URL);
      window.localStorage.setItem(STORAGE_KEYS.model, model.trim() || DEFAULT_MODEL);
      window.localStorage.setItem(STORAGE_KEYS.lastInput, input);
    } catch (error) {
      console.warn('Unable to persist LM Studio settings', error);
    }
  }, [baseUrl, model, input]);

  const handleSubmit = useCallback(async () => {
    const trimmedBase = baseUrl.trim() || DEFAULT_BASE_URL;
    const trimmedModel = model.trim() || DEFAULT_MODEL;
    const trimmedInput = input.trim();
    if (trimmedInput.length === 0) {
      setResult({ status: 'error', message: 'Enter text to embed.' });
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setResult({ status: 'loading' });

    try {
      const client = new LMStudioAPI({ baseUrl: trimmedBase, defaultModel: trimmedModel });
      const response = await client.generateEmbedding({ input: trimmedInput });
      if (requestIdRef.current === requestId) {
        setResult({ status: 'ready', result: response });
      }
    } catch (error) {
      if (requestIdRef.current === requestId) {
        setResult({
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to generate embeddings.'
        });
      }
    }
  }, [baseUrl, model, input]);

  const renderResult = () => {
    if (result.status === 'idle') {
      return <div className="gemini-placeholder">No request yet.</div>;
    }
    if (result.status === 'loading') {
      return <div className="gemini-placeholder">Requesting embeddings…</div>;
    }
    if (result.status === 'error') {
      return <div className="gemini-error">{result.message}</div>;
    }
    const { embeddings, model: usedModel, usage } = result.result;
    const first = embeddings[0];
    return (
      <div className="gemini-output">
        <div className="gemini-output-meta">
          <span className="gemini-chip">Model: {usedModel}</span>
          {usage?.prompt_tokens !== undefined && (
            <span className="gemini-chip">Prompt tokens: {usage.prompt_tokens}</span>
          )}
          <span className="gemini-chip">Vectors: {embeddings.length}</span>
          <span className="gemini-chip">Dims: {first?.length ?? 0}</span>
        </div>
        <pre className="json-view">
          {JSON.stringify(
            {
              model: usedModel,
              usage,
              embeddings: embeddings.length > 3 ? embeddings.slice(0, 3) : embeddings
            },
            null,
            2
          )}
        </pre>
      </div>
    );
  };

  return (
    <div className="gemini-playground">
      <div className="gemini-header">
        <div className="gemini-title">
          <p className="gemini-kicker">LM Studio API Sandbox</p>
          <h2>Generate embeddings locally</h2>
          <p className="gemini-subtitle">
            Point to your LM Studio server, choose a model, and embed any text. Uses the new LMStudioAPI helper.
          </p>
        </div>
      </div>

      <div className="gemini-grid">
        <div className="gemini-card">
          <div className="gemini-field">
            <label htmlFor="lmstudio-base">Base URL</label>
            <input
              id="lmstudio-base"
              type="text"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={DEFAULT_BASE_URL}
            />
          </div>

          <div className="gemini-field">
            <label htmlFor="lmstudio-model">Model</label>
            <input
              id="lmstudio-model"
              type="text"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={DEFAULT_MODEL}
            />
          </div>

          <div className="gemini-field">
            <label htmlFor="lmstudio-input">Text to embed</label>
            <textarea
              id="lmstudio-input"
              rows={4}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Paste or type any text…"
            />
          </div>

          <div className="gemini-actions">
            <button type="button" onClick={handleSubmit} disabled={result.status === 'loading'}>
              {result.status === 'loading' ? 'Embedding…' : 'Generate Embeddings'}
            </button>
          </div>
        </div>

        <div className="gemini-card">{renderResult()}</div>
      </div>
    </div>
  );
}
