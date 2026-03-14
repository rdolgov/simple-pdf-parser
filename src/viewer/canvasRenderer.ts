import type { PDFImageBounds, PDFImageItem, PDFLineItem, PDFPage, PDFRectItem, PDFTextItem, Type3Glyph } from '../types.js';
import type { PDFDocument } from '../pdfDocument.js';

export interface RenderOptions {
  backgroundColor?: string;
  textColor?: string;
  fontFallback?: string;
  pagePadding?: number;
  scale?: number;
  imagePlaceholderColor?: string;
  zoomStep?: number;
  allowImageOverflow?: boolean;
  /**
   * Device pixel ratio for sharp rendering on high-DPI displays.
   * Set to window.devicePixelRatio for crisp images. Defaults to 1.
   */
  devicePixelRatio?: number;
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasRenderingContext2D | null;
}

const DEFAULT_OPTIONS: Required<RenderOptions> = {
  backgroundColor: '#ffffff',
  textColor: '#1f2933',
  fontFallback: '12px sans-serif',
  pagePadding: 16,
  scale: 1,
  imagePlaceholderColor: '#2563eb',
  zoomStep: 0.1,
  allowImageOverflow: false,
  devicePixelRatio: 1
};

const DEFAULT_PAGE_WIDTH = 612;
const DEFAULT_PAGE_HEIGHT = 792;

interface PageMetrics {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  orientation: 'ascending' | 'descending';
  baselineHeight: number;
}

export class CanvasRenderer {
  private readonly baseOptions: RenderOptions;

  private readonly zoomStep: number;

  private readonly initialScale: number;

  private currentScale: number;

  constructor(options: RenderOptions = {}) {
    this.baseOptions = { ...options };
    this.zoomStep = options.zoomStep ?? DEFAULT_OPTIONS.zoomStep;
    this.initialScale = this.clampScale(options.scale ?? DEFAULT_OPTIONS.scale);
    this.currentScale = this.initialScale;
  }

  getScale(): number {
    return this.currentScale;
  }

  setScale(scale: number): number {
    this.currentScale = this.clampScale(scale);
    return this.currentScale;
  }

  zoomIn(step = this.zoomStep): number {
    return this.setScale(this.currentScale + Math.abs(step));
  }

  zoomOut(step = this.zoomStep): number {
    return this.setScale(this.currentScale - Math.abs(step));
  }

  resetZoom(): number {
    this.currentScale = this.initialScale;
    return this.currentScale;
  }

  render(canvas: CanvasLike, document: PDFDocument, pageNumber = 1): void {
    const renderOptions = {
      ...DEFAULT_OPTIONS,
      ...this.baseOptions,
      zoomStep: this.zoomStep,
      scale: 1,
      allowImageOverflow: false
    };
    const page = document.getPage(pageNumber);

    if (!page) {
      throw new Error(`Page ${pageNumber} does not exist.`);
    }

    const dpr = renderOptions.devicePixelRatio;
    const metrics = this.computePageMetrics(page, renderOptions);
    const logicalWidth = Math.max(1, Math.ceil(metrics.width * this.currentScale));
    const logicalHeight = Math.max(1, Math.ceil(metrics.height * this.currentScale));

    // Set canvas buffer size to account for device pixel ratio
    canvas.width = Math.ceil(logicalWidth * dpr);
    canvas.height = Math.ceil(logicalHeight * dpr);

    // Set CSS dimensions to logical size for proper DPR scaling
    // This makes the canvas display at the intended size while having a higher resolution buffer
    const canvasElement = canvas as unknown as { style?: CSSStyleDeclaration };
    if (canvasElement.style) {
      canvasElement.style.width = `${logicalWidth}px`;
      canvasElement.style.height = `${logicalHeight}px`;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context is not available.');
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    // Scale by both DPR and zoom for sharp rendering on high-DPI displays
    context.scale(this.currentScale * dpr, this.currentScale * dpr);

    this.drawBackground(context, metrics, renderOptions);
    this.drawRects(context, page, metrics, renderOptions);
    this.drawLines(context, page, metrics, renderOptions);
    this.drawImages(context, page, metrics, renderOptions, this.currentScale * dpr);
    this.drawImagePlaceholders(context, page, metrics, renderOptions);
    this.drawTextItems(context, page, metrics, renderOptions);

    context.restore();
  }

  private computePageMetrics(page: PDFPage, options: Required<RenderOptions>): PageMetrics {
    const orientation = this.detectYAxisOrientation(page.textItems);
    const pageWidth = page.size?.width ?? DEFAULT_PAGE_WIDTH;
    const pageHeight = page.size?.height ?? DEFAULT_PAGE_HEIGHT;

    // Use page dimensions for canvas size, not content bounds
    // This prevents oversized images from making the canvas too large
    const contentWidth = pageWidth * options.scale;
    const contentHeight = pageHeight * options.scale;
    const padding = options.pagePadding * 2;

    const width = Math.ceil(contentWidth + padding);
    const height = Math.ceil(contentHeight + padding);
    const offsetX = options.pagePadding;
    const offsetY =
      orientation === 'ascending'
        ? options.pagePadding
        : contentHeight + options.pagePadding;

    return {
      width,
      height,
      offsetX,
      offsetY,
      minX: 0,
      maxX: pageWidth,
      minY: 0,
      maxY: pageHeight,
      orientation,
      baselineHeight:
        (page.textItems.length > 0 ? this.averageLineHeight(page) : 16) * options.scale
    };
  }

  private averageLineHeight(page: PDFPage): number {
    if (page.textItems.length === 0) {
      return 16;
    }

    const sizes = page.textItems
      .map((item) => item.fontSize ?? 12)
      .filter((value) => Number.isFinite(value) && value > 0);

    if (sizes.length === 0) {
      return 16;
    }

    return sizes.reduce((sum, current) => sum + current, 0) / sizes.length;
  }

  private drawBackground(
    context: CanvasRenderingContext2D,
    metrics: ReturnType<CanvasRenderer['computePageMetrics']>,
    options: Required<RenderOptions>
  ): void {
    context.save();
    context.fillStyle = options.backgroundColor;
    context.fillRect(0, 0, metrics.width, metrics.height);
    context.restore();
  }

  private drawLines(
    context: CanvasRenderingContext2D,
    page: PDFPage,
    metrics: ReturnType<CanvasRenderer['computePageMetrics']>,
    _options: Required<RenderOptions>
  ): void {
    if (!page.lineItems || page.lineItems.length === 0) {
      return;
    }

    context.save();

    for (const line of page.lineItems) {
      const [r, g, b, a] = line.strokeColor;
      context.strokeStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
      context.lineWidth = Math.max(0.5, line.lineWidth);
      context.lineCap = 'butt';

      const startX = metrics.offsetX + line.start.x;
      const startY =
        metrics.orientation === 'ascending'
          ? metrics.offsetY + line.start.y
          : metrics.offsetY - line.start.y;
      const endX = metrics.offsetX + line.end.x;
      const endY =
        metrics.orientation === 'ascending'
          ? metrics.offsetY + line.end.y
          : metrics.offsetY - line.end.y;

      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(endX, endY);
      context.stroke();
    }

    context.restore();
  }

  private drawRects(
    context: CanvasRenderingContext2D,
    page: PDFPage,
    metrics: ReturnType<CanvasRenderer['computePageMetrics']>,
    _options: Required<RenderOptions>
  ): void {
    if (!page.rectItems || page.rectItems.length === 0) {
      return;
    }

    context.save();

    for (const rect of page.rectItems) {
      const x = metrics.offsetX + rect.bounds.minX;
      const width = rect.bounds.maxX - rect.bounds.minX;
      const height = rect.bounds.maxY - rect.bounds.minY;
      const y =
        metrics.orientation === 'ascending'
          ? metrics.offsetY + rect.bounds.minY
          : metrics.offsetY - rect.bounds.maxY;

      // Draw fill first
      if (rect.fillColor) {
        const [r, g, b, a] = rect.fillColor;
        context.fillStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
        context.fillRect(x, y, width, height);
      }

      // Draw stroke on top
      if (rect.strokeColor && rect.lineWidth > 0) {
        const [r, g, b, a] = rect.strokeColor;
        context.strokeStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
        context.lineWidth = rect.lineWidth;
        context.strokeRect(x, y, width, height);
      }
    }

    context.restore();
  }

  private drawImages(
    context: CanvasRenderingContext2D,
    page: PDFPage,
    metrics: ReturnType<CanvasRenderer['computePageMetrics']>,
    options: Required<RenderOptions>,
    effectiveScale?: number
  ): void {
    if (!page.imageItems || page.imageItems.length === 0) {
      return;
    }
    // Capture scale for async callbacks - effectiveScale is currentScale * dpr
    const asyncScale = effectiveScale ?? this.currentScale;
    const orderedEntries = page.imageItems.map((item, index) => ({ item, index }));
    orderedEntries.sort((a, b) => {
      const aIsMask = Boolean(a.item.mask);
      const bIsMask = Boolean(b.item.mask);
      if (aIsMask === bIsMask) {
        return a.index - b.index;
      }
      return aIsMask ? 1 : -1;
    });
    const orderedImages = orderedEntries.map((entry) => entry.item);

    const maskImages = orderedImages.filter((image) => Boolean(image.mask));
    const nonMaskImages = orderedImages.filter((image) => !image.mask);

    const drawMaskLayers = (): void => {
      if (maskImages.length === 0) {
        return;
      }
      for (const image of maskImages) {
        // Use original bounds - canvas will naturally clip anything outside page
        const width = (image.bounds.maxX - image.bounds.minX) * options.scale;
        const height = (image.bounds.maxY - image.bounds.minY) * options.scale;
        if (width <= 0 || height <= 0) {
          continue;
        }

        const x = image.bounds.minX * options.scale + metrics.offsetX;
        const y =
          metrics.orientation === 'ascending'
            ? image.bounds.minY * options.scale + metrics.offsetY
            : metrics.offsetY - image.bounds.maxY * options.scale;

        if (!image.mask || typeof document === 'undefined') {
          continue;
        }

        const mask = image.mask;
        const fill = image.fillColor ?? [0, 0, 0, 1];
        const r = Math.round(fill[0] * 255);
        const g = Math.round(fill[1] * 255);
        const b = Math.round(fill[2] * 255);
        const alpha = Math.round((fill[3] ?? 1) * 255);

        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = mask.width;
        maskCanvas.height = mask.height;
        const maskContext = maskCanvas.getContext('2d');
        if (!maskContext) {
          continue;
        }

        const imageData = maskContext.createImageData(mask.width, mask.height);
        const pixels = imageData.data;
        for (let i = 0; i < mask.data.length; i += 1) {
          const paint = mask.blackIs1 ? mask.data[i] === 1 : mask.data[i] === 0;
          const offset = i * 4;
          if (paint) {
            pixels[offset] = r;
            pixels[offset + 1] = g;
            pixels[offset + 2] = b;
            pixels[offset + 3] = alpha;
          } else {
            pixels[offset] = 0;
            pixels[offset + 1] = 0;
            pixels[offset + 2] = 0;
            pixels[offset + 3] = 0;
          }
        }

        maskContext.putImageData(imageData, 0, 0);
        context.drawImage(maskCanvas, x, y, width, height);
      }
    };

    const redrawOverlays = (): void => {
      // Apply scale for async callbacks since context.restore() has already run
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.scale(asyncScale, asyncScale);
      drawMaskLayers();
      this.drawTextItems(context, page, metrics, options);
      context.restore();
    };

    for (const image of nonMaskImages) {
      // Use original bounds - canvas will naturally clip anything outside page
      const width = (image.bounds.maxX - image.bounds.minX) * options.scale;
      const height = (image.bounds.maxY - image.bounds.minY) * options.scale;
      if (width <= 0 || height <= 0) {
        continue;
      }

      const x = image.bounds.minX * options.scale + metrics.offsetX;
      const y =
        metrics.orientation === 'ascending'
          ? image.bounds.minY * options.scale + metrics.offsetY
          : metrics.offsetY - image.bounds.maxY * options.scale;

      if (image.dataUri && typeof Image !== 'undefined') {
        const imageElement = new Image();
        let hasDrawn = false;
        const handleLoad = () => {
          if (hasDrawn) {
            return;
          }
          hasDrawn = true;
          // Apply scale transform for async image loading since context.restore() may have run
          context.save();
          context.setTransform(1, 0, 0, 1, 0, 0);
          context.scale(asyncScale, asyncScale);
          context.drawImage(imageElement, x, y, width, height);
          context.restore();
          redrawOverlays();
        };
        imageElement.onload = handleLoad;
        imageElement.src = image.dataUri!;
        if (imageElement.complete) {
          handleLoad();
        }
        continue;
      }

      if (image.pixels && typeof document !== 'undefined') {
        const bufferCanvas = document.createElement('canvas');
        bufferCanvas.width = image.pixels.width;
        bufferCanvas.height = image.pixels.height;
        const bufferContext = bufferCanvas.getContext('2d');
        if (!bufferContext) {
          continue;
        }
        const imageData = bufferContext.createImageData(image.pixels.width, image.pixels.height);
        imageData.data.set(image.pixels.data);
        bufferContext.putImageData(imageData, 0, 0);
        context.drawImage(bufferCanvas, x, y, width, height);
        continue;
      }

      // No mask handling in this branch; mask images are drawn via drawMaskLayers().
    }

    drawMaskLayers();
  }

  private drawImagePlaceholders(
    context: CanvasRenderingContext2D,
    page: PDFPage,
    metrics: ReturnType<CanvasRenderer['computePageMetrics']>,
    options: Required<RenderOptions>
  ): void {
    if (!page.imageItems || page.imageItems.length === 0) {
      return;
    }

    context.save();
    // Skip drawing placeholder borders when no raster data is available.
    context.restore();
  }

  private clampScale(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      return DEFAULT_OPTIONS.scale;
    }
    return value;
  }

  private detectYAxisOrientation(items: PDFTextItem[]): 'ascending' | 'descending' {
    let ascending = 0;
    let descending = 0;

    for (let index = 1; index < items.length; index += 1) {
      const previous = items[index - 1];
      const current = items[index];
      const prevY = previous.bounds.minY;
      const currY = current.bounds.minY;
      const delta = currY - prevY;
      if (Math.abs(delta) < 0.01) {
        continue;
      }
      if (delta > 0) {
        ascending += 1;
      } else {
        descending += 1;
      }
      if (ascending > 32 && descending === 0) {
        break;
      }
      if (descending > 32 && ascending === 0) {
        break;
      }
    }

    if (ascending === 0 && descending === 0) {
      return 'descending';
    }

    return ascending >= descending ? 'ascending' : 'descending';
  }

  private drawTextItems(
    context: CanvasRenderingContext2D,
    page: PDFPage,
    metrics: ReturnType<CanvasRenderer['computePageMetrics']>,
    options: Required<RenderOptions>
  ): void {
    const sortedItems = [...page.textItems].sort((left, right) => {
      const yLeft = left.bounds.minY;
      const yRight = right.bounds.minY;
      if (Math.abs(yLeft - yRight) > 0.01) {
        return metrics.orientation === 'ascending' ? yLeft - yRight : yRight - yLeft;
      }
      const xLeft = left.bounds.minX;
      const xRight = right.bounds.minX;
      return xLeft - xRight;
    });

    context.save();
    context.textBaseline = 'alphabetic';
    context.fillStyle = options.textColor;
    // Improve text rendering sharpness
    context.imageSmoothingEnabled = false;
    if (context.textRendering !== undefined) {
      context.textRendering = 'geometricPrecision';
    }

    const projectPoint = (x: number, y: number): { x: number; y: number } => {
      const scaledX = x * options.scale + metrics.offsetX;
      const scaledY =
        metrics.orientation === 'ascending'
          ? y * options.scale + metrics.offsetY
          : metrics.offsetY - y * options.scale;
      return { x: scaledX, y: scaledY };
    };

    for (const item of sortedItems) {
      const width = item.bounds.maxX - item.bounds.minX;
      const height = item.bounds.maxY - item.bounds.minY;
      if (!(width > 0) || !(height > 0)) {
        continue;
      }

      // Use the PDF's specified font size
      const fontSize = item.fontSize ?? 12;
      context.font = this.composeFont(item.font, fontSize, options.fontFallback, item.fontWeight, item.fontStyle);

      const textPlacement = this.resolveTextPlacement(item, projectPoint, options.scale);
      const projectedWidth = textPlacement.projectedWidth;
      const measuredWidth = context.measureText(item.text).width;

      // Scale horizontally to fit width
      let scaleX = 1;
      if (measuredWidth > 0 && projectedWidth > 0) {
        scaleX = projectedWidth / measuredWidth;
      }

      const overlapsImage = this.intersectsAnyImage(item.bounds, page.imageItems);
      if (overlapsImage) {
        const padding = 0.5;
        const paddedCorners = [
          projectPoint(item.bounds.minX - padding, item.bounds.minY - padding),
          projectPoint(item.bounds.maxX + padding, item.bounds.minY - padding),
          projectPoint(item.bounds.maxX + padding, item.bounds.maxY + padding),
          projectPoint(item.bounds.minX - padding, item.bounds.maxY + padding)
        ];
        context.save();
        context.beginPath();
        context.moveTo(paddedCorners[0].x, paddedCorners[0].y);
        for (let index = 1; index < paddedCorners.length; index += 1) {
          context.lineTo(paddedCorners[index].x, paddedCorners[index].y);
        }
        context.closePath();
        const previousFill: string | CanvasGradient | CanvasPattern = context.fillStyle;
        context.fillStyle = options.backgroundColor;
        context.fill();
        context.fillStyle = previousFill;
        context.restore();
      }

      // Use Type3 glyph path rendering if available
      if (item.type3Glyphs && item.type3Glyphs.length > 0) {
        this.drawType3TextItem(context, item, projectPoint, options, metrics);
        continue;
      }

      const needsRotation = Math.abs(textPlacement.rotation) > 0.001;
      if (Math.abs(scaleX - 1) > 0.02 || needsRotation) {
        context.save();
        context.translate(textPlacement.baseline.x, textPlacement.baseline.y);
        if (needsRotation) {
          context.rotate(textPlacement.rotation);
        }
        context.scale(scaleX, 1);
        context.fillText(item.text, 0, 0);
        context.restore();
      } else {
        context.fillText(item.text, textPlacement.baseline.x, textPlacement.baseline.y);
      }
    }

    context.restore();
  }

  private resolveTextPlacement(
    item: PDFTextItem,
    projectPoint: (x: number, y: number) => { x: number; y: number },
    scale: number
  ): { baseline: { x: number; y: number }; projectedWidth: number; rotation: number } {
    const width = item.bounds.maxX - item.bounds.minX;
    const height = item.bounds.maxY - item.bounds.minY;
    const fallbackBaseline = projectPoint(item.bounds.minX, item.bounds.minY + height * 0.25);

    if (!item.baselineStart || !item.baselineEnd) {
      return {
        baseline: fallbackBaseline,
        projectedWidth: width * scale,
        rotation: 0
      };
    }

    const baselineStart = projectPoint(item.baselineStart.x, item.baselineStart.y);
    const baselineEnd = projectPoint(item.baselineEnd.x, item.baselineEnd.y);
    const directionX = baselineEnd.x - baselineStart.x;
    const directionY = baselineEnd.y - baselineStart.y;
    const projectedWidth = Math.hypot(directionX, directionY);
    if (!(projectedWidth > 0.01)) {
      return {
        baseline: fallbackBaseline,
        projectedWidth: width * scale,
        rotation: 0
      };
    }

    return {
      baseline: baselineStart,
      projectedWidth,
      rotation: Math.atan2(directionY, directionX)
    };
  }

  private drawType3TextItem(
    context: CanvasRenderingContext2D,
    item: PDFTextItem,
    projectPoint: (x: number, y: number) => { x: number; y: number },
    options: Required<RenderOptions>,
    metrics: PageMetrics
  ): void {
    const glyphs = item.type3Glyphs;
    if (!glyphs || glyphs.length === 0) {
      return;
    }

    const boundsWidth = item.bounds.maxX - item.bounds.minX;
    const boundsHeight = item.bounds.maxY - item.bounds.minY;
    if (boundsHeight <= 0) {
      return;
    }

    // The bounds height encodes the text matrix scale factor (e.g. 7.995 for this font).
    // Glyph coordinates are in font units (em-square typically 0-1 range).
    // The scale factor converts font units to page-space units.
    const glyphScale = boundsHeight * options.scale;

    // Each glyph advances by its share of the bounds width (from /Widths, not d0).
    const advancePerGlyph = glyphs.length > 0
      ? (boundsWidth * options.scale) / glyphs.length
      : 0;

    // Position at the vertical center of the bounds in page space.
    const centerY = (item.bounds.minY + item.bounds.maxY) / 2;
    const originLeft = projectPoint(item.bounds.minX, centerY);

    context.save();
    context.translate(originLeft.x, originLeft.y);

    let cursorX = 0;

    for (const glyph of glyphs) {
      if (glyph.pathCommands.length === 0) {
        cursorX += advancePerGlyph;
        continue;
      }

      // Compute visual bounding box of this glyph from its path commands
      let gxMin = Infinity, gxMax = -Infinity;
      let gyMin = Infinity, gyMax = -Infinity;
      for (const cmd of glyph.pathCommands) {
        if ('x' in cmd && typeof cmd.x === 'number') { gxMin = Math.min(gxMin, cmd.x); gxMax = Math.max(gxMax, cmd.x); }
        if ('x1' in cmd && typeof cmd.x1 === 'number') { gxMin = Math.min(gxMin, cmd.x1); gxMax = Math.max(gxMax, cmd.x1); }
        if ('x2' in cmd && typeof cmd.x2 === 'number') { gxMin = Math.min(gxMin, cmd.x2); gxMax = Math.max(gxMax, cmd.x2); }
        if ('x3' in cmd && typeof cmd.x3 === 'number') { gxMin = Math.min(gxMin, cmd.x3); gxMax = Math.max(gxMax, cmd.x3); }
        if ('y' in cmd && typeof cmd.y === 'number') { gyMin = Math.min(gyMin, cmd.y); gyMax = Math.max(gyMax, cmd.y); }
        if ('y1' in cmd && typeof cmd.y1 === 'number') { gyMin = Math.min(gyMin, cmd.y1); gyMax = Math.max(gyMax, cmd.y1); }
        if ('y2' in cmd && typeof cmd.y2 === 'number') { gyMin = Math.min(gyMin, cmd.y2); gyMax = Math.max(gyMax, cmd.y2); }
        if ('y3' in cmd && typeof cmd.y3 === 'number') { gyMin = Math.min(gyMin, cmd.y3); gyMax = Math.max(gyMax, cmd.y3); }
      }

      if (gxMin === Infinity || gyMin === Infinity) {
        cursorX += advancePerGlyph;
        continue;
      }

      // Center the glyph both horizontally and vertically within its advance slot.
      // Many Type3 glyphs have their paths offset from origin (e.g. negative X coords),
      // so we shift the glyph so its visual center sits at the center of the advance width.
      const glyphVisualWidth = gxMax - gxMin;
      const glyphCenterX = (gxMin + gxMax) / 2;
      const glyphCenterY = (gyMin + gyMax) / 2;

      // The advance slot in canvas pixels for this glyph
      const slotCenterX = advancePerGlyph / 2;

      context.save();
      // Position at the horizontal center of this glyph's advance slot
      context.translate(cursorX + slotCenterX, 0);
      // Scale: X stays as-is, Y is negated to flip from PDF coords to canvas coords.
      context.scale(glyphScale, -glyphScale);
      // Shift glyph so its visual center is at the origin (which is the slot center)
      context.translate(-glyphCenterX, -glyphCenterY);

      this.drawGlyphPaths(context, glyph);

      context.restore();
      cursorX += advancePerGlyph;
    }

    context.restore();
  }

  private drawGlyphPaths(context: CanvasRenderingContext2D, glyph: Type3Glyph): void {
    if (glyph.pathCommands.length === 0) {
      return;
    }

    context.beginPath();

    for (const cmd of glyph.pathCommands) {
      switch (cmd.op) {
        case 'M':
          context.moveTo(cmd.x, cmd.y);
          break;
        case 'L':
          context.lineTo(cmd.x, cmd.y);
          break;
        case 'C':
          context.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x3, cmd.y3);
          break;
        case 'Z':
          context.closePath();
          break;
        case 're':
          context.rect(cmd.x, cmd.y, cmd.w, cmd.h);
          break;
        case 'f':
        case 'f*':
          context.fill(cmd.op === 'f*' ? 'evenodd' : 'nonzero');
          context.beginPath();
          break;
        case 'S':
          context.stroke();
          context.beginPath();
          break;
        case 'B':
          context.fill();
          context.stroke();
          context.beginPath();
          break;
        case 'n':
          // End path without painting
          context.beginPath();
          break;
      }
    }
  }

  private intersectsAnyImage(bounds: PDFImageBounds, images: PDFImageItem[]): boolean {
    return images.some((image) =>
      bounds.maxX > image.bounds.minX &&
      bounds.minX < image.bounds.maxX &&
      bounds.maxY > image.bounds.minY &&
      bounds.minY < image.bounds.maxY
    );
  }

  private composeFont(
    fontName: string | undefined,
    fontSize: number,
    fallback: string,
    fontWeight?: 'normal' | 'bold',
    fontStyle?: 'normal' | 'italic'
  ): string {
    // Use precise font size (CSS supports decimal values) for accurate rendering
    const clampedSize = Math.max(1, fontSize);
    const size = `${clampedSize.toFixed(2)}px`;
    const weight = fontWeight === 'bold' ? 'bold' : '';
    const style = fontStyle === 'italic' ? 'italic' : '';
    const stylePrefix = [style, weight].filter(Boolean).join(' ');

    // Extract just the font family from fallback (remove size prefix like "12px ")
    const fallbackFamily = fallback.replace(/^\d+px\s*/, '');

    if (!fontName) {
      const fontSpec = `${size} ${fallbackFamily}`;
      return stylePrefix ? `${stylePrefix} ${fontSpec}` : fontSpec;
    }
    // CSS font format: [style] [weight] size family1, family2, ...
    const fontSpec = `${size} '${fontName}', ${fallbackFamily}`;
    return stylePrefix ? `${stylePrefix} ${fontSpec}` : fontSpec;
  }
}
