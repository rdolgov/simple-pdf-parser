import { CanvasRenderer, PDFDocument } from 'pdf-layout-parser';

import { drawFormulaCheckOverlay, findTextItemsInCrop } from './formulaCheckOverlay';

type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function parseCrop(value: string | null): CropRect {
  if (!value) {
    throw new Error('Missing crop query parameter.');
  }

  const [x, y, width, height] = value.split(',').map((part) => Number(part));
  if (![x, y, width, height].every((entry) => Number.isFinite(entry))) {
    throw new Error(`Invalid crop rectangle: ${value}`);
  }

  return { x, y, width, height };
}

function parseNumber(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildPdfUrl(pdfPath: string): string {
  return `/__formula_pdf__?path=${encodeURIComponent(pdfPath)}`;
}

function setStatus(message: string): void {
  const root = document.getElementById('root');
  if (root) {
    root.textContent = message;
  }
}

async function renderFormulaCheck(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const pdfPath = params.get('pdfPath');
  if (!pdfPath) {
    throw new Error('Missing pdfPath query parameter.');
  }

  const pageNumber = Math.max(1, Math.floor(parseNumber(params.get('page'), 1)));
  const scale = Math.max(0.5, parseNumber(params.get('scale'), 2));
  const padding = Math.max(0, parseNumber(params.get('padding'), 16));
  const cropPadding = Math.max(0, parseNumber(params.get('cropPadding'), 8));
  const crop = parseCrop(params.get('crop'));
  const debugOverlay = params.get('debug') === '1';

  const response = await fetch(buildPdfUrl(pdfPath));
  if (!response.ok) {
    throw new Error(`Unable to load PDF: ${response.status} ${response.statusText}`);
  }

  const bytes = await response.arrayBuffer();
  const documentModel = PDFDocument.from(bytes);
  const page = documentModel.getPage(pageNumber);
  if (!page) {
    throw new Error(`Page ${pageNumber} not found.`);
  }

  const offscreenCanvas = document.createElement('canvas');
  const renderer = new CanvasRenderer({
    pagePadding: padding,
    scale
  });
  await renderer.prepareDocumentFonts(documentModel);
  await renderer.preparePageImages(documentModel, pageNumber);
  renderer.render(offscreenCanvas, documentModel, pageNumber);

  const sourceX = Math.max(0, Math.floor(padding + crop.x * scale - cropPadding));
  const sourceY = Math.max(0, Math.floor(padding + (page.size.height - crop.y - crop.height) * scale - cropPadding));
  const sourceWidth = Math.max(1, Math.ceil(crop.width * scale + cropPadding * 2));
  const sourceHeight = Math.max(1, Math.ceil(crop.height * scale + cropPadding * 2));

  const visibleCanvas = document.createElement('canvas');
  visibleCanvas.id = 'formula-check-canvas';
  visibleCanvas.width = sourceWidth;
  visibleCanvas.height = sourceHeight;
  visibleCanvas.style.width = `${sourceWidth}px`;
  visibleCanvas.style.height = `${sourceHeight}px`;
  visibleCanvas.style.display = 'block';
  visibleCanvas.style.background = '#ffffff';

  const context = visibleCanvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to create 2D canvas context.');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, sourceWidth, sourceHeight);
  context.drawImage(
    offscreenCanvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight
  );

  if (debugOverlay) {
    drawFormulaCheckOverlay({
      context,
      crop,
      cropPadding,
      items: findTextItemsInCrop(page.textItems, crop),
      scale
    });
  }

  document.body.style.margin = '0';
  document.body.style.background = '#ffffff';
  document.body.style.display = 'flex';
  document.body.style.alignItems = 'flex-start';
  document.body.style.justifyContent = 'flex-start';

  const root = document.getElementById('root');
  if (!root) {
    throw new Error('Missing root node.');
  }

  root.replaceChildren(visibleCanvas);
  document.title = 'formula-check:ready';

  (window as Window & {
    __formulaCheckReady?: boolean;
    __formulaCheckCanvasDataUrl?: string;
    __formulaCheckDebug?: {
      crop: CropRect;
      debugOverlay: boolean;
      pageNumber: number;
    };
  }).__formulaCheckReady = true;
  (window as Window & {
    __formulaCheckReady?: boolean;
    __formulaCheckCanvasDataUrl?: string;
    __formulaCheckDebug?: {
      crop: CropRect;
      debugOverlay: boolean;
      pageNumber: number;
    };
  }).__formulaCheckCanvasDataUrl = visibleCanvas.toDataURL('image/png');
  (window as Window & {
    __formulaCheckReady?: boolean;
    __formulaCheckCanvasDataUrl?: string;
    __formulaCheckDebug?: {
      crop: CropRect;
      debugOverlay: boolean;
      pageNumber: number;
    };
  }).__formulaCheckDebug = {
    crop,
    debugOverlay,
    pageNumber
  };
}

void (async () => {
  try {
    setStatus('Rendering formula crop...');
    await renderFormulaCheck();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown formula-check error.';
    document.title = 'formula-check:error';
    setStatus(message);
    console.error('[formula-check]', error);
  }
})();
