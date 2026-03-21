import { useCallback, useRef, useState, type ChangeEvent } from 'react';
import { uploadPdfAndStartDetection } from '../api/proxyTaskApi';

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
      parsedTables: { name?: string; rows: string[][] }[];
      model: string | null;
    };

const DEFAULT_MODEL = 'gemini-3-pro-image-preview';

export function StructuredExtractPlayground(): JSX.Element {
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ExtractResultState>({ status: 'idle' });
  const requestIdRef = useRef(0);

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
  }, []);

  const canSubmit = Boolean(file) && result.status !== 'loading';

  const handleExtract = useCallback(async () => {
    if (!file) {
      setResult({ status: 'error', message: 'Choose a PDF file to upload.' });
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setResult({ status: 'loading' });

    try {
      const response = await uploadPdfAndStartDetection({
        file,
        provider: 'gemini',
        model: model.trim() || DEFAULT_MODEL,
        refresh: true
      });
      const payload = response.detection.result as {
        document?: any;
        parsedTables?: { name?: string; rows: string[][] }[];
        model?: string;
      } | null;
      if (!payload?.document) {
        throw new Error('Structured extraction did not return a document payload.');
      }

      if (requestIdRef.current === requestId) {
        setResult({
          status: 'ready',
          document: payload.document,
          fileName: file.name,
          elementCount: payload.document.elements?.length ?? 0,
          pageCount: payload.document.pages?.length ?? 0,
          parsedTables: payload.parsedTables ?? [],
          model: payload.model ?? null
        });
      }
    } catch (error) {
      if (requestIdRef.current === requestId) {
        setResult({
          status: 'error',
          message: error instanceof Error ? error.message : 'Structured extraction failed.'
        });
      }
    }
  }, [file, model]);

  return (
    <div className="structured-extract-playground">
      <header className="structured-extract-header">
        <div>
          <p className="structured-extract-kicker">Backend Structured Extract</p>
          <h2>Upload a PDF and inspect extracted JSON</h2>
          <p className="structured-extract-subtitle">
            Uses the proxy task API to upload the PDF once, run backend extraction, and return the normalized structured document JSON used by the app.
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
            <p className="structured-extract-footnote">Requests go through `/api/tasks/documents`; no browser-side provider clients are used.</p>
          </div>
        </div>

        <div className="structured-extract-card structured-extract-response">
          {result.status === 'idle' && <div className="structured-extract-placeholder">Choose a PDF and run extract to inspect the JSON response here.</div>}
          {result.status === 'loading' && <div className="structured-extract-placeholder">Uploading PDF and waiting for backend extraction…</div>}
          {result.status === 'error' && <div className="structured-extract-error">{result.message}</div>}
          {result.status === 'ready' && (
            <div className="structured-extract-output">
              <div className="structured-extract-output-meta">
                <div className="structured-extract-chip">
                  <span className="structured-extract-chip-label">File</span>
                  <span className="structured-extract-chip-value">{result.fileName}</span>
                </div>
                {result.model ? (
                  <div className="structured-extract-chip">
                    <span className="structured-extract-chip-label">Model</span>
                    <span className="structured-extract-chip-value">{result.model}</span>
                  </div>
                ) : null}
              </div>

              <div className="structured-extract-json">
                <h4>Response</h4>
                <pre>{JSON.stringify(result.document, null, 2)}</pre>
                {result.parsedTables.length > 0 && (
                  <div className="structured-extract-footnote">
                    Parsed {result.parsedTables.length} table(s) from the extraction response.
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
