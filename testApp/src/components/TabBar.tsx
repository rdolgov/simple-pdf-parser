import type { ViewMode, FocusRenderState, FocusRecording } from '../types';

interface TabBarProps {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  showFocusView: (mode: 'focus-render' | 'focus-pdf') => void;
  isDocumentReady: boolean;
  focusState: FocusRenderState;
  focusRecordings: FocusRecording[];
}

export function TabBar({
  viewMode,
  setViewMode,
  showFocusView,
  isDocumentReady,
  focusState,
  focusRecordings
}: TabBarProps): JSX.Element {
  const handleViewChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedMode = event.target.value as ViewMode;

    if (selectedMode === 'focus-render' || selectedMode === 'focus-pdf') {
      showFocusView(selectedMode);
    } else {
      setViewMode(selectedMode);
    }
  };

  return (
    <div className="view-selector">
      <label htmlFor="view-mode-select">View Mode</label>
      <select
        id="view-mode-select"
        value={viewMode}
        onChange={handleViewChange}
        className="view-mode-dropdown"
      >
        <optgroup label="Document Views">
          <option value="canvas" disabled={!isDocumentReady}>
            Canvas View
          </option>
          <option value="layout-json" disabled={!isDocumentReady}>
            Layout JSON
          </option>
          <option value="html-json" disabled={!isDocumentReady}>
            HTML Layout JSON
          </option>
          <option value="html-render" disabled={!isDocumentReady}>
            HTML Render
          </option>
          <option value="structured-data">Structured Data</option>
        </optgroup>
        <optgroup label="Focus Views">
          <option value="focus-render" disabled={focusState.status === 'idle'}>
            Focus View
          </option>
          <option value="focus-pdf" disabled={focusState.status === 'idle'}>
            Focus PDF
          </option>
          <option value="focus-debug" disabled={focusRecordings.length === 0}>
            Focus Debug
          </option>
        </optgroup>
        <optgroup label="API Sandboxes">
          <option value="gemini">Gemini Playground</option>
          <option value="lmstudio">LM Studio Embeddings</option>
          <option value="structured-extract">Structured Extract</option>
          <option value="ai-studio">AI Studio JSON</option>
        </optgroup>
      </select>
    </div>
  );
}
