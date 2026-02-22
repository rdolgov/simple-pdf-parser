export function bufferToLatin1(bytes: ArrayLike<number>): string {
  const length = bytes.length;
  if (length === 0) {
    return '';
  }

  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += String.fromCharCode(bytes[index] & 0xff);
  }
  return result;
}

export function latin1ToUint8(value: string): Uint8Array {
  const length = value.length;
  const out = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    out[index] = value.charCodeAt(index) & 0xff;
  }
  return out;
}

export function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return typeof btoa !== 'undefined' ? btoa(binary) : '';
}
