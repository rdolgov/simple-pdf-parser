import type { StructuredDataElement, StructuredBoundsTuple } from '@viewer/htmlStructuredDataRenderer';

type Rect = { left: number; top: number; width: number; height: number };

export function getHeadingLevel(path?: string): number | null {
  if (!path) return null;
  const match = path.match(/H(\d+)/i);
  if (!match) return null;
  const level = Number.parseInt(match[1], 10);
  return Number.isFinite(level) ? level : null;
}

export function findChapterBounds(params: {
  elements: StructuredDataElement[];
  container: HTMLElement;
  startElementId: number;
  startPage: number;
  headingLevel: number;
  pages?: Array<{ page_number?: number; index?: number; width?: number; height?: number }>;
}): Rect | null {
  const { elements, container, startElementId, startPage, headingLevel, pages } = params;
  const ordered = [...elements];
  const startIndex = ordered.findIndex((el) => el.elementId === startElementId);
  if (startIndex === -1) {
    return null;
  }

  let endIndex = ordered.length - 1;
  for (let i = startIndex + 1; i < ordered.length; i += 1) {
    const el = ordered[i];
    const level = getHeadingLevel(el.Path);
    if (level !== null && level <= headingLevel) {
      endIndex = i - 1;
      break;
    }
  }

  const targetElements = ordered.slice(startIndex, endIndex + 1).filter((el) => el.Page === startPage);
  if (targetElements.length === 0) {
    return null;
  }

  const domBounds: Rect[] = [];
  for (const el of targetElements) {
    const domRect = findDomRect(container, el.elementId);
    if (!domRect) {
      continue;
    }
    domBounds.push(domRectToRect(container, domRect));
  }

  if (domBounds.length > 0) {
    return domBounds.reduce((acc, rect) => mergeRects(acc, rect));
  }

  const pageEl = container.querySelector<HTMLElement>(`[data-page-number="${startPage}"]`);
  const pageInfo = pages?.find((p) => (p.page_number ?? p.index) === startPage);
  const scaleX =
    pageEl && pageInfo?.width ? pageEl.getBoundingClientRect().width / pageInfo.width : 1;
  const scaleY =
    pageEl && pageInfo?.height ? pageEl.getBoundingClientRect().height / pageInfo.height : 1;
  const containerRect = container.getBoundingClientRect();
  const pageRect = pageEl?.getBoundingClientRect();
  const offsetLeft = pageRect ? pageRect.left - containerRect.left + container.scrollLeft : 0;
  const offsetTop = pageRect ? pageRect.top - containerRect.top + container.scrollTop : 0;

  let bounds: Rect | null = null;
  for (const el of targetElements) {
    const b = normalizeBoundsFallback(el, pageInfo?.height ?? 0);
    if (!b) {
      continue;
    }
    const rect: Rect = {
      left: offsetLeft + b.left * scaleX,
      top: offsetTop + b.top * scaleY,
      width: b.width * scaleX,
      height: b.height * scaleY
    };
    bounds = bounds ? mergeRects(bounds, rect) : rect;
  }
  return bounds;
}

function findDomRect(container: HTMLElement, elementId?: number | null): DOMRect | null {
  if (!elementId) {
    return null;
  }
  const node = container.querySelector<HTMLElement>(`[data-element-id="${elementId}"]`);
  return node ? node.getBoundingClientRect() : null;
}

function domRectToRect(container: HTMLElement, rect: DOMRect): Rect {
  const containerRect = container.getBoundingClientRect();
  return {
    left: rect.left - containerRect.left + container.scrollLeft,
    top: rect.top - containerRect.top + container.scrollTop,
    width: rect.width,
    height: rect.height
  };
}

function mergeRects(a: Rect, b: Rect): Rect {
  const minLeft = Math.min(a.left, b.left);
  const minTop = Math.min(a.top, b.top);
  const maxRight = Math.max(a.left + a.width, b.left + b.width);
  const maxBottom = Math.max(a.top + a.height, b.top + b.height);
  return {
    left: minLeft,
    top: minTop,
    width: maxRight - minLeft,
    height: maxBottom - minTop
  };
}

function normalizeBoundsFallback(element: StructuredDataElement, pageHeight: number): Rect | null {
  const bounds = (element.Bounds ?? element.attributes?.BBox) as StructuredBoundsTuple | undefined;
  if (!bounds || bounds.length !== 4) {
    return null;
  }
  const [minX, minY, maxX, maxY] = bounds;
  const width = maxX - minX;
  const height = maxY - minY;
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  return {
    left: minX,
    top: Math.max(0, (pageHeight || maxY) - maxY),
    width: Math.max(1, width),
    height: Math.max(1, height)
  };
}

export function collectChapterText(params: {
  elements: StructuredDataElement[];
  startElementId: number;
  headingLevel: number;
  startPage: number;
}): string {
  const { elements, startElementId, headingLevel, startPage } = params;
  const blocks = collectChapterBlocks({ elements, startElementId, headingLevel, startPage });
  return blocks.map((b) => b.text).join(' ');
}

export function collectChapterBlocks(params: {
  elements: StructuredDataElement[];
  startElementId: number;
  headingLevel: number;
  startPage: number;
}): Array<{ type: 'heading' | 'text'; text: string }> {
  const { elements, startElementId, headingLevel, startPage } = params;
  const ordered = [...elements];
  const startIndex = ordered.findIndex((el) => el.elementId === startElementId);
  if (startIndex === -1) {
    return [];
  }
  let endIndex = ordered.length - 1;
  for (let i = startIndex + 1; i < ordered.length; i += 1) {
    const el = ordered[i];
    const level = getHeadingLevel(el.Path);
    if (level !== null && level <= headingLevel) {
      endIndex = i - 1;
      break;
    }
  }
  const targetElements = ordered.slice(startIndex, endIndex + 1).filter((el) => el.Page === startPage);
  const blocks: Array<{ type: 'heading' | 'text'; text: string }> = [];
  for (const el of targetElements) {
    if (typeof el.Text === 'string' && el.Text.trim().length > 0) {
      const level = getHeadingLevel(el.Path);
      blocks.push({
        type: level !== null ? 'heading' : 'text',
        text: el.Text.trim()
      });
    }
  }
  return blocks;
}
