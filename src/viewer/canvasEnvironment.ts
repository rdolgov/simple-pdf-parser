export interface FontFaceSetLike {
  add?: (fontFace: FontFace) => unknown;
}

export function getGlobalFontSet(): FontFaceSetLike | undefined {
  const globalScope = globalThis as typeof globalThis & {
    fonts?: FontFaceSetLike;
    document?: { fonts?: FontFaceSetLike };
  };

  return globalScope.document?.fonts ?? globalScope.fonts;
}

export function canRegisterEmbeddedFontsInCurrentScope(): boolean {
  return typeof FontFace !== 'undefined' && typeof getGlobalFontSet()?.add === 'function';
}

export function createScratchCanvas(
  width: number,
  height: number
): { canvas: HTMLCanvasElement | OffscreenCanvas; context: CanvasRenderingContext2D } | undefined {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return undefined;
    }
    return { canvas, context };
  }

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) {
      return undefined;
    }
    return {
      canvas,
      context: context as unknown as CanvasRenderingContext2D
    };
  }

  return undefined;
}
