export function LMStudioPlayground(): JSX.Element {
  return (
    <div className="gemini-playground">
      <div className="gemini-header">
        <div className="gemini-title">
          <p className="gemini-kicker">Proxy-Only Mode</p>
          <h2>LM Studio direct sandbox removed</h2>
          <p className="gemini-subtitle">
            This app now routes model work through the backend task API only. The old browser-side LM Studio playground was removed to keep the client proxy-only.
          </p>
        </div>
      </div>
      <div className="gemini-grid">
        <div className="gemini-card">
          <div className="gemini-placeholder">
            If you want LM Studio support again, add it on the backend as a task provider so the browser stays on the same proxy contract as the rest of the app.
          </div>
        </div>
      </div>
    </div>
  );
}
