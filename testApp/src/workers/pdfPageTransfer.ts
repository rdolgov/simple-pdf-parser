import type { PDFImageItem, PDFPage } from 'pdf-layout-parser';

type SerializedPdfImageMask = NonNullable<PDFImageItem['mask']>;
type SerializedPdfImageSoftMaskPixels = NonNullable<PDFImageItem['softMaskPixels']>;
type SerializedPdfImagePixels = NonNullable<PDFImageItem['pixels']>;

export interface SerializedPdfImageItem extends Omit<PDFImageItem, 'mask' | 'softMaskPixels' | 'pixels'> {
  mask?: SerializedPdfImageMask;
  softMaskPixels?: SerializedPdfImageSoftMaskPixels;
  pixels?: SerializedPdfImagePixels;
}

export interface SerializedPdfPage extends Omit<PDFPage, 'imageItems'> {
  imageItems: SerializedPdfImageItem[];
}

export function serializePdfPage(page: PDFPage): SerializedPdfPage {
  return {
    ...page,
    imageItems: page.imageItems.map((image) => serializePdfImageItem(image))
  };
}

export function deserializePdfPage(page: SerializedPdfPage): PDFPage {
  return {
    ...page,
    imageItems: page.imageItems.map((image) => deserializePdfImageItem(image))
  };
}

function serializePdfImageItem(image: PDFImageItem): SerializedPdfImageItem {
  const serialized: SerializedPdfImageItem = { ...image };

  if (image.mask) {
    serialized.mask = {
      width: image.mask.width,
      height: image.mask.height,
      data: new Uint8Array(image.mask.data),
      blackIs1: image.mask.blackIs1
    };
  }

  if (image.softMaskPixels) {
    serialized.softMaskPixels = {
      width: image.softMaskPixels.width,
      height: image.softMaskPixels.height,
      data: new Uint8ClampedArray(image.softMaskPixels.data)
    };
  }

  if (image.pixels) {
    serialized.pixels = {
      width: image.pixels.width,
      height: image.pixels.height,
      data: new Uint8ClampedArray(image.pixels.data),
      offsetX: image.pixels.offsetX,
      offsetY: image.pixels.offsetY,
      originalWidth: image.pixels.originalWidth,
      originalHeight: image.pixels.originalHeight
    };
  }

  return serialized;
}

function deserializePdfImageItem(image: SerializedPdfImageItem): PDFImageItem {
  const { mask, softMaskPixels, pixels, ...rest } = image;
  const restored: PDFImageItem = { ...rest };

  if (mask) {
    defineHiddenProperty(restored, 'mask', {
      width: mask.width,
      height: mask.height,
      data: new Uint8Array(mask.data),
      blackIs1: mask.blackIs1
    });
  }

  if (softMaskPixels) {
    defineHiddenProperty(restored, 'softMaskPixels', {
      width: softMaskPixels.width,
      height: softMaskPixels.height,
      data: new Uint8ClampedArray(softMaskPixels.data)
    });
  }

  if (pixels) {
    defineHiddenProperty(restored, 'pixels', {
      width: pixels.width,
      height: pixels.height,
      data: new Uint8ClampedArray(pixels.data),
      offsetX: pixels.offsetX,
      offsetY: pixels.offsetY,
      originalWidth: pixels.originalWidth,
      originalHeight: pixels.originalHeight
    });
  }

  return restored;
}

function defineHiddenProperty<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K]
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: false,
    configurable: true,
    writable: true
  });
}
