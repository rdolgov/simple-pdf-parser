export function formatDurationSeconds(durationMs: number): string {
  return (durationMs / 1000).toFixed(2);
}

export function formatDurationFields(durationMs: number): string {
  return `durationMs=${durationMs} durationSec=${formatDurationSeconds(durationMs)}`;
}
