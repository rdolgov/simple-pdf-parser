const ASYNC_HEADER_NAME = 'X-LLM-Proxy-Async';
const ASYNC_HEADER_VALUE = 'poll';
const DEFAULT_POLL_INTERVAL_MS = 1500;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

interface AcceptedAsyncJobPayload {
  pollUrl?: string;
  retryAfterMs?: number;
}

export async function fetchWithLlmProxyPolling(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: {
    timeoutMs?: number;
  }
): Promise<Response> {
  const requestUrl = resolveRequestUrl(input);
  if (!isLlmProxyUrl(requestUrl)) {
    return fetchImpl(input, init);
  }

  const initialResponse = await fetchImpl(input, {
    ...init,
    headers: withAsyncHeader(init?.headers)
  });
  if (initialResponse.status !== 202) {
    return initialResponse;
  }

  const accepted = await readAcceptedAsyncJob(initialResponse, requestUrl);
  if (!accepted?.pollUrl) {
    return initialResponse;
  }

  const startedAt = Date.now();
  const timeoutMs = Math.max(1_000, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let pollDelayMs = normalizePollDelayMs(accepted.retryAfterMs) ?? DEFAULT_POLL_INTERVAL_MS;
  const pollRequestInit = buildPollRequestInit(init);
  const pollUrl = buildPollUrl(accepted.pollUrl, requestUrl);

  while (true) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`LLM proxy polling timed out after ${timeoutMs}ms`);
    }

    await delay(pollDelayMs);
    const response = await fetchImpl(pollUrl, pollRequestInit);
    if (response.status !== 202) {
      return response;
    }

    const pending = await readAcceptedAsyncJob(response, pollUrl);
    pollDelayMs = normalizePollDelayMs(pending?.retryAfterMs) ?? readRetryAfterHeaderMs(response) ?? DEFAULT_POLL_INTERVAL_MS;
  }
}

function withAsyncHeader(headers: HeadersInit | undefined): Headers {
  const next = new Headers(headers);
  if (!next.has(ASYNC_HEADER_NAME)) {
    next.set(ASYNC_HEADER_NAME, ASYNC_HEADER_VALUE);
  }
  return next;
}

function buildPollRequestInit(init: RequestInit | undefined): RequestInit {
  const headers = new Headers(init?.headers);
  const nextHeaders = new Headers();
  copyHeader(headers, nextHeaders, 'Authorization');
  copyHeader(headers, nextHeaders, 'X-LLM-Proxy-Auth');
  copyHeader(headers, nextHeaders, 'Accept');
  return {
    method: 'GET',
    headers: nextHeaders,
    credentials: init?.credentials,
    mode: init?.mode,
    redirect: init?.redirect,
    referrer: init?.referrer,
    referrerPolicy: init?.referrerPolicy,
    signal: init?.signal,
    cache: 'no-store'
  };
}

function buildPollUrl(pollUrl: string, requestUrl: string): string {
  const resolvedPollUrl = new URL(pollUrl, requestUrl);
  const originalUrl = new URL(requestUrl, resolvedPollUrl);
  const originalKey = normalizeNonEmpty(originalUrl.searchParams.get('key'));
  if (originalKey && !resolvedPollUrl.searchParams.has('key')) {
    resolvedPollUrl.searchParams.set('key', originalKey);
  }
  return resolvedPollUrl.toString();
}

function copyHeader(source: Headers, target: Headers, name: string): void {
  const value = source.get(name);
  if (typeof value === 'string' && value.trim().length > 0) {
    target.set(name, value);
  }
}

async function readAcceptedAsyncJob(
  response: Response,
  requestUrl: string
): Promise<AcceptedAsyncJobPayload | null> {
  const location = normalizeNonEmpty(response.headers.get('Location'));
  const retryAfterMs = readRetryAfterHeaderMs(response);

  let payload: AcceptedAsyncJobPayload | null = null;
  try {
    payload = (await response.json()) as AcceptedAsyncJobPayload;
  } catch {
    payload = null;
  }

  const pollUrl = normalizeNonEmpty(payload?.pollUrl) ?? location ?? null;
  if (!pollUrl) {
    return null;
  }

  return {
    pollUrl: new URL(pollUrl, requestUrl).toString(),
    retryAfterMs: normalizePollDelayMs(payload?.retryAfterMs) ?? retryAfterMs ?? undefined
  };
}

function readRetryAfterHeaderMs(response: Response): number | null {
  const retryAfter = normalizeNonEmpty(response.headers.get('Retry-After'));
  if (!retryAfter) {
    return null;
  }
  const seconds = Number.parseFloat(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return Math.round(seconds * 1000);
}

function normalizePollDelayMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value);
}

function normalizeNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isLlmProxyUrl(value: string): boolean {
  let pathname = value;
  try {
    pathname = new URL(value, 'http://localhost').pathname;
  } catch {
    // Keep raw string fallback.
  }
  return /\/api\/(?:llm\/(?:openai|gemini|codex)|tasks)(?:\/|$)/.test(pathname);
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  const raw = resolveRawRequestUrl(input);
  try {
    return new URL(raw, getDefaultRequestBaseUrl()).toString();
  } catch {
    return raw;
  }
}

function resolveRawRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function getDefaultRequestBaseUrl(): string {
  if (typeof window !== 'undefined' && typeof window.location?.origin === 'string' && window.location.origin.length > 0) {
    return window.location.origin;
  }
  return 'http://localhost';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
