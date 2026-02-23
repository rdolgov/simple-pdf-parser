import { useEffect, useState } from 'react';
import type { RelevanceServiceConfig, StructuredExtractProvider } from 'pdf-layout-parser';
import type { LoadState, ViewMode, FocusProvider, FocusRenderState, FocusRecording } from '../types';
import type { GeminiExtractionState } from '../hooks';
import { TabBar } from './TabBar';
import {
  loadStructuredExtractStoredSettings,
  setStructuredExtractApiKey,
  setStructuredExtractModel,
  setStructuredExtractProvider
} from '../utils/structuredExtractSettings';
import {
  loadSemanticSearchStoredSettings,
  setSemanticSearchApiKey,
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
  setRewriteApiKey,
  setRewriteModel,
  setRewriteProvider,
  type RewriteProvider
} from '../utils/rewriteProviderSettings';
import { resetLocalAppData } from '../utils/resetLocalAppData';

interface ControlsSidebarProps {
  state: LoadState;
  pageInfo: string;
  zoomIndicator: string;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
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
  canUseZoom: boolean;
  geminiExtractionState: GeminiExtractionState;
  onTriggerGeminiExtraction: () => Promise<void>;
  enableFormulaHighlight: boolean;
  setEnableFormulaHighlight: (value: boolean) => void;
  enableTableHighlight: boolean;
  setEnableTableHighlight: (value: boolean) => void;
  enableWebSearch: boolean;
  setEnableWebSearch: (value: boolean) => void;
}

export function ControlsSidebar({
  state,
  pageInfo,
  zoomIndicator,
  onZoomIn,
  onZoomOut,
  onZoomReset,
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
  canUseZoom,
  geminiExtractionState,
  onTriggerGeminiExtraction,
  enableFormulaHighlight,
  setEnableFormulaHighlight,
  enableTableHighlight,
  setEnableTableHighlight,
  enableWebSearch,
  setEnableWebSearch
}: ControlsSidebarProps): JSX.Element {
  const [extractProvider, setExtractProviderState] = useState<StructuredExtractProvider>('openai');
  const [extractGeminiApiKey, setExtractGeminiApiKey] = useState('');
  const [extractOpenAiApiKey, setExtractOpenAiApiKey] = useState('');
  const [extractGeminiModel, setExtractGeminiModel] = useState('');
  const [extractOpenAiModel, setExtractOpenAiModel] = useState('');
  const [semanticSearchProvider, setSemanticSearchProviderState] = useState<SemanticSearchProvider>('openai');
  const [semanticSearchGeminiApiKey, setSemanticSearchGeminiApiKey] = useState('');
  const [semanticSearchOpenAiApiKey, setSemanticSearchOpenAiApiKey] = useState('');
  const [semanticSearchGeminiModel, setSemanticSearchGeminiModel] = useState('');
  const [semanticSearchOpenAiModel, setSemanticSearchOpenAiModel] = useState('');
  const [rewriteMathLevel, setRewriteMathLevel] = useState<ReaderKnowledgeLevel>('intermediate');
  const [rewriteScienceLevel, setRewriteScienceLevel] = useState<ReaderKnowledgeLevel>('intermediate');
  const [rewriteOtherKnowledge, setRewriteOtherKnowledge] = useState('');
  const [rewritePreference, setRewritePreference] = useState('');
  const [rewriteMemoryNotes, setRewriteMemoryNotes] = useState('');
  const [rewriteProvider, setRewriteProviderState] = useState<RewriteProvider>('openai');
  const [rewriteGeminiApiKey, setRewriteGeminiApiKey] = useState('');
  const [rewriteOpenAiApiKey, setRewriteOpenAiApiKey] = useState('');
  const [rewriteGeminiModel, setRewriteGeminiModel] = useState('');
  const [rewriteOpenAiModel, setRewriteOpenAiModel] = useState('');
  const [isResettingLocalData, setIsResettingLocalData] = useState(false);
  const [resetLocalDataError, setResetLocalDataError] = useState<string | null>(null);

  useEffect(() => {
    const settings = loadStructuredExtractStoredSettings();
    setExtractProviderState(settings.provider);
    setExtractGeminiApiKey(settings.geminiApiKey);
    setExtractOpenAiApiKey(settings.openaiApiKey);
    setExtractGeminiModel(settings.geminiModel);
    setExtractOpenAiModel(settings.openaiModel);

    const semanticSearchSettings = loadSemanticSearchStoredSettings();
    setSemanticSearchProviderState(semanticSearchSettings.provider);
    setSemanticSearchGeminiApiKey(semanticSearchSettings.geminiApiKey);
    setSemanticSearchOpenAiApiKey(semanticSearchSettings.openaiApiKey);
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
    setRewriteGeminiApiKey(rewriteProviderSettings.geminiApiKey);
    setRewriteOpenAiApiKey(rewriteProviderSettings.openaiApiKey);
    setRewriteGeminiModel(rewriteProviderSettings.geminiModel);
    setRewriteOpenAiModel(rewriteProviderSettings.openaiModel);
  }, []);

  const currentExtractApiKey = extractProvider === 'openai' ? extractOpenAiApiKey : extractGeminiApiKey;
  const currentExtractModel = extractProvider === 'openai' ? extractOpenAiModel : extractGeminiModel;
  const currentSemanticSearchApiKey = semanticSearchProvider === 'openai'
    ? semanticSearchOpenAiApiKey
    : semanticSearchGeminiApiKey;
  const currentSemanticSearchModel = semanticSearchProvider === 'openai'
    ? semanticSearchOpenAiModel
    : semanticSearchGeminiModel;
  const currentRewriteApiKey = rewriteProvider === 'openai' ? rewriteOpenAiApiKey : rewriteGeminiApiKey;
  const currentRewriteModel = rewriteProvider === 'openai' ? rewriteOpenAiModel : rewriteGeminiModel;

  const handleExtractProviderChange = (provider: StructuredExtractProvider) => {
    setExtractProviderState(provider);
    setStructuredExtractProvider(provider);
  };

  const handleExtractApiKeyChange = (value: string) => {
    if (extractProvider === 'openai') {
      setExtractOpenAiApiKey(value);
    } else {
      setExtractGeminiApiKey(value);
    }
    setStructuredExtractApiKey(extractProvider, value);
  };

  const handleExtractModelChange = (value: string) => {
    if (extractProvider === 'openai') {
      setExtractOpenAiModel(value);
    } else {
      setExtractGeminiModel(value);
    }
    setStructuredExtractModel(extractProvider, value);
  };

  const handleSemanticSearchProviderChange = (provider: SemanticSearchProvider) => {
    setSemanticSearchProviderState(provider);
    setSemanticSearchProvider(provider);
  };

  const handleSemanticSearchApiKeyChange = (value: string) => {
    if (semanticSearchProvider === 'openai') {
      setSemanticSearchOpenAiApiKey(value);
    } else {
      setSemanticSearchGeminiApiKey(value);
    }
    setSemanticSearchApiKey(semanticSearchProvider, value);
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

  const handleRewriteApiKeyChange = (value: string) => {
    if (rewriteProvider === 'openai') {
      setRewriteOpenAiApiKey(value);
    } else {
      setRewriteGeminiApiKey(value);
    }
    setRewriteApiKey(rewriteProvider, value);
  };

  const handleRewriteModelChange = (value: string) => {
    if (rewriteProvider === 'openai') {
      setRewriteOpenAiModel(value);
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
      'Clear all local app data (cached PDFs, extracted data, annotations, search caches, and saved API keys) and reload?'
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
          <div className="zoom-controls">
            <button type="button" onClick={onZoomOut} disabled={!canUseZoom}>
              Zoom Out
            </button>
            <button type="button" onClick={onZoomReset} disabled={!canUseZoom}>
              Reset
            </button>
            <button type="button" onClick={onZoomIn} disabled={!canUseZoom}>
              Zoom In
            </button>
            <span>{zoomIndicator}</span>
          </div>
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
              <option value="openai">Gemini</option>
            </select>
            <button
              type="button"
              onClick={onRunFocus}
              disabled={
                state.status !== 'ready' ||
                focusQuery.trim().length === 0 ||
                (focusProvider === 'openai' && !useRecordingPlayback && (!openAiConfig.apiKey || openAiConfig.apiKey.length === 0))
              }
            >
              Highlight Relevant
            </button>
          </div>

          {focusProvider === 'openai' && (
            <div className="openai-config">
              <input
                type="password"
                value={openAiConfig.apiKey ?? ''}
                placeholder="OpenAI API key"
                onChange={(event) => setOpenAiConfig({ ...openAiConfig, apiKey: event.target.value.trim() })}
              />
              <input
                type="text"
                value={openAiConfig.model ?? ''}
                placeholder="Model (e.g., gpt-5.2)"
                onChange={(event) => setOpenAiConfig({ ...openAiConfig, model: event.target.value.trim() })}
              />
              {(!useRecordingPlayback && (!openAiConfig.apiKey || openAiConfig.apiKey.length === 0)) && (
                <span className="focus-warning">API key required for Gemini</span>
              )}
            </div>
          )}

          {focusState.status === 'error' && <span className="focus-error">{focusState.message}</span>}
          {focusState.status === 'loading' && <span className="focus-loading">Analyzing…</span>}
        </div>

        <div className="gemini-extraction-controls">
          <div className="structured-extract-settings">
            <div className="structured-extract-settings-title">Rewrite Profile</div>
            <select
              value={rewriteProvider}
              onChange={(event) => handleRewriteProviderChange(event.target.value as RewriteProvider)}
            >
              <option value="gemini">Rewrite with Gemini</option>
              <option value="openai">Rewrite with OpenAI</option>
            </select>
            <input
              type="password"
              value={currentRewriteApiKey}
              placeholder={rewriteProvider === 'openai' ? 'OpenAI API key' : 'Gemini API key'}
              onChange={(event) => handleRewriteApiKeyChange(event.target.value)}
            />
            <input
              type="text"
              value={currentRewriteModel}
              placeholder={rewriteProvider === 'openai' ? 'Model (e.g., gpt-5.2)' : 'Model (e.g., gemini-3-pro-preview)'}
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
              value={currentSemanticSearchApiKey}
              placeholder={semanticSearchProvider === 'openai' ? 'OpenAI API key' : 'Gemini API key'}
              onChange={(event) => handleSemanticSearchApiKeyChange(event.target.value)}
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
            </select>
            <input
              type="password"
              value={currentExtractApiKey}
              placeholder={extractProvider === 'openai' ? 'OpenAI API key' : 'Gemini API key'}
              onChange={(event) => handleExtractApiKeyChange(event.target.value)}
            />
            <input
              type="text"
              value={currentExtractModel}
              placeholder={extractProvider === 'openai' ? 'Model (e.g., gpt-5.2)' : 'Model (e.g., gemini-3-pro-preview)'}
              onChange={(event) => handleExtractModelChange(event.target.value)}
            />
            <span className="structured-extract-settings-note">
              Used for PDF table/image structured extraction. Cache is per file checksum and provider/model.
            </span>
          </div>
          <button
            type="button"
            onClick={onTriggerGeminiExtraction}
            disabled={state.status !== 'ready' || geminiExtractionState.status === 'loading'}
          >
            {geminiExtractionState.status === 'loading' ? 'Extracting...' :
             geminiExtractionState.status === 'ready'
               ? `Re-extract with ${rewriteProvider === 'openai' ? 'OpenAI' : 'Gemini'}`
               : `Extract with ${rewriteProvider === 'openai' ? 'OpenAI' : 'Gemini'}`}
          </button>
          {geminiExtractionState.status === 'ready' && (
            <span className="extraction-status">✓ Extraction cached</span>
          )}
          {geminiExtractionState.status === 'error' && (
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
            disabled={focusProvider !== 'openai'}
          />
          <span>Capture Gemini exchanges</span>
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
            Clears this app&apos;s IndexedDB caches and localStorage settings (including saved API keys), then reloads.
          </span>
          {resetLocalDataError && <span className="focus-error">{resetLocalDataError}</span>}
        </div>
      </section>
      </div>
    </aside>
  );
}
