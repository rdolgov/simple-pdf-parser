import type {
  HtmlContentBlock,
  HtmlDocumentLayout,
  HtmlHeadingBlock,
  HtmlImageBlock,
  HtmlLine,
  HtmlPageLayout,
  HtmlParagraphBlock,
  HtmlTableBlock,
  HtmlTableCell,
  HtmlTableRow,
  HtmlTextSpan
} from './htmlLayoutConverter.js';

export interface HtmlRendererOptions {
  scale?: number;
  pageGap?: number;
  documentClassName?: string;
  pageClassName?: string;
  pageSeparatorClassName?: string;
  blockClassPrefix?: string;
  blockClassNames?: Partial<Record<HtmlContentBlock['type'], string>>;
  includeDebugAttributes?: boolean;
  positioning?: 'flow' | 'absolute';
  flowSpacingMultiplier?: number;
}

type NormalizedRendererOptions = Required<Omit<HtmlRendererOptions, 'blockClassNames'>> & {
  blockClassNames: Partial<Record<HtmlContentBlock['type'], string>>;
};

const DEFAULT_RENDER_OPTIONS: NormalizedRendererOptions = {
  scale: 1,
  pageGap: 24,
  documentClassName: 'pdf-html-document',
  pageClassName: 'pdf-html-page',
  pageSeparatorClassName: 'pdf-html-page-separator',
  blockClassPrefix: 'pdf-html-block',
  blockClassNames: {},
  includeDebugAttributes: false,
  positioning: 'flow',
  flowSpacingMultiplier: 0.5
};

const imageSourceCache = new WeakMap<HtmlImageBlock['image'], string>();

export function renderHtmlLayout(
  target: HTMLElement,
  layout: HtmlDocumentLayout,
  options: HtmlRendererOptions = {}
): void {
  const doc = target.ownerDocument ?? (typeof document !== 'undefined' ? document : undefined);
  if (!doc) {
    throw new Error('renderHtmlLayout requires a DOM environment.');
  }

  const config = normalizeOptions(options);
  const fragment = doc.createDocumentFragment();

  target.classList.add(config.documentClassName);
  target.replaceChildren();

  layout.pages.forEach((page, index) => {
    const pageElement = createPageElement(page, config, doc);
    fragment.append(pageElement);
    const isLast = index === layout.pages.length - 1;
    if (config.positioning === 'flow') {
      if (!isLast) {
        const separator = createFlowSeparator(config, doc);
        fragment.append(separator);
      }
    } else if (!isLast && config.pageGap > 0) {
      const spacer = doc.createElement('div');
      spacer.style.height = `${config.pageGap * config.scale}px`;
      spacer.style.width = '100%';
      spacer.style.pointerEvents = 'none';
      spacer.style.display = 'block';
      fragment.append(spacer);
    }
  });

  target.append(fragment);
}

function normalizeOptions(options: HtmlRendererOptions): NormalizedRendererOptions {
  return {
    ...DEFAULT_RENDER_OPTIONS,
    ...options,
    blockClassNames: {
      ...DEFAULT_RENDER_OPTIONS.blockClassNames,
      ...(options.blockClassNames ?? {})
    }
  };
}

function createPageElement(page: HtmlPageLayout, config: NormalizedRendererOptions, doc: Document): HTMLElement {
  const pageElement = doc.createElement('div');
  pageElement.classList.add(config.pageClassName);
  pageElement.style.position = 'relative';
  pageElement.dataset.pageNumber = String(page.number);
  pageElement.style.display = 'flex';
  pageElement.style.flexDirection = 'column';
  pageElement.style.alignItems = 'stretch';
  pageElement.style.boxSizing = 'border-box';
  pageElement.style.gap = '0';

  if (config.positioning === 'absolute') {
    pageElement.style.background = '#ffffff';
    pageElement.style.boxShadow = '0 12px 32px rgba(15, 23, 42, 0.12)';
    pageElement.style.border = '1px solid rgba(99, 110, 123, 0.25)';
    pageElement.style.width = `${page.width * config.scale}px`;
    pageElement.style.height = `${page.height * config.scale}px`;
    pageElement.style.padding = '0';
    pageElement.style.overflow = 'hidden';
  } else {
    pageElement.style.background = 'transparent';
    pageElement.style.border = 'none';
    pageElement.style.boxShadow = 'none';
    pageElement.style.width = '100%';
    pageElement.style.maxWidth = `${page.width * config.scale}px`;
    pageElement.style.height = 'auto';
    pageElement.style.padding = '0';
  }

  page.content.forEach((block, blockIndex) => {
    const blockElement = createBlockElement(block, page, config, doc);
    blockElement.dataset.blockIndex = String(blockIndex);
    blockElement.dataset.pageNumber = String(page.number);
    pageElement.append(blockElement);
  });

  return pageElement;
}

function createFlowSeparator(config: NormalizedRendererOptions, doc: Document): HTMLElement {
  const separator = doc.createElement('div');
  separator.classList.add(config.pageSeparatorClassName);
  separator.style.width = '100%';
  separator.style.height = '1px';
  separator.style.margin = `${Math.max(32 * config.scale, 24)}px 0`;
  separator.style.background =
    'linear-gradient(90deg, rgba(148, 163, 184, 0) 0%, rgba(148, 163, 184, 0.5) 50%, rgba(148, 163, 184, 0) 100%)';
  separator.style.pointerEvents = 'none';
  return separator;
}

function createBlockElement(
  block: HtmlContentBlock,
  page: HtmlPageLayout,
  config: NormalizedRendererOptions,
  doc: Document
): HTMLElement {
  switch (block.type) {
    case 'paragraph':
      return createParagraphElement(block, page, config, doc);
    case 'heading':
      return createHeadingElement(block, page, config, doc);
    case 'table':
      return createTableElement(block, page, config, doc);
    case 'image':
      return createImageElement(block, page, config, doc);
    default:
      return createFallbackElement(block, page, config, doc);
  }
}

function createParagraphElement(
  block: HtmlParagraphBlock,
  page: HtmlPageLayout,
  config: NormalizedRendererOptions,
  doc: Document
): HTMLElement {
  const element = doc.createElement('p');
  element.textContent = block.lines.map((line) => line.text.trimEnd()).join('\n');
  element.style.margin = '0';
  element.style.whiteSpace = 'pre-wrap';
  element.style.wordBreak = 'break-word';
  element.style.color = '#111827';
  applyTextStyles(element, block.lines, block.spans, config);
  applyBlockClasses(element, block, config);
  applyBlockBounds(element, block.bounds, page, config);
  addDebugAttributes(element, block, config);
  return element;
}

function createHeadingElement(
  block: HtmlHeadingBlock,
  page: HtmlPageLayout,
  config: NormalizedRendererOptions,
  doc: Document
): HTMLElement {
  const level = Math.min(Math.max(block.level, 1), 6);
  const element = doc.createElement(`h${level}`) as HTMLHeadingElement;
  element.textContent = block.lines.map((line) => line.text.trim()).join(' ');
  element.style.margin = '0';
  element.style.whiteSpace = 'pre-wrap';
  element.style.wordBreak = 'break-word';
  element.style.fontWeight = '600';
  element.style.color = '#0f172a';
  applyTextStyles(element, block.lines, block.spans, config, 1.05);
  applyBlockClasses(element, block, config, `level-${level}`);
  applyBlockBounds(element, block.bounds, page, config);
  addDebugAttributes(element, block, config);
  return element;
}

function createTableElement(
  block: HtmlTableBlock,
  page: HtmlPageLayout,
  config: NormalizedRendererOptions,
  doc: Document
): HTMLElement {
  const table = doc.createElement('table');
  table.style.borderCollapse = 'collapse';
  table.style.width = '100%';
  table.style.tableLayout = 'fixed';
  table.style.fontSize = `${12 * config.scale}px`;
  table.style.color = '#111827';
  table.style.border = '1px solid rgba(148, 163, 184, 0.6)';

  const columnWidths = config.positioning === 'absolute' ? computeColumnWidths(block.rows) : [];
  if (config.positioning === 'absolute' && columnWidths.length) {
    const colgroup = doc.createElement('colgroup');
    columnWidths.forEach((width) => {
      const col = doc.createElement('col');
      col.style.width = `${Math.max(width, 0.1) * config.scale}px`;
      colgroup.append(col);
    });
    table.append(colgroup);
  }

  block.rows.forEach((row) => {
    const rowElement = doc.createElement('tr');
    const rowHeight = Math.max(row.bounds.maxY - row.bounds.minY, 0);
    if (config.positioning === 'absolute') {
      rowElement.style.height = `${rowHeight * config.scale}px`;
    }

    row.cells.forEach((cell, columnIndex) => {
      const cellElement = doc.createElement('td');
      cellElement.textContent = cell.text.trim();
      cellElement.style.border = '1px solid rgba(148, 163, 184, 0.6)';
      cellElement.style.padding = `${Math.max(2 * config.scale, 2)}px`;
      cellElement.style.verticalAlign = 'top';
      cellElement.style.whiteSpace = 'pre-wrap';
      applyCellTypography(cellElement, cell, config);
      if (config.positioning === 'absolute' && columnWidths[columnIndex]) {
        cellElement.style.width = `${columnWidths[columnIndex] * config.scale}px`;
      }
      rowElement.append(cellElement);
    });

    table.append(rowElement);
  });

  applyBlockClasses(table, block, config);
  applyBlockBounds(table, block.bounds, page, config);
  addDebugAttributes(table, block, config);
  return table;
}

function createImageElement(
  block: HtmlImageBlock,
  page: HtmlPageLayout,
  config: NormalizedRendererOptions,
  doc: Document
): HTMLElement {
  const figure = doc.createElement('figure');
  figure.style.margin = '0';
  figure.style.padding = '0';
  figure.style.background = block.image.dataUri ? 'transparent' : 'rgba(15, 23, 42, 0.04)';

  const image = doc.createElement('img');
  image.alt = block.image.name ?? 'Embedded Image';
  image.style.display = 'block';
  image.style.maxWidth = '100%';
  image.style.objectFit = 'contain';
  image.style.width = '100%';
  image.style.height = config.positioning === 'absolute' ? '100%' : 'auto';

  const source = resolveImageSource(block.image, doc);
  if (source) {
    image.src = source;
  } else {
    image.dataset.placeholder = 'true';
  }

  figure.append(image);
  applyBlockClasses(figure, block, config);
  applyBlockBounds(figure, block.bounds, page, config);

  if (config.positioning === 'absolute') {
    figure.style.display = 'flex';
    figure.style.alignItems = 'center';
    figure.style.justifyContent = 'center';
  } else {
    const width = Math.max(block.bounds.maxX - block.bounds.minX, 0) * config.scale;
    const height = Math.max(block.bounds.maxY - block.bounds.minY, 0) * config.scale;
    const maxWidth = page.width * config.scale;
    const targetWidth = width > 0 ? Math.min(width, maxWidth) : maxWidth;
    figure.style.display = 'block';
    figure.style.alignSelf = 'center';
    figure.style.width = `${targetWidth}px`;
    figure.style.maxWidth = `${maxWidth}px`;
    figure.style.height = 'auto';
    figure.style.textAlign = 'center';
    image.style.height = 'auto';
    if (width > 0 && height > 0) {
      figure.style.aspectRatio = `${Math.max(width, 1)} / ${Math.max(height, 1)}`;
    } else {
      figure.style.removeProperty('aspect-ratio');
    }
  }

  addDebugAttributes(figure, block, config);
  return figure;
}

function resolveImageSource(image: HtmlImageBlock['image'], doc: Document): string | undefined {
  if (image.dataUri) {
    return image.dataUri;
  }
  const cached = imageSourceCache.get(image);
  if (cached) {
    return cached;
  }
  const pixels = image.pixels;
  if (!pixels) {
    return undefined;
  }

  const canvas = doc.createElement('canvas');
  canvas.width = Math.max(pixels.width, 1);
  canvas.height = Math.max(pixels.height, 1);
  const context = canvas.getContext('2d');
  if (!context) {
    return undefined;
  }

  const imageData = context.createImageData(canvas.width, canvas.height);
  imageData.data.set(pixels.data);
  context.putImageData(imageData, 0, 0);
  const dataUrl = canvas.toDataURL('image/png');
  imageSourceCache.set(image, dataUrl);
  return dataUrl;
}

function createFallbackElement(
  block: HtmlContentBlock,
  page: HtmlPageLayout,
  config: NormalizedRendererOptions,
  doc: Document
): HTMLElement {
  const element = doc.createElement('div');
  element.textContent = 'Unsupported block type';
  element.style.fontSize = `${12 * config.scale}px`;
  element.style.color = '#ef4444';
  element.style.border = '1px dashed rgba(239, 68, 68, 0.6)';
  element.style.display = 'flex';
  element.style.alignItems = 'center';
  element.style.justifyContent = 'center';
  element.style.textAlign = 'center';
  applyBlockClasses(element, block, config);
  applyBlockBounds(element, block.bounds, page, config);
  addDebugAttributes(element, block, config);
  return element;
}

function applyTextStyles(
  element: HTMLElement,
  lines: HtmlLine[],
  spans: HtmlTextSpan[],
  config: NormalizedRendererOptions,
  fontScale = 1
): void {
  const averageFont = computeAverageFontSize(spans) * fontScale;
  if (Number.isFinite(averageFont) && averageFont > 0) {
    element.style.fontSize = `${averageFont * config.scale}px`;
  }

  const lineHeight = computeAverageLineHeight(lines);
  if (Number.isFinite(lineHeight) && lineHeight > 0) {
    element.style.lineHeight = `${lineHeight * config.scale}px`;
  }

  const fontFamily = findDominantFont(spans);
  if (fontFamily) {
    element.style.fontFamily = fontFamily;
  }
}

function applyCellTypography(element: HTMLElement, cell: HtmlTableCell, config: NormalizedRendererOptions): void {
  const average = computeAverageFontSize(cell.spans);
  if (Number.isFinite(average) && average > 0) {
    element.style.fontSize = `${average * config.scale}px`;
  }
}

function applyBlockBounds(
  element: HTMLElement,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  page: HtmlPageLayout,
  config: NormalizedRendererOptions
): void {
  const width = Math.max(bounds.maxX - bounds.minX, 0);
  const height = Math.max(bounds.maxY - bounds.minY, 0);
  const scale = config.scale;

  if (config.positioning === 'absolute') {
    const top = page.height - bounds.maxY;
    const left = bounds.minX;
    element.style.position = 'absolute';
    element.style.left = `${left * scale}px`;
    element.style.top = `${top * scale}px`;
    element.style.width = `${width * scale}px`;
    element.style.height = `${height * scale}px`;
  } else {
    element.style.position = 'relative';
    element.style.left = '0';
    element.style.top = '0';
    element.style.width = '100%';
    element.style.boxSizing = 'border-box';
    const spacing = Math.min(Math.max(height * scale * config.flowSpacingMultiplier, 8), 32);
    element.style.marginBottom = `${spacing}px`;
    element.style.maxWidth = `${page.width * scale}px`;
  }

  element.style.boxSizing = 'border-box';
}

function applyBlockClasses(
  element: HTMLElement,
  block: HtmlContentBlock,
  config: NormalizedRendererOptions,
  suffix?: string
): void {
  const baseClass = config.blockClassPrefix;
  element.classList.add(baseClass, `${baseClass}--${block.type}`);
  if (suffix) {
    element.classList.add(`${baseClass}--${suffix}`);
  }
  const customClass = config.blockClassNames[block.type];
  if (customClass) {
    element.classList.add(customClass);
  }
}

function addDebugAttributes(
  element: HTMLElement,
  block: HtmlContentBlock,
  config: NormalizedRendererOptions
): void {
  if (!config.includeDebugAttributes) {
    return;
  }
  element.dataset.bounds = JSON.stringify(block.bounds);
  element.dataset.confidence = block.confidence.toFixed(2);
  element.dataset.blockType = block.type;
}

function computeAverageFontSize(spans: HtmlTextSpan[]): number {
  if (spans.length === 0) {
    return 0;
  }
  const total = spans.reduce((sum, span) => sum + getSpanFontSize(span), 0);
  return total / spans.length;
}

function computeAverageLineHeight(lines: HtmlLine[]): number {
  if (lines.length === 0) {
    return 0;
  }
  const total = lines.reduce((sum, line) => sum + Math.max(line.lineHeight, 0), 0);
  return total / lines.length;
}

function findDominantFont(spans: HtmlTextSpan[]): string | undefined {
  const counts = new Map<string, number>();
  for (const span of spans) {
    if (!span.font) {
      continue;
    }
    counts.set(span.font, (counts.get(span.font) ?? 0) + span.text.length);
  }
  let dominant: string | undefined;
  let max = 0;
  counts.forEach((count, font) => {
    if (count > max) {
      dominant = font;
      max = count;
    }
  });
  return dominant;
}

function computeColumnWidths(rows: HtmlTableRow[]): number[] {
  const widths: number[] = [];
  rows.forEach((row) => {
    row.cells.forEach((cell, index) => {
      const width = Math.max(cell.bounds.maxX - cell.bounds.minX, 0);
      widths[index] = Math.max(widths[index] ?? 0, width);
    });
  });
  return widths;
}

function getSpanFontSize(span: HtmlTextSpan): number {
  if (span.fontSize !== undefined) {
    return span.fontSize;
  }
  const height = Math.abs(span.bounds.maxY - span.bounds.minY);
  return height > 0 ? height : 12;
}
