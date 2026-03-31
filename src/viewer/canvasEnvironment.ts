export interface FontFaceSetLike {
  add?: (fontFace: FontFace) => unknown;
  load?: (font: string, text?: string) => Promise<unknown>;
  ready?: Promise<unknown>;
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

export async function waitForGlobalFontFamilyActivation(family: string): Promise<void> {
  const fontSet = getGlobalFontSet();
  if (!fontSet) {
    return;
  }

  const fontSpec = `16px ${quoteFontFamily(family)}`;
  if (typeof fontSet.load === 'function') {
    try {
      await awaitWithTimeout(fontSet.load(fontSpec, 'A'), 2000);
    } catch {
      // Some environments expose document.fonts but reject explicit loads for
      // freshly added faces; keep the registration attempt best-effort.
    }
  }

  if (fontSet.ready) {
    try {
      await awaitWithTimeout(fontSet.ready, 2000);
    } catch {
      // Keep rendering usable even if the font-set readiness promise rejects.
    }
  }
}

function quoteFontFamily(family: string): string {
  return /^[-._A-Za-z0-9]+$/.test(family) ? family : `"${family.replace(/["\\]/g, '\\$&')}"`;
}

async function awaitWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<T | undefined>([
      promise,
      new Promise<undefined>((resolve) => {
        timeoutId = setTimeout(() => resolve(undefined), timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
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
