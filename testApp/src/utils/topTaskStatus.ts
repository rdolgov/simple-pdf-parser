export type TopTaskStatusTone = 'running' | 'success' | 'error' | 'info';

export interface TopTaskStatusView {
  tone: TopTaskStatusTone;
  title: string;
  message: string;
  detail?: string | null;
  progress?: number | null;
}
