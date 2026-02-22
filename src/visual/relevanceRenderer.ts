import { renderHtmlLayout, type HtmlRendererOptions } from '../html/htmlRenderer.js';
import type { AnnotatedHtmlDocumentLayout, MatchRange, AnnotatedHtmlContentBlock } from '../query/relevanceTypes.js';
import { collectClassNames, createRelevanceRenderPlan, type RelevanceRenderPlan } from './relevanceTheme.js';

export interface RelevanceRenderOptions {
  animate?: boolean;
  showSummaries?: boolean;
  positioning?: HtmlRendererOptions['positioning'];
  flowSpacingMultiplier?: number;
  pageGap?: number;
}

export function renderRelevanceLayout(
  target: HTMLElement,
  plan: RelevanceRenderPlan,
  options: RelevanceRenderOptions = {}
): void {
  const { positioning = 'flow', flowSpacingMultiplier, pageGap } = options;
  const htmlOptions: HtmlRendererOptions = {
    scale: plan.scale,
    positioning
  };
  if (typeof flowSpacingMultiplier === 'number') {
    htmlOptions.flowSpacingMultiplier = flowSpacingMultiplier;
  }
  if (typeof pageGap === 'number') {
    htmlOptions.pageGap = pageGap;
  }

  renderHtmlLayout(target, plan.layout, htmlOptions);
  target.classList.add('relevance-document');
  if (!options.animate) {
    target.classList.add('relevance-no-animate');
  } else {
    target.classList.remove('relevance-no-animate');
  }

  applyAnnotations(target, plan.layout, plan, options);
}

function applyAnnotations(
  target: HTMLElement,
  layout: AnnotatedHtmlDocumentLayout,
  plan: RelevanceRenderPlan,
  options: RelevanceRenderOptions
) {
  const doc = target.ownerDocument ?? (typeof document !== 'undefined' ? document : undefined);
  if (!doc) {
    return;
  }
  const { theme } = plan;
  const allGroups: CollapseGroup[] = [];
  let activeGroup: CollapseGroup | undefined;
  let collapseGroupCounter = 0;

  const closeActiveGroup = () => {
    if (!activeGroup) {
      return;
    }
    if (activeGroup.blocks.length === 0) {
      activeGroup.toggle.remove();
      const index = allGroups.indexOf(activeGroup);
      if (index >= 0) {
        allGroups.splice(index, 1);
      }
    } else {
      synchronizeGroupControls(activeGroup);
    }
    activeGroup = undefined;
  };

  for (const page of layout.pages) {
    const pageElement = target.querySelector<HTMLElement>(`[data-page-number="${page.number}"]`);
    if (!pageElement) {
      continue;
    }

    page.content.forEach((block, blockIndex) => {
      const blockElement = pageElement.querySelector<HTMLElement>(`[data-block-index="${blockIndex}"]`);
      if (!blockElement) {
        return;
      }
      const state = block.relevance?.state ?? 'dim';
      const classes = collectClassNames(theme, state);
      blockElement.classList.add('relevance-block', ...classes);
      blockElement.dataset.relevanceState = state;

      applyFontStyling(blockElement, block);

      if (options.showSummaries && block.relevance?.summary && state === 'highlight') {
        attachSummary(blockElement, block);
      }
      if (block.relevance?.confidence !== undefined) {
        blockElement.dataset.relevanceConfidence = block.relevance.confidence.toFixed(2);
      }

      if (block.relevance?.matchRanges && block.relevance.matchRanges.length > 0) {
        highlightMatches(blockElement, block.relevance.matchRanges, doc);
      }

      const shouldCollapse = state === 'dim' || state === 'hidden';
      if (!shouldCollapse) {
        closeActiveGroup();
        resetCollapseState(blockElement);
        return;
      }

      if (!blockElement.id) {
        blockElement.id = `relevance-block-${page.number}-${blockIndex}`;
      }

      if (!activeGroup) {
        collapseGroupCounter += 1;
        activeGroup = createCollapseGroup(
          doc,
          pageElement,
          blockElement,
          page.number,
          collapseGroupCounter,
          state
        );
        allGroups.push(activeGroup);
      } else {
        updateGroupState(activeGroup, state);
      }

      assignBlockToGroup(activeGroup, blockElement, block, page.number, blockIndex);
    });
  }

  closeActiveGroup();
  mergeAdjacentGroups(allGroups);
}

function attachSummary(element: HTMLElement, block: AnnotatedHtmlContentBlock): void {
  const summary = block.relevance?.summary;
  if (!summary || element.querySelector('.relevance-summary')) {
    return;
  }

  element.dataset.relevanceSummary = summary;
  delete element.dataset.relevanceRationale;
}

function applyFontStyling(element: HTMLElement, block: AnnotatedHtmlContentBlock): void {
  const spans = gatherSpans(block);
  const candidateSizes = spans
    .map((span) => span.fontSize)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  const fallbackFontSize = 14;
  let computedSize = candidateSizes.length > 0 ? average(candidateSizes) : fallbackFontSize;

  if (computedSize < 6) {
    const heights = spans.flatMap((span) => {
      const bounds = span.bounds;
      if (!bounds) {
        return [] as number[];
      }
      const { minY, maxY } = bounds;
      if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
        return [] as number[];
      }
      return [Math.abs(maxY - minY)];
    });
    if (heights.length > 0) {
      const avgHeight = average(heights);
      if (avgHeight > 0) {
        computedSize = avgHeight * 0.8;
      }
    }
  }

  if (computedSize < 6) {
    const blockBounds = (block as { bounds?: { minY: number; maxY: number } }).bounds;
    if (blockBounds && Number.isFinite(blockBounds.minY) && Number.isFinite(blockBounds.maxY)) {
      const height = Math.abs(blockBounds.maxY - blockBounds.minY);
      if (height > 0) {
        computedSize = Math.max(computedSize, height * 0.8);
      }
    }
  }

  if (!Number.isFinite(computedSize) || computedSize <= 0) {
    computedSize = fallbackFontSize;
  }

  element.style.fontSize = `${computedSize}px`;

  const candidateFonts = spans
    .map((span) => span.font)
    .filter((value): value is string => typeof value === 'string' && isLikelyFontFamily(value));
  if (candidateFonts.length > 0) {
    element.style.fontFamily = candidateFonts[0];
  }
}

type SpanLike = { font?: string; fontSize?: number; bounds?: { minY: number; maxY: number } };

function gatherSpans(block: AnnotatedHtmlContentBlock): SpanLike[] {
  const result: SpanLike[] = [];
  const anyBlock = block as any;
  if (Array.isArray(anyBlock.spans) && anyBlock.spans.length > 0) {
    result.push(...anyBlock.spans);
  }
  if (Array.isArray(anyBlock.lines)) {
    for (const line of anyBlock.lines) {
      if (Array.isArray(line?.spans)) {
        result.push(...line.spans);
      }
    }
  }
  if (Array.isArray(anyBlock.cells)) {
    for (const cell of anyBlock.cells) {
      if (Array.isArray(cell?.spans)) {
        result.push(...cell.spans);
      }
    }
  }
  return result;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

function isLikelyFontFamily(value: string): boolean {
  if (!value) {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  // Filter out internal PDF font names like "T1_0".
  if (/^[A-Za-z]{1,2}_\d+$/.test(trimmed)) {
    return false;
  }
  return true;
}

function highlightMatches(element: HTMLElement, ranges: MatchRange[], doc: Document): void {
  if (element.dataset.matchesApplied === '1') {
    return;
  }
  const text = element.textContent ?? '';
  if (!text) {
    return;
  }
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const fragment = doc.createDocumentFragment();
  let cursor = 0;

  for (const { start, end } of sorted) {
    if (start > cursor) {
      const prefix = text.slice(cursor, start);
      if (prefix.length > 0) {
        const span = doc.createElement('span');
        span.className = 'relevance-nonmatch';
        span.textContent = prefix;
        fragment.append(span);
      }
    }

    const highlighted = text.slice(start, end);
    if (highlighted.length > 0) {
      const mark = doc.createElement('mark');
      mark.className = 'relevance-match';
      mark.textContent = highlighted;
      fragment.append(mark);
    }
    cursor = Math.max(cursor, end);
  }

  if (cursor < text.length) {
    const suffix = text.slice(cursor);
    if (suffix.length > 0) {
      const span = doc.createElement('span');
      span.className = 'relevance-nonmatch';
      span.textContent = suffix;
      fragment.append(span);
    }
  }

  element.textContent = '';
  element.append(fragment);
  element.dataset.matchesApplied = '1';
}

type CollapseGroup = {
  id: string;
  collapsed: boolean;
  dominantState: 'dim' | 'hidden';
  toggle: HTMLDivElement;
  blocks: HTMLElement[];
  description?: string;
};

let tearIdCounter = 0;

function createCollapseGroup(
  doc: Document,
  parent: HTMLElement,
  beforeElement: HTMLElement,
  pageNumber: number,
  groupIndex: number,
  state: 'dim' | 'hidden'
): CollapseGroup {
  const id = `focus-collapse-${pageNumber}-${groupIndex}`;
  const tearId = `tear-${++tearIdCounter}`;
  const toggle = doc.createElement('div');
  toggle.className = 'relevance-collapse-veil';
  toggle.dataset.state = state;
  toggle.dataset.collapsed = 'true';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', collapseAriaLabel(state));
  toggle.setAttribute('role', 'button');
  toggle.tabIndex = 0;

  const tearSvg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  tearSvg.setAttribute('width', '600');
  tearSvg.setAttribute('height', '80');
  tearSvg.setAttribute('viewBox', '0 0 600 80');
  tearSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  tearSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  tearSvg.setAttribute('aria-hidden', 'true');
  tearSvg.classList.add('relevance-tear-icon');
  tearSvg.style.width = '100%';
  tearSvg.style.height = 'auto';

  const defs = doc.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const filter = doc.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.setAttribute('id', `paperShadow-${tearId}`);
  filter.setAttribute('x', '-20%');
  filter.setAttribute('y', '-50%');
  filter.setAttribute('width', '140%');
  filter.setAttribute('height', '200%');
  const dropShadow = doc.createElementNS('http://www.w3.org/2000/svg', 'feDropShadow');
  dropShadow.setAttribute('dx', '0');
  dropShadow.setAttribute('dy', '2');
  dropShadow.setAttribute('stdDeviation', '4');
  dropShadow.setAttribute('flood-opacity', '0.16');
  filter.append(dropShadow);
  defs.append(filter);

  tearSvg.append(defs);

  const svgGroup = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
  svgGroup.setAttribute('filter', `url(#paperShadow-${tearId})`);

  const tearPathData =
    'M 0 20 l 24 -10 l 16 10  l 24 -10 l 16 10  l 24 -10 l 16 10  l 24 -10 l 16 10 l 24 -10 l 16 10  l 24 -10 l 16 10  l 24 -10 l 16 10  l 24 -10 l 16 10 l 24 -10 l 16 10  l 24 -10 l 16 10  l 24 -10 l 16 10  l 24 -10 l 16 10 l 24 -10 l 16 10  l 24 -10 l 16 10  l 24 -10 l 16 10 V 60 l -24 10 l -16 -10 l -24 10 l -16 -10 l -24 10 l -16 -10 l -24 10 l -16 -10 l -24 10 l -16 -10 l -24 10 l -16 -10 l -24 10 l -16 -10 l -24 10 l -16 -10 l -24 10 l -16 -10 l -24 10 l -16 -10 l -24 10 l -16 -10 l -24 10 l -16 -10 l -24 10 l -16 -10 l -24 10 l -16 -10 l -24 10 l -16 -10 Z';

  const blurPath = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  blurPath.setAttribute('d', tearPathData);
  blurPath.setAttribute('fill', '#f1f3f6');
  blurPath.setAttribute('opacity', '0.55');
  blurPath.setAttribute('style', 'filter: blur(1.4px);');
  svgGroup.append(blurPath);

  const sheetPath = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  sheetPath.setAttribute('d', tearPathData);
  sheetPath.setAttribute('fill', '#f7f8fb');
  sheetPath.setAttribute('fill-opacity', '0.9');
  svgGroup.append(sheetPath);

  tearSvg.append(svgGroup);

  toggle.append(tearSvg);

  const collapseGroup: CollapseGroup = {
    id,
    collapsed: true,
    dominantState: state,
    toggle,
    blocks: []
  };

  toggle.addEventListener('click', () => {
    collapseGroup.collapsed = !collapseGroup.collapsed;
    synchronizeGroupControls(collapseGroup);
  });

  toggle.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle.click();
    }
  });

  parent.insertBefore(toggle, beforeElement);
  return collapseGroup;
}

function updateGroupState(group: CollapseGroup, state: 'dim' | 'hidden'): void {
  if (state === 'hidden' && group.dominantState !== 'hidden') {
    group.dominantState = 'hidden';
    group.toggle.dataset.state = 'hidden';
    updateGroupAriaLabel(group);
  }
}

function collapseAriaLabel(state: 'dim' | 'hidden', description?: string): string {
  const base = state === 'hidden' ? 'Reveal hidden context' : 'Reveal additional context';
  return description && description.length > 0 ? `${base}: ${description}` : base;
}

function assignBlockToGroup(
  group: CollapseGroup,
  element: HTMLElement,
  block: AnnotatedHtmlContentBlock,
  pageNumber: number,
  blockIndex: number
): void {
  element.dataset.collapsible = 'true';
  element.dataset.collapseGroup = group.id;
  element.dataset.collapsed = group.collapsed ? 'true' : 'false';

  if (!element.id) {
    element.id = `relevance-block-${pageNumber}-${blockIndex}`;
  }

  group.blocks.push(element);
  if (!group.description) {
    const snippetText = createCollapsedSnippet(block);
    if (snippetText.length > 0) {
      group.description = snippetText;
    }
  }
  synchronizeGroupControls(group);
}

function synchronizeGroupControls(group: CollapseGroup): void {
  const controls = group.blocks
    .map((block) => block.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .join(' ');
  if (controls.length > 0) {
    group.toggle.setAttribute('aria-controls', controls);
  }
  group.toggle.dataset.collapsed = group.collapsed ? 'true' : 'false';
  group.toggle.setAttribute('aria-expanded', group.collapsed ? 'false' : 'true');
  group.blocks.forEach((block) => {
    block.dataset.collapsed = group.collapsed ? 'true' : 'false';
  });
  updateGroupAriaLabel(group);
}

function resetCollapseState(element: HTMLElement): void {
  element.dataset.collapsible = 'false';
  element.dataset.collapsed = 'false';
  element.removeAttribute('data-collapse-group');
}

function updateGroupAriaLabel(group: CollapseGroup): void {
  if (!group.collapsed) {
    group.toggle.setAttribute('aria-label', 'Hide expanded context');
    return;
  }
  group.toggle.setAttribute('aria-label', collapseAriaLabel(group.dominantState, group.description));
}

function mergeAdjacentGroups(groups: CollapseGroup[]): void {
  if (groups.length < 2) {
    return;
  }
  let reference: CollapseGroup | undefined;
  let index = 0;

  while (index < groups.length) {
    const current = groups[index];
    if (!current.toggle.isConnected || current.blocks.length === 0) {
      groups.splice(index, 1);
      continue;
    }
    if (reference && canMergeGroups(reference, current)) {
      mergeGroups(reference, current);
      groups.splice(index, 1);
      continue;
    }
    reference = current;
    index += 1;
  }
}

function canMergeGroups(a: CollapseGroup, b: CollapseGroup): boolean {
  const parent = a.toggle.parentElement;
  if (!parent || parent !== b.toggle.parentElement) {
    return false;
  }
  let cursor: ChildNode | null = a.toggle.nextSibling;
  while (cursor && cursor !== b.toggle) {
    if (cursor instanceof HTMLElement) {
      const element = cursor;
      if (element.dataset.collapsible === 'true') {
        if (element.dataset.collapsed === 'false') {
          return false;
        }
      } else if (!element.classList.contains('relevance-collapse-veil')) {
        return false;
      }
    } else if (cursor instanceof Text && cursor.textContent && cursor.textContent.trim().length > 0) {
      return false;
    }
    cursor = cursor.nextSibling;
  }
  return cursor === b.toggle;
}

function mergeGroups(target: CollapseGroup, source: CollapseGroup): void {
  source.blocks.forEach((block) => {
    block.dataset.collapseGroup = target.id;
    block.dataset.collapsed = target.collapsed ? 'true' : 'false';
    target.blocks.push(block);
  });
  if (!target.description && source.description) {
    target.description = source.description;
  }
  source.toggle.remove();
  synchronizeGroupControls(target);
}

function createCollapsedSnippet(block: AnnotatedHtmlContentBlock): string {
  const raw = collectBlockPlainText(block);
  if (!raw) {
    if (block.type === 'table') {
      return 'Table content';
    }
    if (block.type === 'image') {
      return block.image?.name ? `Image: ${block.image.name}` : 'Embedded image';
    }
    return '';
  }
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) {
    return '';
  }
  return normalized.length > 120 ? `${normalized.slice(0, 119)}…` : normalized;
}

function collectBlockPlainText(block: AnnotatedHtmlContentBlock): string {
  if ('text' in block && typeof block.text === 'string') {
    return block.text;
  }

  if (block.type === 'table') {
    const parts: string[] = [];
    block.rows.forEach((row) => {
      row.cells.forEach((cell) => {
        if (cell.text && cell.text.trim().length > 0) {
          parts.push(cell.text.trim());
        }
      });
    });
    return parts.join(' • ');
  }

  if (block.type === 'image') {
    return block.image?.name ?? '';
  }

  return '';
}

export { createRelevanceRenderPlan };
