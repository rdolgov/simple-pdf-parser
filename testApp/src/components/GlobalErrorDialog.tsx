import type { GlobalFetchError } from '../hooks/useGlobalFetchActivity';

export interface GlobalErrorDialogProps {
  error: GlobalFetchError | null;
  onClose: () => void;
}

export function GlobalErrorDialog({ error, onClose }: GlobalErrorDialogProps): JSX.Element | null {
  if (!error) {
    return null;
  }

  return (
    <div className="global-error-dialog" role="alertdialog" aria-modal="true" aria-live="assertive">
      <div className="global-error-dialog__backdrop" onClick={onClose} />
      <div className="global-error-dialog__panel">
        <div className="global-error-dialog__header">
          <div className="global-error-dialog__title">API Request Failed</div>
          <button
            type="button"
            className="global-error-dialog__close"
            onClick={onClose}
            aria-label="Close error dialog"
          >
            ×
          </button>
        </div>
        <div className="global-error-dialog__message">{error.message}</div>
        <div className="global-error-dialog__meta">
          {error.method ? <span>{error.method}</span> : null}
          {typeof error.status === 'number' ? <span>Status {error.status}</span> : null}
          {error.url ? <span className="global-error-dialog__url">{error.url}</span> : null}
        </div>
        <div className="global-error-dialog__actions">
          <button type="button" onClick={onClose}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
