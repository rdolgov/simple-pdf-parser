export function parseApiErrorMessage(text: string | null): string | null {
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return text;
    }

    const record = parsed as Record<string, unknown>;
    const errorObj = record.error && typeof record.error === 'object'
      ? (record.error as Record<string, unknown>)
      : null;
    const message =
      asNonEmptyString(record.error) ??
      asNonEmptyString(errorObj?.message) ??
      asNonEmptyString(errorObj?.error) ??
      asNonEmptyString(record.message);

    if (!message) {
      return text;
    }

    const type = asNonEmptyString(errorObj?.type) ?? asNonEmptyString(record.type);
    const param = asNonEmptyString(errorObj?.param) ?? asNonEmptyString(record.param);
    const code = asNonEmptyString(errorObj?.code) ?? asNonEmptyString(record.code);
    const details = [type ? `type: ${type}` : null, param ? `param: ${param}` : null, code ? `code: ${code}` : null]
      .filter(Boolean) as string[];
    return details.length > 0 ? `${message} (${details.join(', ')})` : message;
  } catch {
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  }
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
