/**
 * Image decoding utilities for PDF parsing
 */

import type { CcittMask } from './ccittDecoder.js';
import type { ImageResource } from './parserTypes.js';

/**
 * PNG Paeth predictor algorithm
 */
export function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  if (pb <= pc) {
    return b;
  }
  return c;
}

/**
 * Apply PNG predictor filter to decompressed image data
 */
export function applyImagePredictor(
  data: Uint8Array,
  decodeParms: Record<string, number | boolean> | undefined,
  components: number,
  width: number,
  height: number,
  bitsPerComponent: number
): Uint8Array | undefined {
  if (bitsPerComponent !== 8) {
    return undefined;
  }

  const predictor = typeof decodeParms?.Predictor === 'number' ? Number(decodeParms.Predictor) : 1;
  const rowSize = width * components;

  if (predictor >= 10) {
    const bytesPerPixel = Math.max(1, components);
    const rowStride = rowSize;
    const expectedLength = (rowStride + 1) * height;
    if (data.length < expectedLength) {
      return undefined;
    }
    const output = new Uint8Array(rowStride * height);
    let srcOffset = 0;
    let dstOffset = 0;
    for (let row = 0; row < height; row += 1) {
      const filter = data[srcOffset++];
      for (let col = 0; col < rowStride; col += 1) {
        const byte = data[srcOffset++];
        const left = col >= bytesPerPixel ? output[dstOffset + col - bytesPerPixel] : 0;
        const up = row > 0 ? output[dstOffset + col - rowStride] : 0;
        const upLeft = row > 0 && col >= bytesPerPixel ? output[dstOffset + col - rowStride - bytesPerPixel] : 0;
        let value = byte;
        switch (filter) {
          case 0:
            value = byte;
            break;
          case 1:
            value = (byte + left) & 0xff;
            break;
          case 2:
            value = (byte + up) & 0xff;
            break;
          case 3:
            value = (byte + Math.floor((left + up) / 2)) & 0xff;
            break;
          case 4:
            value = (byte + paethPredictor(left, up, upLeft)) & 0xff;
            break;
          default:
            value = byte;
            break;
        }
        output[dstOffset + col] = value;
      }
      dstOffset += rowStride;
    }
    return output;
  }

  if (predictor === 1 || predictor === 2) {
    const expectedLength = rowSize * height;
    const output = new Uint8Array(expectedLength);
    output.set(data.subarray(0, expectedLength));
    return output;
  }

  const fallback = new Uint8Array(rowSize * height);
  fallback.set(data.subarray(0, fallback.length));
  return fallback;
}

/**
 * Resolve color component count from colorSpace string
 */
export function resolveColorComponentCount(colorSpace?: string): number | undefined {
  if (!colorSpace) {
    return 3;
  }
  const normalized = colorSpace.toLowerCase();
  if (normalized.includes('devicergb') || normalized.includes('rgb')) {
    return 3;
  }
  if (normalized.includes('devicecmyk') || normalized.includes('cmyk')) {
    return 4;
  }
  if (normalized.includes('devicegray') || normalized.includes('gray') || normalized.includes('grey')) {
    return 1;
  }
  return 3;
}

/**
 * Decode a FlateDecode compressed image to RGBA pixels
 */
export function decodeFlateImage(
  bytes: Uint8Array,
  resource: ImageResource
): { width: number; height: number; data: Uint8ClampedArray } | undefined {
  const width = resource.width ?? 0;
  const height = resource.height ?? 0;
  const bits = resource.bitsPerComponent ?? 8;
  const indexedColorSpace = resource.indexedColorSpace;
  const components = indexedColorSpace
    ? 1
    : resolveColorComponentCount(resource.colorSpace);

  if (!(width > 0) || !(height > 0) || bits !== 8 || !components) {
    return undefined;
  }

  const decoded = applyImagePredictor(bytes, resource.decodeParms, components, width, height, bits);
  if (!decoded) {
    return undefined;
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  const decodeArr = Array.isArray(resource.decode) ? resource.decode : undefined;
  const hasDecode = decodeArr && decodeArr.length >= components * 2;

  const applyDecode = (channel: number, componentIndex: number): number => {
    if (!hasDecode) {
      return channel;
    }
    const min = decodeArr![componentIndex * 2];
    const max = decodeArr![componentIndex * 2 + 1];
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return channel;
    }
    const normalized = channel / 255;
    const scaled = min + (max - min) * normalized;
    return Math.round(Math.max(0, Math.min(1, scaled)) * 255);
  };

  const totalPixels = width * height;
  if (indexedColorSpace) {
    const baseComponents = resolveColorComponentCount(indexedColorSpace.base);
    if (!baseComponents || indexedColorSpace.lookup.length < baseComponents) {
      return undefined;
    }

    const maxIndex = Math.min(indexedColorSpace.highValue, Math.floor(indexedColorSpace.lookup.length / baseComponents) - 1);
    for (let i = 0; i < totalPixels; i += 1) {
      const paletteIndex = Math.max(0, Math.min(decoded[i], maxIndex));
      const paletteOffset = paletteIndex * baseComponents;
      const base = i * 4;
      if (baseComponents === 1) {
        const value = indexedColorSpace.lookup[paletteOffset] ?? 0;
        rgba[base] = value;
        rgba[base + 1] = value;
        rgba[base + 2] = value;
      } else {
        rgba[base] = indexedColorSpace.lookup[paletteOffset] ?? 0;
        rgba[base + 1] = indexedColorSpace.lookup[paletteOffset + 1] ?? rgba[base];
        rgba[base + 2] = indexedColorSpace.lookup[paletteOffset + 2] ?? rgba[base + 1];
      }
      rgba[base + 3] = 255;
    }
    return { width, height, data: rgba };
  }

  switch (components) {
    case 1: {
      for (let i = 0; i < totalPixels; i += 1) {
        const value = applyDecode(decoded[i], 0);
        rgba[i * 4] = value;
        rgba[i * 4 + 1] = value;
        rgba[i * 4 + 2] = value;
        rgba[i * 4 + 3] = 255;
      }
      break;
    }
    case 3: {
      for (let i = 0; i < totalPixels; i += 1) {
        const offset = i * 3;
        const r = applyDecode(decoded[offset], 0);
        const g = applyDecode(decoded[offset + 1], 1);
        const b = applyDecode(decoded[offset + 2], 2);
        const base = i * 4;
        rgba[base] = r;
        rgba[base + 1] = g;
        rgba[base + 2] = b;
        rgba[base + 3] = 255;
      }
      break;
    }
    case 4: {
      for (let i = 0; i < totalPixels; i += 1) {
        const offset = i * 4;
        const c = applyDecode(decoded[offset], 0) / 255;
        const m = applyDecode(decoded[offset + 1], 1) / 255;
        const y = applyDecode(decoded[offset + 2], 2) / 255;
        const k = applyDecode(decoded[offset + 3], 3) / 255;
        const r = Math.round((1 - Math.min(1, c + k)) * 255);
        const g = Math.round((1 - Math.min(1, m + k)) * 255);
        const b = Math.round((1 - Math.min(1, y + k)) * 255);
        const base = i * 4;
        rgba[base] = r;
        rgba[base + 1] = g;
        rgba[base + 2] = b;
        rgba[base + 3] = 255;
      }
      break;
    }
    default:
      return undefined;
  }

  return { width, height, data: rgba };
}

/**
 * Convert CCITT mask to RGBA pixels
 */
export function ccittMaskToPixels(mask: CcittMask): { width: number; height: number; data: Uint8ClampedArray } {
  const total = mask.width * mask.height;
  const data = new Uint8ClampedArray(total * 4);
  for (let i = 0; i < total; i += 1) {
    const paint = mask.blackIs1 ? mask.data[i] === 1 : mask.data[i] === 0;
    const value = paint ? 255 : 0;
    const offset = i * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = value;
  }
  return { width: mask.width, height: mask.height, data };
}

/**
 * Convert a CCITT-decoded 1-bit image into grayscale RGBA pixels.
 */
export function ccittMaskToGrayPixels(
  mask: CcittMask,
  decode?: number[]
): { width: number; height: number; data: Uint8ClampedArray } {
  const total = mask.width * mask.height;
  const data = new Uint8ClampedArray(total * 4);
  const invertByDecode =
    Array.isArray(decode) &&
    decode.length >= 2 &&
    Number.isFinite(decode[0]) &&
    Number.isFinite(decode[1]) &&
    decode[0] > decode[1];

  for (let i = 0; i < total; i += 1) {
    const isBlack = mask.blackIs1 ? mask.data[i] === 1 : mask.data[i] === 0;
    const normalized = invertByDecode ? (isBlack ? 1 : 0) : isBlack ? 0 : 1;
    const value = Math.round(normalized * 255);
    const offset = i * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }

  return { width: mask.width, height: mask.height, data };
}

/**
 * Trim whitespace/transparent borders from an image
 */
export function trimPixelBounds(image: { width: number; height: number; data: Uint8ClampedArray }): {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  offsetX: number;
  offsetY: number;
} {
  const { width, height, data } = image;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = data[index + 3];
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const opaque = alpha > 10;
      const colored = r < 250 || g < 250 || b < 250;
      if (opaque && colored) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0 || maxY < 0) {
    return { width, height, data, offsetX: 0, offsetY: 0 };
  }

  const trimmedWidth = maxX - minX + 1;
  const trimmedHeight = maxY - minY + 1;
  const trimmedData = new Uint8ClampedArray(trimmedWidth * trimmedHeight * 4);

  for (let y = 0; y < trimmedHeight; y += 1) {
    for (let x = 0; x < trimmedWidth; x += 1) {
      const srcIndex = ((y + minY) * width + (x + minX)) * 4;
      const dstIndex = (y * trimmedWidth + x) * 4;
      trimmedData[dstIndex] = data[srcIndex];
      trimmedData[dstIndex + 1] = data[srcIndex + 1];
      trimmedData[dstIndex + 2] = data[srcIndex + 2];
      trimmedData[dstIndex + 3] = data[srcIndex + 3];
    }
  }

  return {
    width: trimmedWidth,
    height: trimmedHeight,
    data: trimmedData,
    offsetX: minX,
    offsetY: minY
  };
}
