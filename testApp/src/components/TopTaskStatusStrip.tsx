import type { TopTaskStatusView } from '../utils/topTaskStatus';

interface TopTaskStatusStripProps {
  status: TopTaskStatusView;
}

export function TopTaskStatusStrip({ status }: TopTaskStatusStripProps): JSX.Element {
  const clampedProgress =
    typeof status.progress === 'number' && Number.isFinite(status.progress)
      ? Math.max(0, Math.min(1, status.progress))
      : null;
  const progressPercent = clampedProgress !== null ? Math.round(clampedProgress * 100) : null;

  return (
    <div
      className={`top-task-status-strip top-task-status-strip--${status.tone}`}
      role="status"
      aria-live="polite"
    >
      <div className="top-task-status-strip__header">
        <span className="top-task-status-strip__title">{status.title}</span>
        <span className="top-task-status-strip__message">{status.message}</span>
      </div>
      {status.detail ? <div className="top-task-status-strip__detail">{status.detail}</div> : null}
      {clampedProgress !== null ? (
        <div className="top-task-status-strip__progress" aria-hidden="true">
          <div
            className="top-task-status-strip__progress-fill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
