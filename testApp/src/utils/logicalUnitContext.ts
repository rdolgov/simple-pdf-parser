import {
  findHtmlLogicalUnitById,
  type HtmlDocumentLogicalStructure,
  type HtmlLogicalTextUnit
} from 'pdf-layout-parser';
import type { CanvasHighlightSelection } from '../types';

export interface ResolvedTextSelectionContext {
  scope: 'block' | 'topic' | 'section';
  logicalUnit: HtmlLogicalTextUnit | null;
  sectionUnit: HtmlLogicalTextUnit | null;
  title?: string;
  text: string;
  paragraphCount: number;
}

export function resolveTextSelectionContext(
  selection: Extract<CanvasHighlightSelection, { kind: 'text' }> | null,
  structure: HtmlDocumentLogicalStructure | null,
  fallbackText: string
): ResolvedTextSelectionContext {
  const logicalUnit = findHtmlLogicalUnitById(structure, selection?.logicalUnitId);
  const sectionUnit = findHtmlLogicalUnitById(structure, selection?.sectionUnitId);
  const resolvedText = logicalUnit?.text?.trim() || fallbackText.trim();

  return {
    scope: selection?.selectionScope ?? 'block',
    logicalUnit,
    sectionUnit,
    title: logicalUnit?.title?.trim() || sectionUnit?.title?.trim() || undefined,
    text: resolvedText,
    paragraphCount: logicalUnit?.paragraphCount ?? (fallbackText.trim().length > 0 ? 1 : 0)
  };
}

export function describeSelectionScope(context: ResolvedTextSelectionContext): string {
  if (context.scope === 'section') {
    return 'Section unit';
  }
  if (context.scope === 'topic') {
    return 'Logical unit';
  }
  return 'Paragraph';
}

export function buildChatContextText(context: ResolvedTextSelectionContext): string {
  const title = context.title?.trim();
  if (!title) {
    return context.text;
  }
  return `${title}\n\n${context.text}`;
}

export function trimSelectionContextText(text: string, maxLength = 1600): string {
  const normalized = text.replace(/\n{3,}/g, '\n\n').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}
