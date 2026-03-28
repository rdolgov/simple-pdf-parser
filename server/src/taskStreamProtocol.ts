import type { ServerResponse } from 'node:http';

export type TaskStreamEvent<TResult> =
  | { type: 'delta'; delta: string }
  | { type: 'complete'; result: TResult }
  | { type: 'error'; error: string };

export function writeTaskStreamHeaders(response: ServerResponse): void {
  response.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
}

export function writeTaskStreamEvent<TResult>(response: ServerResponse, event: TaskStreamEvent<TResult>): void {
  response.write(`${JSON.stringify(event)}\n`);
}
