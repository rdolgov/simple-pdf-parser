export interface ServerSentEvent {
  event?: string;
  data: string;
  id?: string;
}

export async function readServerSentEvents(
  response: Response,
  onEvent: (event: ServerSentEvent) => void | Promise<void>
): Promise<void> {
  const body = response.body;
  if (!body) {
    throw new Error('Streaming response did not include a body.');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    while (true) {
      const boundary = findEventBoundary(buffer);
      if (!boundary) {
        break;
      }

      const rawEvent = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.length);
      const parsed = parseServerSentEvent(rawEvent);
      if (parsed) {
        await onEvent(parsed);
      }
    }

    if (done) {
      break;
    }
  }

  buffer += decoder.decode();
  const trailing = parseServerSentEvent(buffer);
  if (trailing) {
    await onEvent(trailing);
  }
}

function parseServerSentEvent(rawEvent: string): ServerSentEvent | null {
  const trimmed = rawEvent.replace(/^\s+|\s+$/g, '');
  if (trimmed.length === 0) {
    return null;
  }

  const lines = rawEvent.split(/\r?\n/);
  const dataLines: string[] = [];
  let event: string | undefined;
  let id: string | undefined;

  for (const line of lines) {
    if (line.length === 0 || line.startsWith(':')) {
      continue;
    }

    const separator = line.indexOf(':');
    const field = separator >= 0 ? line.slice(0, separator) : line;
    const rawValue = separator >= 0 ? line.slice(separator + 1) : '';
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

    if (field === 'data') {
      dataLines.push(value);
      continue;
    }
    if (field === 'event') {
      event = value;
      continue;
    }
    if (field === 'id') {
      id = value;
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    ...(event ? { event } : {}),
    ...(id ? { id } : {}),
    data: dataLines.join('\n')
  };
}

function findEventBoundary(buffer: string): { index: number; length: number } | null {
  for (let index = 0; index < buffer.length - 1; index += 1) {
    const current = buffer[index];
    const next = buffer[index + 1];

    if (current === '\n' && next === '\n') {
      return { index, length: 2 };
    }
    if (current === '\r' && next === '\r') {
      return { index, length: 2 };
    }
    if (current === '\r' && next === '\n' && buffer[index + 2] === '\r' && buffer[index + 3] === '\n') {
      return { index, length: 4 };
    }
  }
  return null;
}
