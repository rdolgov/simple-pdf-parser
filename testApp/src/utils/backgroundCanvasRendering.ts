import type { PDFPage } from 'pdf-layout-parser';

const DEFAULT_PAGE_PADDING = 16;

export const MAIN_THREAD_PAGE_RENDER_COUNT = 5;

export function supportsBackgroundCanvasRendering(): boolean {
  if (typeof window === 'undefined' || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    return false;
  }

  if (typeof HTMLCanvasElement === 'undefined') {
    return false;
  }

  return typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
}

export function pageRequiresMainThreadRendering(page: PDFPage): boolean {
  return page.imageItems.some((image) => Boolean(image.dataUri) && !image.pixels);
}

export function computeCanvasDisplaySize(
  pageWidth: number,
  pageHeight: number,
  zoom: number,
  pagePadding = DEFAULT_PAGE_PADDING
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.ceil((pageWidth + pagePadding * 2) * zoom)),
    height: Math.max(1, Math.ceil((pageHeight + pagePadding * 2) * zoom))
  };
}
