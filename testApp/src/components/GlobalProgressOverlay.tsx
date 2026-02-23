export interface GlobalProgressOverlayProps {
  visible: boolean;
  title: string;
  message: string;
  progress?: number | null;
  detail?: string | null;
}

export function GlobalProgressOverlay({
  visible,
  title,
  message,
  progress = null,
  detail = null
}: GlobalProgressOverlayProps): JSX.Element | null {
  if (!visible) {
    return null;
  }

  const clampedProgress =
    typeof progress === 'number' && Number.isFinite(progress)
      ? Math.max(0, Math.min(1, progress))
      : null;
  const progressPercent = clampedProgress !== null ? Math.round(clampedProgress * 100) : null;

  return (
    <div className="global-progress-overlay" role="dialog" aria-modal="true" aria-live="polite">
      <div className="global-progress-overlay__backdrop" />
      <div className="global-progress-overlay__panel">
        <div className="global-progress-overlay__title">{title}</div>
        <div className="global-progress-overlay__message">{message}</div>
        <div className="global-progress-overlay__bar" aria-hidden="true">
          <div
            className={`global-progress-overlay__bar-fill${
              clampedProgress === null ? ' global-progress-overlay__bar-fill--indeterminate' : ''
            }`}
            style={clampedProgress !== null ? { width: `${progressPercent}%` } : undefined}
          />
        </div>
        <div className="global-progress-overlay__meta">
          {progressPercent !== null ? `${progressPercent}%` : 'Working…'}
        </div>
        {detail ? <div className="global-progress-overlay__detail">{detail}</div> : null}
      </div>
    </div>
  );
}
