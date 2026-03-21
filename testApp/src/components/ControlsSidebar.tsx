import { useEffect, useState } from 'react';
import type { RelevanceServiceConfig, StructuredExtractProvider } from 'pdf-layout-parser';
import type { LoadState, ViewMode, FocusProvider, FocusRenderState, FocusRecording } from '../types';
import type { ExtractState, GeminiExtractionState } from '../hooks';
import { TabBar } from './TabBar';
import {
  loadStructuredExtractStoredSettings,
  setStructuredExtractModel,
  setStructuredExtractProvider
} from '../utils/structuredExtractSettings';
import {
  loadSemanticSearchStoredSettings,
  setSemanticSearchModel,
  setSemanticSearchProvider,
  type SemanticSearchProvider
} from '../utils/semanticSearchSettings';
import {
  loadRewriteProfileSettings,
  saveRewriteProfileSettings,
  type ReaderKnowledgeLevel
} from '../utils/rewriteProfileSettings';
import {
  loadRewriteProviderStoredSettings,
  setRewriteModel,
  setRewriteProvider,
  type RewriteProvider
} from '../utils/rewriteProviderSettings';
import {
  loadLlmTransportStoredSettings,
  setLlmProxyAuthToken,
  setLlmProxyBaseUrl
} from '../utils/llmTransportSettings';
import { getProviderDisplayName, isOpenAiCompatibleAppProvider } from '../utils/providerMetadata';
import { resetLocalAppData } from '../utils/resetLocalAppData';
import type { AiDetectionSupport } from '../utils/aiDetectionSupport';
import { DEFAULT_SEMANTIC_SEARCH_PROVIDER, DEFAULT_TEXT_PROVIDER } from '../utils/providerDefaults';

interface ControlsSidebarProps {
  state: LoadState;
  pageInfo: string;
  includeImageData: boolean;
  setIncludeImageData: (value: boolean) => void;
  focusQuery: string;
  setFocusQuery: (value: string) => void;
  focusProvider: FocusProvider;
  onFocusProviderChange: (provider: FocusProvider) => void;
  onRunFocus: () => void;
  focusState: FocusRenderState;
  openAiConfig: RelevanceServiceConfig;
  setOpenAiConfig: (config: RelevanceServiceConfig) => void;
  recordFocusExchanges: boolean;
  setRecordFocusExchanges: (value: boolean) => void;
  useRecordingPlayback: boolean;
  setUseRecordingPlayback: (value: boolean) => void;
  focusRecordings: FocusRecording[];
  selectedRecordingId: string | null;
  setSelectedRecordingId: (id: string | null) => void;
  recordingPlaybackDisabled: boolean;
  formatRecordingLabel: (recording: FocusRecording) => string;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  showFocusView: (mode: 'focus-render' | 'focus-pdf') => void;
  extractState: ExtractState;
  geminiExtractionState: GeminiExtractionState;
  aiDetectionSupport: AiDetectionSupport;
  aiDetectionModeDescription: string;
  enableFormulaHighlight: boolean;
  setEnableFormulaHighlight: (value: boolean) => void;
  enableTableHighlight: boolean;
  setEnableTableHighlight: (value: boolean) => void;
  enableWebSearch: boolean;
  setEnableWebSearch: (value: boolean) => void;
  isProxyRouteManaged: boolean;
  proxySessionUsername: string | null;
  onProxyLogout: () => Promise<void>;
}

export function ControlsSidebar({
  state,
  pageInfo,
  includeImageData,
  setIncludeImageData,
  focusQuery,
  setFocusQuery,
  focusProvider,
  onFocusProviderChange,
  onRunFocus,
  focusState,
  openAiConfig,
  setOpenAiConfig,
  recordFocusExchanges,
  setRecordFocusExchanges,
  useRecordingPlayback,
  setUseRecordingPlayback,
  focusRecordings,
  selectedRecordingId,
  setSelectedRecordingId,
  recordingPlaybackDisabled,
  formatRecordingLabel,
  viewMode,
  setViewMode,
  showFocusView,
  extractState,
  geminiExtractionState,
  aiDetectionSupport,
  aiDetectionModeDescription,
  enableFormulaHighlight,
  setEnableFormulaHighlight,
  enableTableHighlight,
  setEnableTableHighlight,
  enableWebSearch,
  setEnableWebSearch,
  isProxyRouteManaged,
  proxySessionUsername,
  onProxyLogout
}: ControlsSidebarProps): JSX.Element {
  const [extractProvider, setExtractProviderState] = useState<StructuredExtractProvider>(DEFAULT_TEXT_PROVIDER);
  const [extractGeminiModel, setExtractGeminiModel] = useState('');
  const [extractOpenAiModel, setExtractOpenAiModel] = useState('');
  const [extractCodexModel, setExtractCodexModel] = useState('');
  const [semanticSearchProvider, setSemanticSearchProviderState] = useState<SemanticSearchProvider>(DEFAULT_SEMANTIC_SEARCH_PROVIDER);
  const [semanticSearchGeminiModel, setSemanticSearchGeminiModel] = useState('');
  const [semanticSearchOpenAiModel, setSemanticSearchOpenAiModel] = useState('');
  const [rewriteMathLevel, setRewriteMathLevel] = useState<ReaderKnowledgeLevel>('intermediate');
  const [rewriteScienceLevel, setRewriteScienceLevel] = useState<ReaderKnowledgeLevel>('intermediate');
  const [rewriteOtherKnowledge, setRewriteOtherKnowledge] = useState('');
  const [rewritePreference, setRewritePreference] = useState('');
  const [rewriteMemoryNotes, setRewriteMemoryNotes] = useState('');
  const [rewriteProvider, setRewriteProviderState] = useState<RewriteProvider>(DEFAULT_TEXT_PROVIDER);
  const [rewriteGeminiModel, setRewriteGeminiModel] = useState('');
  const [rewriteOpenAiModel, setRewriteOpenAiModel] = useState('');
  const [rewriteCodexModel, setRewriteCodexModel] = useState('');
  const [proxyBaseUrl, setProxyBaseUrlState] = useState('');
  const [proxyAuthToken, setProxyAuthTokenState] = useState('');
  const [isResettingLocalData, setIsResettingLocalData] = useState(false);
  const [resetLocalDataError, setResetLocalDataError] = useState<string | null>(null);

  useEffect(() => {
    const transportSettings = loadLlmTransportStoredSettings();
    setProxyBaseUrlState(transportSettings.proxyBaseUrl);
    setProxyAuthTokenState(transportSettings.proxyAuthToken);

    const settings = loadStructuredExtractStoredSettings();
    setExtractProviderState(settings.provider);
    setExtractGeminiModel(settings.geminiModel);
    setExtractOpenAiModel(settings.openaiModel);
    setExtractCodexModel(settings.codexModel);

    const semanticSearchSettings = loadSemanticSearchStoredSettings();
    setSemanticSearchProviderState(semanticSearchSettings.provider);
    setSemanticSearchGeminiModel(semanticSearchSettings.geminiModel);
    setSemanticSearchOpenAiModel(semanticSearchSettings.openaiModel);

    const rewriteProfile = loadRewriteProfileSettings();
    setRewriteMathLevel(rewriteProfile.mathLevel);
    setRewriteScienceLevel(rewriteProfile.scienceLevel);
    setRewriteOtherKnowledge(rewriteProfile.otherKnowledge);
    setRewritePreference(rewriteProfile.rewritePreference);
    setRewriteMemoryNotes(rewriteProfile.memoryNotes);

    const rewriteProviderSettings = loadRewriteProviderStoredSettings();
    setRewriteProviderState(rewriteProviderSettings.provider);
    setRewriteGeminiModel(rewriteProviderSettings.geminiModel);
    setRewriteOpenAiModel(rewriteProviderSettings.openaiModel);
    setRewriteCodexModel(rewriteProviderSettings.codexModel);
  }, []);

  const currentExtractModel = extractProvider === 'openai'
    ? extractOpenAiModel
    : extractProvider === 'codex'
      ? extractCodexModel
      : extractGeminiModel;
  const currentSemanticSearchModel = semanticSearchProvider === 'openai'
    ? semanticSearchOpenAiModel
    : semanticSearchGeminiModel;
  const currentRewriteModel = rewriteProvider === 'openai'
    ? rewriteOpenAiModel
    : rewriteProvider === 'codex'
      ? rewriteCodexModel
      : rewriteGeminiModel;
  const isAiDetectionRunning = extractState.status === 'loading' || geminiExtractionState.status === 'loading';
  const isAiDetectionReady = extractState.status === 'ready' && geminiExtractionState.status === 'ready';
  const canRunFocusWithCurrentTransport = useRecordingPlayback || isOpenAiCompatibleAppProvider(focusProvider);

  const handleExtractProviderChange = (provider: StructuredExtractProvider) => {
    setExtractProviderState(provider);
    setStructuredExtractProvider(provider);
  };

  const handleExtractModelChange = (value: string) => {
    if (extractProvider === 'openai') {
      setExtractOpenAiModel(value);
    } else if (extractProvider === 'codex') {
      setExtractCodexModel(value);
    } else {
      setExtractGeminiModel(value);
    }
    setStructuredExtractModel(extractProvider, value);
  };

  const handleSemanticSearchProviderChange = (provider: SemanticSearchProvider) => {
    setSemanticSearchProviderState(provider);
    setSemanticSearchProvider(provider);
  };

  const handleSemanticSearchModelChange = (value: string) => {
    if (semanticSearchProvider === 'openai') {
      setSemanticSearchOpenAiModel(value);
    } else {
      setSemanticSearchGeminiModel(value);
    }
    setSemanticSearchModel(semanticSearchProvider, value);
  };

  const persistRewriteProfile = (next: {
    mathLevel?: ReaderKnowledgeLevel;
    scienceLevel?: ReaderKnowledgeLevel;
    otherKnowledge?: string;
    rewritePreference?: string;
    memoryNotes?: string;
  }) => {
    saveRewriteProfileSettings({
      mathLevel: next.mathLevel ?? rewriteMathLevel,
      scienceLevel: next.scienceLevel ?? rewriteScienceLevel,
      otherKnowledge: next.otherKnowledge ?? rewriteOtherKnowledge,
      rewritePreference: next.rewritePreference ?? rewritePreference,
      memoryNotes: next.memoryNotes ?? rewriteMemoryNotes
    });
  };

  const handleRewriteProviderChange = (provider: RewriteProvider) => {
    setRewriteProviderState(provider);
    setRewriteProvider(provider);
  };

  const handleRewriteModelChange = (value: string) => {
    if (rewriteProvider === 'openai') {
      setRewriteOpenAiModel(value);
    } else if (rewriteProvider === 'codex') {
      setRewriteCodexModel(value);
    } else {
      setRewriteGeminiModel(value);
    }
    setRewriteModel(rewriteProvider, value);
  };

  const handleResetLocalData = async () => {
    if (isResettingLocalData) {
      return;
    }
    const confirmed = window.confirm(
      'Clear all local app data (cached PDFs, extracted data, annotations, search caches, and saved settings) and reload?'
    );
    if (!confirmed) {
      return;
    }

    setResetLocalDataError(null);
    setIsResettingLocalData(true);
    try {
      const result = await resetLocalAppData();
      if (result.failedIndexedDbNames.length > 0) {
        const failedNames = result.failedIndexedDbNames.map((item) => item.name).join(', ');
        throw new Error(`Failed to clear some IndexedDB databases: ${failedNames}. Close other tabs and retry.`);
      }
      window.location.reload();
    } catch (error) {
      setResetLocalDataError(error instanceof Error ? error.message : 'Failed to reset local app data.');
      setIsResettingLocalData(false);
    }
  };

  return (
    <aside className="sidebar-column">
      <div className="sidebar-scroll">
        <TabBar
          viewMode={viewMode}
          setViewMode={setViewMode}
          showFocusView={showFocusView}
          isDocumentReady={state.status === 'ready'}
          focusState={focusState}
          focusRecordings={focusRecordings}
        />
        <section className="controls">

        <div className="control-groups">
          <span className="document-meta">{pageInfo}</span>
        </div>

        <div className="control-groups">
          <label className="checkbox-option">
            <input
              type="checkbox"
              checked={includeImageData}
              onChange={(event) => setIncludeImageData(event.target.checked)}
              disabled={state.status !== 'ready'}
            />
            <span>Include image data in JSON</span>
          </label>
          <div className="focus-controls">
            <input
              type="text"
              value={focusQuery}
              placeholder="Focus query (e.g., revenue guidance)"
              onChange={(event) => setFocusQuery(event.target.value)}
              disabled={state.status !== 'ready'}
            />
            <select
              value={focusProvider}
              onChange={(event) => onFocusProviderChange(event.target.value as FocusProvider)}
              disabled={state.status !== 'ready'}
            >
              <option value="mock">Mock relevance</option>
              <option value="openai">OpenAI</option>
              <option value="codex">Codex</option>
            </select>
            <button
              type="button"
              onClick={onRunFocus}
              disabled={
                state.status !== 'ready' ||
                focusQuery.trim().length === 0 ||
                (isOpenAiCompatibleAppProvider(focusProvider) && !canRunFocusWithCurrentTransport)
              }
            >
              Highlight Relevant
            </button>
          </div>

          {isOpenAiCompatibleAppProvider(focusProvider) && (
            <div className="openai-config">
              <input
                type="password"
                value=""
                placeholder={`Backend-managed ${getProviderDisplayName(focusProvider)} access`}
                disabled
                readOnly
              />
              <input
                type="text"
                value={openAiConfig.model ?? ''}
                placeholder={focusProvider === 'codex' ? 'Model (e.g., gpt-5-codex)' : 'Model (e.g., gpt-5.2)'}
                onChange={(event) => setOpenAiConfig({ ...openAiConfig, model: event.target.value.trim() })}
              />
              <span className="structured-extract-settings-note">
                Focus requests run through the backend task API. Only the model selection here affects the request.
              </span>
            </div>
          )}

          {focusState.status === 'error' && <span className="focus-error">{focusState.message}</span>}
          {focusState.status === 'loading' && <span className="focus-loading">Analyzing…</span>}
        </div>

        <div className="gemini-extraction-controls">
          <div className="structured-extract-settings">
            <div className="structured-extract-settings-title">Proxy Backend</div>
            <select
              value="proxy"
              disabled
            >
              <option value="proxy">Proxy server</option>
            </select>
            <input
              type="text"
              value={proxyBaseUrl}
              placeholder={isProxyRouteManaged ? '/proxy/api/tasks' : '/api/tasks'}
              disabled={isProxyRouteManaged}
              onChange={(event) => {
                const value = event.target.value;
                setProxyBaseUrlState(value);
                setLlmProxyBaseUrl(value);
              }}
            />
            {!isProxyRouteManaged && (
              <input
                type="password"
                value={proxyAuthToken}
                placeholder="Optional proxy auth token"
                onChange={(event) => {
                  const value = event.target.value;
                  setProxyAuthTokenState(value);
                  setLlmProxyAuthToken(value);
                }}
              />
            )}
            {isProxyRouteManaged && proxySessionUsername && (
              <div className="structured-extract-settings-note">
                Signed in as <strong>{proxySessionUsername}</strong>.
                {' '}
                <button type="button" className="inline-link-button" onClick={() => void onProxyLogout()}>
                  Sign out
                </button>
              </div>
            )}
            <span className="structured-extract-settings-note">
              {isProxyRouteManaged
                ? 'This /proxy route is locked to the server proxy and uses a cookie-backed login session.'
                : 'The browser now talks only to the backend proxy/task API. Provider keys stay on the server.'}
            </span>
          </div>
          <div className="structured-extract-settings">
            <div className="structured-extract-settings-title">Rewrite Profile</div>
            <select
              value={rewriteProvider}
              onChange={(event) => handleRewriteProviderChange(event.target.value as RewriteProvider)}
            >
              <option value="gemini">Rewrite with Gemini</option>
              <option value="openai">Rewrite with OpenAI</option>
              <option value="codex">Rewrite with Codex</option>
            </select>
            <input
              type="password"
              value=""
              placeholder="Backend-managed provider access"
              disabled
              readOnly
            />
            <input
              type="text"
              value={currentRewriteModel}
              placeholder={
                rewriteProvider === 'openai'
                  ? 'Model (e.g., gpt-5.2)'
                  : rewriteProvider === 'codex'
                    ? 'Model (e.g., gpt-5-codex)'
                    : 'Model (e.g., gemini-3-pro-preview)'
              }
              onChange={(event) => handleRewriteModelChange(event.target.value)}
            />
            <select
              value={rewriteMathLevel}
              onChange={(event) => {
                const value = event.target.value as ReaderKnowledgeLevel;
                setRewriteMathLevel(value);
                persistRewriteProfile({ mathLevel: value });
              }}
            >
              <option value="beginner">Math: Beginner</option>
              <option value="intermediate">Math: Intermediate</option>
              <option value="advanced">Math: Advanced</option>
              <option value="expert">Math: Expert</option>
            </select>
            <select
              value={rewriteScienceLevel}
              onChange={(event) => {
                const value = event.target.value as ReaderKnowledgeLevel;
                setRewriteScienceLevel(value);
                persistRewriteProfile({ scienceLevel: value });
              }}
            >
              <option value="beginner">Science: Beginner</option>
              <option value="intermediate">Science: Intermediate</option>
              <option value="advanced">Science: Advanced</option>
              <option value="expert">Science: Expert</option>
            </select>
            <textarea
              value={rewriteOtherKnowledge}
              placeholder="Other background knowledge (domain, programming, finance, etc.)"
              rows={2}
              onChange={(event) => {
                const value = event.target.value;
                setRewriteOtherKnowledge(value);
                persistRewriteProfile({ otherKnowledge: value });
              }}
            />
            <textarea
              value={rewritePreference}
              placeholder="Rewrite preference (e.g., simpler wording, more intuition, shorter sentences)"
              rows={2}
              onChange={(event) => {
                const value = event.target.value;
                setRewritePreference(value);
                persistRewriteProfile({ rewritePreference: value });
              }}
            />
            <textarea
              value={rewriteMemoryNotes}
              placeholder="Memory notes for future rewrites (manual for now; can be replaced by conversation memory later)"
              rows={2}
              onChange={(event) => {
                const value = event.target.value;
                setRewriteMemoryNotes(value);
                persistRewriteProfile({ memoryNotes: value });
              }}
            />
            <span className="structured-extract-settings-note">
              Used by the highlight rewrite action. Memory notes are a manual placeholder until conversation memory is added.
            </span>
          </div>
          <div className="structured-extract-settings">
            <div className="structured-extract-settings-title">Semantic Search Provider</div>
            <select
              value={semanticSearchProvider}
              onChange={(event) => handleSemanticSearchProviderChange(event.target.value as SemanticSearchProvider)}
            >
              <option value="gemini">Gemini</option>
              <option value="openai">OpenAI</option>
            </select>
            <input
              type="password"
              value=""
              placeholder="Backend-managed provider access"
              disabled
              readOnly
            />
            <input
              type="text"
              value={currentSemanticSearchModel}
              placeholder={
                semanticSearchProvider === 'openai'
                  ? 'Embedding model (e.g., text-embedding-3-small)'
                  : 'Embedding model (e.g., gemini-embedding-001)'
              }
              onChange={(event) => handleSemanticSearchModelChange(event.target.value)}
            />
            <span className="structured-extract-settings-note">
              Used for semantic indexing/search embeddings. Re-index the PDF after changing provider or model.
            </span>
          </div>
          <div className="structured-extract-settings">
            <div className="structured-extract-settings-title">Structured Extract Provider</div>
            <select
              value={extractProvider}
              onChange={(event) => handleExtractProviderChange(event.target.value as StructuredExtractProvider)}
            >
              <option value="gemini">Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="codex">Codex</option>
            </select>
            <input
              type="password"
              value=""
              placeholder="Backend-managed provider access"
              disabled
              readOnly
            />
            <input
              type="text"
              value={currentExtractModel}
              placeholder={
                extractProvider === 'openai'
                  ? 'Model (e.g., gpt-5.2)'
                  : extractProvider === 'codex'
                    ? 'Model (e.g., gpt-5-codex)'
                    : 'Model (e.g., gemini-3-pro-image-preview)'
              }
              onChange={(event) => handleExtractModelChange(event.target.value)}
            />
            <span className="structured-extract-settings-note">
              Used for PDF table/image structured extraction and LLM-based logical unit grouping. Codex runs only through the proxy. Cache is per file checksum and provider/model.
            </span>
          </div>
          <span className="structured-extract-settings-note">{aiDetectionModeDescription}</span>
          {!aiDetectionSupport.supported && (
            <span className="focus-error">{aiDetectionSupport.message}</span>
          )}
          {extractState.status === 'ready' && geminiExtractionState.status === 'ready' && (
            <span className="extraction-status">✓ AI extraction ready</span>
          )}
          {state.status === 'ready' && aiDetectionSupport.supported && !isAiDetectionRunning && !isAiDetectionReady && (
            <span className="structured-extract-settings-note">
              Use the semantic search bar to run AI detection manually.
            </span>
          )}
          {extractState.status === 'error' && (
            <span className="focus-error">{extractState.message}</span>
          )}
          {geminiExtractionState.status === 'error' && geminiExtractionState.error !== extractState.message && (
            <span className="focus-error">{geminiExtractionState.error}</span>
          )}
          <label className="checkbox-option">
            <input
              type="checkbox"
              checked={enableFormulaHighlight}
              onChange={(event) => setEnableFormulaHighlight(event.target.checked)}
              disabled={geminiExtractionState.status !== 'ready'}
            />
            <span>Show formula highlights</span>
          </label>
          <label className="checkbox-option">
            <input
              type="checkbox"
              checked={enableTableHighlight}
              onChange={(event) => setEnableTableHighlight(event.target.checked)}
              disabled={geminiExtractionState.status !== 'ready'}
            />
            <span>Show table highlights</span>
          </label>
          <label className="checkbox-option">
            <input
              type="checkbox"
              checked={enableWebSearch}
              onChange={(event) => setEnableWebSearch(event.target.checked)}
            />
            <span>Enable web search in chat</span>
          </label>
        </div>

        <div className="focus-recording-controls">
        <label className="checkbox-option">
          <input
            type="checkbox"
            checked={recordFocusExchanges}
            onChange={(event) => setRecordFocusExchanges(event.target.checked)}
            disabled={!isOpenAiCompatibleAppProvider(focusProvider)}
          />
          <span>Capture focus exchanges</span>
        </label>
          <label className="checkbox-option">
            <input
              type="checkbox"
              checked={useRecordingPlayback}
              onChange={(event) => setUseRecordingPlayback(event.target.checked)}
              disabled={recordingPlaybackDisabled}
            />
            <span>Replay selected recording</span>
          </label>
          <select
            value={selectedRecordingId ?? ''}
            onChange={(event) => setSelectedRecordingId(event.target.value === '' ? null : event.target.value)}
            disabled={focusRecordings.length === 0}
          >
            <option value="">
              {focusRecordings.length === 0 ? 'No recordings available' : 'Select a recording'}
            </option>
            {focusRecordings.map((recording) => (
              <option key={recording.id} value={recording.id}>
                {formatRecordingLabel(recording)}
              </option>
            ))}
          </select>
        </div>

        <div className="local-reset-controls">
          <div className="structured-extract-settings-title">Local Data</div>
          <button
            type="button"
            className="local-reset-button"
            onClick={handleResetLocalData}
            disabled={isResettingLocalData}
          >
            {isResettingLocalData ? 'Clearing local data…' : 'Clear local cache / DB and reload'}
          </button>
          <span className="structured-extract-settings-note">
            Clears this app&apos;s IndexedDB caches and localStorage settings, then reloads.
          </span>
          {resetLocalDataError && <span className="focus-error">{resetLocalDataError}</span>}
        </div>
      </section>
      </div>
    </aside>
  );
}
