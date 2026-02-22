import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { StructuredExtractAPI } from 'pdf-layout-parser';
import { canUseLocalStorage } from '../utils/storage';

type ExtractResultState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      document: any;
      fileName: string;
      elementCount: number;
      pageCount: number;
      tableAssets: Record<string, ArrayBuffer>;
      parsedTables: { name: string; rows: string[][] }[];
    };

const STORAGE_KEYS = {
  apiKey: 'gemini-overlay-api-key',
  model: 'structured-extract-gemini-model'
} as const;

const DEFAULT_MODEL = 'gemini-3-pro-preview';

export function StructuredExtractPlayground(): JSX.Element {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ExtractResultState>({ status: 'idle' });
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!canUseLocalStorage()) {
      return;
    }
    try {
      const storedApiKey = window.localStorage.getItem(STORAGE_KEYS.apiKey);
      const storedModel = window.localStorage.getItem(STORAGE_KEYS.model);
      if (storedApiKey) {
        setApiKey(storedApiKey);
      }
      if (storedModel) {
        setModel(storedModel);
      }
    } catch (error) {
      console.warn('Unable to restore Gemini extract settings from storage', error);
    }
  }, []);

  useEffect(() => {
    if (!canUseLocalStorage()) {
      return;
    }
    try {
      if (apiKey.trim()) {
        window.localStorage.setItem(STORAGE_KEYS.apiKey, apiKey.trim());
      }
      window.localStorage.setItem(STORAGE_KEYS.model, model.trim() || DEFAULT_MODEL);
    } catch (error) {
      console.warn('Unable to persist Gemini extract settings', error);
    }
  }, [apiKey, model]);

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
  }, []);

  const canSubmit = !!file && result.status !== 'loading' && apiKey.trim().length > 0;

  const handleExtract = useCallback(async () => {
    if (!file) {
      setResult({ status: 'error', message: 'Choose a PDF file to upload.' });
      return;
    }
    const trimmedApiKey = apiKey.trim();
    if (!trimmedApiKey) {
      setResult({ status: 'error', message: 'Provide a Gemini API key.' });
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setResult({ status: 'loading' });

    try {
      const client = new StructuredExtractAPI({
        apiKey: trimmedApiKey,
        model: model.trim() || DEFAULT_MODEL
      });
      const response = await client.extractStructuredData(file, {
        fileName: file.name
      });

      if (requestIdRef.current === requestId) {
        setResult({
          status: 'ready',
          document: response.document,
          fileName: file.name,
          elementCount: response.document.elements?.length ?? 0,
          pageCount: response.document.pages?.length ?? 0,
          tableAssets: response.tableAssets,
          parsedTables: response.parsedTables
        });
      }
    } catch (error) {
      if (requestIdRef.current === requestId) {
        setResult({
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Gemini extraction failed. Check API key and model configuration.'
        });
      }
    }
  }, [apiKey, file, model]);

  return (
    <div className="structured-extract-playground">
      <header className="structured-extract-header">
        <div>
          <p className="structured-extract-kicker">Single Provider Extract</p>
          <h2>Upload a PDF and inspect extracted JSON</h2>
          <p className="structured-extract-subtitle">
            Uses Gemini to extract structured text, tables, and figure metadata in the same shape used by the
            structured-data viewer.
          </p>
        </div>
        {result.status === 'ready' && (
          <div className="structured-extract-summary">
            <div className="structured-extract-chip">
              <span className="structured-extract-chip-label">Pages</span>
              <span className="structured-extract-chip-value">{result.pageCount}</span>
            </div>
            <div className="structured-extract-chip">
              <span className="structured-extract-chip-label">Elements</span>
              <span className="structured-extract-chip-value">{result.elementCount}</span>
            </div>
          </div>
        )}
      </header>

      <div className="structured-extract-grid">
        <div className="structured-extract-card">
          <div className="structured-extract-field">
            <label htmlFor="structured-extract-api-key">Gemini API key</label>
            <input
              id="structured-extract-api-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Paste your API key"
            />
            <p className="structured-extract-help">Stored locally in this browser for reuse.</p>
          </div>

          <div className="structured-extract-field">
            <label htmlFor="structured-extract-model">Gemini model</label>
            <input
              id="structured-extract-model"
              type="text"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={DEFAULT_MODEL}
            />
          </div>

          <div className="structured-extract-field">
            <label htmlFor="structured-extract-file">PDF file</label>
            <input id="structured-extract-file" type="file" accept="application/pdf" onChange={handleFileChange} />
            <p className="structured-extract-help">{file ? `Selected: ${file.name}` : 'Choose a PDF to upload.'}</p>
          </div>

          <div className="structured-extract-actions">
            <button type="button" onClick={handleExtract} disabled={!canSubmit}>
              {result.status === 'loading' ? 'Extracting…' : 'Run Extract'}
            </button>
            <p className="structured-extract-footnote">Provider: Gemini only (no external extract endpoint required).</p>
          </div>
        </div>

        <div className="structured-extract-card structured-extract-response">
          {result.status === 'idle' && (
            <div className="structured-extract-placeholder">
              Enter your Gemini key, choose a PDF, and click "Run Extract" to view the JSON response here.
            </div>
          )}
          {result.status === 'loading' && <div className="structured-extract-placeholder">Calling Gemini…</div>}
          {result.status === 'error' && <div className="structured-extract-error">{result.message}</div>}
          {result.status === 'ready' && (
            <div className="structured-extract-output">
              <div className="structured-extract-output-meta">
                <div className="structured-extract-chip">
                  <span className="structured-extract-chip-label">File</span>
                  <span className="structured-extract-chip-value">{result.fileName}</span>
                </div>
              </div>

              <div className="structured-extract-json">
                <h4>Response</h4>
                <pre>{JSON.stringify(result.document, null, 2)}</pre>
                {result.tableAssets && Object.keys(result.tableAssets).length > 0 && (
                  <div className="structured-extract-footnote">
                    Received {Object.keys(result.tableAssets).length} table asset(s).
                  </div>
                )}
                {result.parsedTables && result.parsedTables.length > 0 && (
                  <div className="structured-extract-footnote">
                    Parsed {result.parsedTables.length} table(s) from Gemini table rows.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
