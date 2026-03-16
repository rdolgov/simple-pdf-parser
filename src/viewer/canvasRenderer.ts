import type {
  PDFImageBounds,
  PDFImageItem,
  PDFPage,
  PDFPathCommand,
  PDFPathItem,
  PDFTextItem,
  Type3Glyph,
  Type3GlyphImageLayer
} from '../types.js';
import type { PDFDocument } from '../pdfDocument.js';
import { detectCmexComposites, type CmexComposite } from './cmexComposite.js';
import { resolveCanvasFontFallback } from './fontFallback.js';

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

type VerticalTextFit = {
  scaleY: number;
  localYOffset: number;
};

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

    const deviceScale = this.currentScale * dpr;

    this.drawBackground(context, metrics, renderOptions);
    if (page.pathItems && page.pathItems.length > 0) {
      this.drawPathItems(context, page, metrics, renderOptions, deviceScale);
    } else {
      this.drawRects(context, page, metrics, renderOptions, deviceScale);
      this.drawLines(context, page, metrics, renderOptions, deviceScale);
    }
    this.drawImages(context, page, metrics, renderOptions, deviceScale);
    this.drawImagePlaceholders(context, page, metrics, renderOptions);
    this.drawTextItems(context, page, metrics, renderOptions, deviceScale);

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
    _options: Required<RenderOptions>,
    deviceScale: number
  ): void {
    if (!page.lineItems || page.lineItems.length === 0) {
      return;
    }

    context.save();

    for (const line of page.lineItems) {
      const [r, g, b, a] = line.strokeColor;
      context.strokeStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
      context.lineWidth = this.resolveStrokeWidth(line.lineWidth, deviceScale);
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

  private drawPathItems(
    context: CanvasRenderingContext2D,
    page: PDFPage,
    metrics: ReturnType<CanvasRenderer['computePageMetrics']>,
    _options: Required<RenderOptions>,
    deviceScale: number
  ): void {
    if (!page.pathItems || page.pathItems.length === 0) {
      return;
    }

    context.save();

    for (const path of page.pathItems) {
      if (path.commands.length === 0) {
        continue;
      }

      context.beginPath();
      this.tracePagePath(context, path.commands, metrics);

      if (path.fillColor) {
        const [r, g, b, a] = path.fillColor;
        context.fillStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
        context.fill(path.fillRule);
      }

      if (path.strokeColor && path.lineWidth >= 0) {
        const [r, g, b, a] = path.strokeColor;
        context.strokeStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
        context.lineWidth = this.resolveStrokeWidth(path.lineWidth, deviceScale);
        context.lineCap = path.lineCap;
        context.lineJoin = path.lineJoin;
        context.miterLimit = path.miterLimit;
        context.stroke();
      }
    }

    context.restore();
  }

  private drawRects(
    context: CanvasRenderingContext2D,
    page: PDFPage,
    metrics: ReturnType<CanvasRenderer['computePageMetrics']>,
    _options: Required<RenderOptions>,
    deviceScale: number
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
      if (rect.strokeColor && rect.lineWidth >= 0) {
        const [r, g, b, a] = rect.strokeColor;
        context.strokeStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
        context.lineWidth = this.resolveStrokeWidth(rect.lineWidth, deviceScale);
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

        if (!image.mask) {
          continue;
        }

        const mask = image.mask;
        const fill = image.fillColor ?? [0, 0, 0, 1];
        const r = Math.round(fill[0] * 255);
        const g = Math.round(fill[1] * 255);
        const b = Math.round(fill[2] * 255);
        const alpha = Math.round((fill[3] ?? 1) * 255);
        const solidMaskPaint = this.readSolidMaskPaint(mask);

        if (solidMaskPaint === true) {
          context.fillStyle = `rgba(${r}, ${g}, ${b}, ${(fill[3] ?? 1)})`;
          context.fillRect(x, y, width, height);
          continue;
        }

        if (solidMaskPaint === false) {
          continue;
        }

        if (typeof document === 'undefined') {
          continue;
        }

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
      this.drawTextItems(context, page, metrics, options, asyncScale);
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

  private readSolidMaskPaint(mask: NonNullable<PDFImageItem['mask']>): boolean | undefined {
    if (mask.data.length === 0) {
      return false;
    }

    const firstPaint = mask.blackIs1 ? mask.data[0] === 1 : mask.data[0] === 0;
    for (let index = 1; index < mask.data.length; index += 1) {
      const paint = mask.blackIs1 ? mask.data[index] === 1 : mask.data[index] === 0;
      if (paint !== firstPaint) {
        return undefined;
      }
    }

    return firstPaint;
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

  private resolveStrokeWidth(lineWidth: number, deviceScale: number): number {
    const thinStrokeFloor = deviceScale > 0 ? 0.25 / deviceScale : 0.25;
    if (lineWidth > 0) {
      return Math.max(lineWidth, thinStrokeFloor);
    }
    if (deviceScale > 0) {
      return 1 / deviceScale;
    }
    return 1;
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
    options: Required<RenderOptions>,
    deviceScale: number
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

    const cmexComposites = detectCmexComposites(sortedItems);
    this.drawCmexComposites(context, cmexComposites.composites, projectPoint, options);

    for (const [index, item] of sortedItems.entries()) {
      if (cmexComposites.hiddenIndices.has(index)) {
        continue;
      }

      const width = item.bounds.maxX - item.bounds.minX;
      const height = item.bounds.maxY - item.bounds.minY;
      const baselineWidth = item.baselineStart && item.baselineEnd
        ? Math.hypot(item.baselineEnd.x - item.baselineStart.x, item.baselineEnd.y - item.baselineStart.y)
        : 0;
      const hasRenderableType3Glyph =
        Boolean(item.type3Glyphs) && item.type3Glyphs!.some((glyph) => Boolean(this.measureType3GlyphBounds(glyph)));
      if (!(height > 0) || (!(width > 0) && !(baselineWidth > 0.01) && !hasRenderableType3Glyph)) {
        continue;
      }

      // Use the PDF's specified font size
      const fontSize = item.fontSize ?? 12;
      context.font = this.composeFont(item.font, fontSize, options.fontFallback, item.fontWeight, item.fontStyle);

      const textPlacement = this.resolveTextPlacement(item, projectPoint, options.scale);
      const projectedWidth = textPlacement.projectedWidth;
      const textMetrics = context.measureText(item.text);
      const measuredWidth = textMetrics.width;
      const verticalFit = this.resolveVerticalTextFit(item, textMetrics, textPlacement.rotation, options.scale);

      // Scale horizontally to fit width
      let scaleX = 1;
      if (measuredWidth > 0 && projectedWidth > 0) {
        scaleX = projectedWidth / measuredWidth;
      }
      const scaleY = verticalFit.scaleY;

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
      const needsVerticalFit = Math.abs(scaleY - 1) > 0.02 || Math.abs(verticalFit.localYOffset) > 0.01;
      if (Math.abs(scaleX - 1) > 0.02 || needsRotation || needsVerticalFit) {
        context.save();
        context.translate(textPlacement.baseline.x, textPlacement.baseline.y);
        if (needsRotation) {
          context.rotate(textPlacement.rotation);
        }
        context.scale(scaleX, scaleY);
        context.fillText(item.text, 0, verticalFit.localYOffset);
        context.restore();
      } else {
        context.fillText(item.text, textPlacement.baseline.x, textPlacement.baseline.y);
      }
    }

    context.restore();
  }

  private drawCmexComposites(
    context: CanvasRenderingContext2D,
    composites: CmexComposite[],
    projectPoint: (x: number, y: number) => { x: number; y: number },
    options: Required<RenderOptions>
  ): void {
    if (composites.length === 0) {
      return;
    }

    context.save();
    context.strokeStyle = options.textColor;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    for (const composite of composites) {
      const left = projectPoint(composite.minX, composite.centerY);
      const right = projectPoint(composite.maxX, composite.centerY);
      const targetWidth = Math.max(1, Math.abs(right.x - left.x));
      const targetHeight = Math.max(1, composite.targetHeight * options.scale * 0.72);
      const leftX = Math.min(left.x, right.x);
      const centerY = left.y;

      context.beginPath();
      this.traceCmexBracePath(context, composite.kind, leftX, centerY, targetWidth, targetHeight);
      context.lineWidth = Math.max(composite.fontSize * options.scale * 0.045, 0.6);
      context.stroke();
    }

    context.restore();
  }

  private traceCmexBracePath(
    context: CanvasRenderingContext2D,
    kind: CmexComposite['kind'],
    leftX: number,
    centerY: number,
    width: number,
    height: number
  ): void {
    const rightX = leftX + width;
    const middleX = leftX + width / 2;
    const direction = kind === 'overbrace' ? 1 : -1;
    const shoulderY = centerY - direction * height * 0.44;
    const endY = centerY - direction * height * 0.1;
    const cuspY = centerY + direction * height * 0.42;
    const leftInnerX = leftX + width * 0.14;
    const rightInnerX = rightX - width * 0.14;
    const leftCurveX = leftX + width * 0.28;
    const rightCurveX = rightX - width * 0.28;

    context.moveTo(leftX, endY);
    context.bezierCurveTo(
      leftX + width * 0.03,
      endY,
      leftX + width * 0.06,
      shoulderY,
      leftInnerX,
      shoulderY
    );
    context.bezierCurveTo(
      leftCurveX,
      shoulderY,
      middleX - width * 0.08,
      endY,
      middleX,
      cuspY
    );
    context.bezierCurveTo(
      middleX + width * 0.08,
      endY,
      rightCurveX,
      shoulderY,
      rightInnerX,
      shoulderY
    );
    context.bezierCurveTo(
      rightX - width * 0.06,
      shoulderY,
      rightX - width * 0.03,
      endY,
      rightX,
      endY
    );
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
    if (this.shouldSkipSuspiciousType3Whitespace(item, boundsWidth, boundsHeight)) {
      return;
    }

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

    const originY = item.baselineStart?.y ?? ((item.bounds.minY + item.bounds.maxY) / 2);
    const originLeft = projectPoint(item.bounds.minX, originY);

    context.save();
    context.translate(originLeft.x, originLeft.y);

    let cursorX = 0;

    for (const glyph of glyphs) {
      if (glyph.pathCommands.length === 0 && (!glyph.imageLayers || glyph.imageLayers.length === 0)) {
        cursorX += advancePerGlyph;
        continue;
      }

      const glyphBounds = this.measureType3GlyphBounds(glyph);
      if (!glyphBounds) {
        cursorX += advancePerGlyph;
        continue;
      }

      context.save();
      if (advancePerGlyph > 0.01) {
        const glyphCenterX = (glyphBounds.minX + glyphBounds.maxX) / 2;
        const slotCenterX = advancePerGlyph / 2;
        context.translate(cursorX + slotCenterX, 0);
        context.scale(glyphScale, -glyphScale);
        context.translate(-glyphCenterX, 0);
      } else {
        context.translate(cursorX, 0);
        context.scale(glyphScale, -glyphScale);
      }

      this.drawGlyphImageLayers(context, glyph.imageLayers);
      this.drawGlyphPaths(context, glyph);

      context.restore();
      cursorX += advancePerGlyph;
    }

    context.restore();
  }

  private shouldSkipSuspiciousType3Whitespace(
    item: PDFTextItem,
    boundsWidth: number,
    boundsHeight: number
  ): boolean {
    if (!(boundsHeight > 0) || item.type3Glyphs?.length !== 1) {
      return false;
    }

    if (item.text.trim().length > 0) {
      return false;
    }

    return boundsWidth > boundsHeight * 12;
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

  private measureType3GlyphBounds(glyph: Type3Glyph): PDFImageBounds | undefined {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const cmd of glyph.pathCommands) {
      if ('x' in cmd && typeof cmd.x === 'number') {
        minX = Math.min(minX, cmd.x);
        maxX = Math.max(maxX, cmd.x);
      }
      if ('y' in cmd && typeof cmd.y === 'number') {
        minY = Math.min(minY, cmd.y);
        maxY = Math.max(maxY, cmd.y);
      }
      if ('x1' in cmd && typeof cmd.x1 === 'number') {
        minX = Math.min(minX, cmd.x1);
        maxX = Math.max(maxX, cmd.x1);
      }
      if ('y1' in cmd && typeof cmd.y1 === 'number') {
        minY = Math.min(minY, cmd.y1);
        maxY = Math.max(maxY, cmd.y1);
      }
      if ('x2' in cmd && typeof cmd.x2 === 'number') {
        minX = Math.min(minX, cmd.x2);
        maxX = Math.max(maxX, cmd.x2);
      }
      if ('y2' in cmd && typeof cmd.y2 === 'number') {
        minY = Math.min(minY, cmd.y2);
        maxY = Math.max(maxY, cmd.y2);
      }
      if ('x3' in cmd && typeof cmd.x3 === 'number') {
        minX = Math.min(minX, cmd.x3);
        maxX = Math.max(maxX, cmd.x3);
      }
      if ('y3' in cmd && typeof cmd.y3 === 'number') {
        minY = Math.min(minY, cmd.y3);
        maxY = Math.max(maxY, cmd.y3);
      }
    }

    for (const layer of glyph.imageLayers ?? []) {
      minX = Math.min(minX, layer.bounds.minX);
      minY = Math.min(minY, layer.bounds.minY);
      maxX = Math.max(maxX, layer.bounds.maxX);
      maxY = Math.max(maxY, layer.bounds.maxY);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return undefined;
    }

    return { minX, minY, maxX, maxY };
  }

  private drawGlyphImageLayers(
    context: CanvasRenderingContext2D,
    imageLayers: Type3GlyphImageLayer[] | undefined
  ): void {
    if (!imageLayers || imageLayers.length === 0) {
      return;
    }

    for (const layer of imageLayers) {
      const width = layer.bounds.maxX - layer.bounds.minX;
      const height = layer.bounds.maxY - layer.bounds.minY;
      if (!(width > 0) || !(height > 0)) {
        continue;
      }

      const x = layer.bounds.minX;
      const y = layer.bounds.minY;

      if (layer.mask) {
        const fill = layer.fillColor ?? [0, 0, 0, 1];
        const r = Math.round(fill[0] * 255);
        const g = Math.round(fill[1] * 255);
        const b = Math.round(fill[2] * 255);
        const alpha = Math.round((fill[3] ?? 1) * 255);
        const solidMaskPaint = this.readSolidMaskPaint(layer.mask);

        if (solidMaskPaint === true) {
          context.fillStyle = `rgba(${r}, ${g}, ${b}, ${(fill[3] ?? 1)})`;
          context.fillRect(x, y, width, height);
          continue;
        }

        if (solidMaskPaint === false || typeof document === 'undefined') {
          continue;
        }

        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = layer.mask.width;
        maskCanvas.height = layer.mask.height;
        const maskContext = maskCanvas.getContext('2d');
        if (!maskContext) {
          continue;
        }

        const imageData = maskContext.createImageData(layer.mask.width, layer.mask.height);
        const pixels = imageData.data;
        for (let index = 0; index < layer.mask.data.length; index += 1) {
          const paint = layer.mask.blackIs1 ? layer.mask.data[index] === 1 : layer.mask.data[index] === 0;
          const offset = index * 4;
          if (paint) {
            pixels[offset] = r;
            pixels[offset + 1] = g;
            pixels[offset + 2] = b;
            pixels[offset + 3] = alpha;
          }
        }

        maskContext.putImageData(imageData, 0, 0);
        context.drawImage(maskCanvas, x, y, width, height);
        continue;
      }

      if (layer.pixels && typeof document !== 'undefined') {
        const bufferCanvas = document.createElement('canvas');
        bufferCanvas.width = layer.pixels.width;
        bufferCanvas.height = layer.pixels.height;
        const bufferContext = bufferCanvas.getContext('2d');
        if (!bufferContext) {
          continue;
        }

        const imageData = bufferContext.createImageData(layer.pixels.width, layer.pixels.height);
        imageData.data.set(layer.pixels.data);
        bufferContext.putImageData(imageData, 0, 0);
        context.drawImage(bufferCanvas, x, y, width, height);
      }
    }
  }

  private tracePagePath(
    context: CanvasRenderingContext2D,
    commands: PDFPathCommand[],
    metrics: ReturnType<CanvasRenderer['computePageMetrics']>
  ): void {
    for (const command of commands) {
      switch (command.op) {
        case 'M':
          context.moveTo(this.pageXToCanvas(command.x, metrics), this.pageYToCanvas(command.y, metrics));
          break;
        case 'L':
          context.lineTo(this.pageXToCanvas(command.x, metrics), this.pageYToCanvas(command.y, metrics));
          break;
        case 'C':
          context.bezierCurveTo(
            this.pageXToCanvas(command.x1, metrics),
            this.pageYToCanvas(command.y1, metrics),
            this.pageXToCanvas(command.x2, metrics),
            this.pageYToCanvas(command.y2, metrics),
            this.pageXToCanvas(command.x3, metrics),
            this.pageYToCanvas(command.y3, metrics)
          );
          break;
        case 'Z':
          context.closePath();
          break;
      }
    }
  }

  private pageXToCanvas(x: number, metrics: ReturnType<CanvasRenderer['computePageMetrics']>): number {
    return metrics.offsetX + x;
  }

  private pageYToCanvas(y: number, metrics: ReturnType<CanvasRenderer['computePageMetrics']>): number {
    return metrics.orientation === 'ascending' ? metrics.offsetY + y : metrics.offsetY - y;
  }

  private resolveVerticalTextFit(
    item: PDFTextItem,
    textMetrics: TextMetrics,
    rotation: number,
    scale: number
  ): VerticalTextFit {
    if (Math.abs(rotation) > 0.001) {
      return { scaleY: 1, localYOffset: 0 };
    }

    const isStretchyDelimiter = this.isStretchyMathDelimiter(item);
    if (!isStretchyDelimiter && !this.isStretchyMathOperator(item)) {
      return { scaleY: 1, localYOffset: 0 };
    }

    const baselineY = item.baselineStart?.y;
    if (typeof baselineY !== 'number' || !Number.isFinite(baselineY)) {
      return { scaleY: 1, localYOffset: 0 };
    }

    const actualAscent =
      this.readPositiveMetric(textMetrics.actualBoundingBoxAscent) ??
      this.readPositiveMetric(textMetrics.fontBoundingBoxAscent);
    const actualDescent =
      this.readPositiveMetric(textMetrics.actualBoundingBoxDescent) ??
      this.readPositiveMetric(textMetrics.fontBoundingBoxDescent) ??
      0;
    if (actualAscent === undefined) {
      return { scaleY: 1, localYOffset: 0 };
    }

    const desiredAscent = Math.max(0, (item.bounds.maxY - baselineY) * scale);
    const desiredDescent = Math.max(0, (baselineY - item.bounds.minY) * scale);
    const measuredHeight = actualAscent + actualDescent;
    const desiredHeight = desiredAscent + desiredDescent;
    if (!(measuredHeight > 0) || !(desiredHeight > 0)) {
      return { scaleY: 1, localYOffset: 0 };
    }

    const unclampedScaleY = desiredHeight / measuredHeight;
    const maxScaleY = isStretchyDelimiter ? 3.5 : 1.15;
    const scaleY = Math.min(Math.max(unclampedScaleY, 0.85), maxScaleY);
    const yOffset = scaleY * actualAscent - desiredAscent;

    return {
      scaleY,
      localYOffset: scaleY !== 0 ? yOffset / scaleY : 0
    };
  }

  private isStretchyMathOperator(item: PDFTextItem): boolean {
    return /(cmsy|cmex)/i.test(item.font ?? '') && /[√∑∈∞∗∏∫⋃⋂⋁⋀]/.test(item.text);
  }

  private isStretchyMathDelimiter(item: PDFTextItem): boolean {
    return /cmex/i.test(item.font ?? '') && /^[()[\]{}|]$/.test(item.text.trim());
  }

  private readPositiveMetric(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return undefined;
    }
    return value;
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
    const clampedSize = Math.max(1, fontSize);
    const size = `${clampedSize.toFixed(2)}px`;
    const weight = fontWeight === 'bold' ? 'bold' : '';
    const style = fontStyle === 'italic' ? 'italic' : '';
    const stylePrefix = [style, weight].filter(Boolean).join(' ');
    const fallbackFamily = resolveCanvasFontFallback(fontName, fallback);

    if (!fontName) {
      const fontSpec = `${size} ${fallbackFamily}`;
      return stylePrefix ? `${stylePrefix} ${fontSpec}` : fontSpec;
    }
    const fontSpec = `${size} '${fontName}', ${fallbackFamily}`;
    return stylePrefix ? `${stylePrefix} ${fontSpec}` : fontSpec;
  }
}
