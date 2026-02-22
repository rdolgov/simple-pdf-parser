import { inflate } from 'pako';

function ensureUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }
  if (value && typeof value === 'object') {
    const candidate = value as { length?: unknown };
    if (typeof candidate.length === 'number') {
      const length = candidate.length;
      const output = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) {
        const element = (value as Record<number, number>)[index];
        output[index] = element & 0xff;
      }
      return output;
    }
  }
  throw new Error('Flate decode produced no data.');
}

export function decodeFlate(data: Uint8Array): Uint8Array {
  try {
    return ensureUint8Array(inflate(data));
  } catch (error) {
    let end = data.length;
    while (end > 0) {
      const lastByte = data[end - 1];
      if (lastByte === 0x0a || lastByte === 0x0d) {
        end -= 1;
        try {
          return ensureUint8Array(inflate(data.subarray(0, end)));
        } catch {
          continue;
        }
      } else {
        break;
      }
    }
    throw error instanceof Error ? error : new Error('Failed to decode Flate stream.');
  }
}

