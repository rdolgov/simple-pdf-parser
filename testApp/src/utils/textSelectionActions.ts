import type { AnnotationBounds } from '../storage/annotationStorage';
import type { TextSelectionFragment } from './textRangeSelection';

export interface TextSelectionLocalBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TextSelectionToolbarPosition {
  left: number;
  top: number;
}

export function resolveTextSelectionLocalBounds(
  fragments: TextSelectionFragment[]
): TextSelectionLocalBounds | null {
  const validFragments = normalizeTextSelectionFragments(fragments);
  if (validFragments.length === 0) {
    return null;
  }

  const left = Math.min(...validFragments.map((fragment) => fragment.left));
  const top = Math.min(...validFragments.map((fragment) => fragment.top));
  const right = Math.max(...validFragments.map((fragment) => fragment.left + fragment.width));
  const bottom = Math.max(...validFragments.map((fragment) => fragment.top + fragment.height));

  return {
    left,
    top,
    width: Math.max(right - left, 1),
    height: Math.max(bottom - top, 1)
  };
}

export function resolveTextSelectionToolbarPosition(
  fragments: TextSelectionFragment[]
): TextSelectionToolbarPosition | null {
  const validFragments = normalizeTextSelectionFragments(fragments);
  if (validFragments.length === 0) {
    return null;
  }

  const anchorFragment = validFragments[0];
  return {
    left: anchorFragment.left + anchorFragment.width + 8,
    top: Math.max(anchorFragment.top - 18, -6)
  };
}

export function resolveTextSelectionAnnotationBounds(payload: {
  fragments: TextSelectionFragment[];
  blockBounds: AnnotationBounds;
  scaleX: number;
  scaleY: number;
  padding: number;
}): AnnotationBounds | null {
  const localBounds = resolveTextSelectionLocalBounds(payload.fragments);
  if (!localBounds) {
    return null;
  }

  const localMinX = clamp(localBounds.left - payload.padding, 0, (payload.blockBounds.maxX - payload.blockBounds.minX) * payload.scaleX);
  const localMaxX = clamp(
    localBounds.left + localBounds.width - payload.padding,
    0,
    (payload.blockBounds.maxX - payload.blockBounds.minX) * payload.scaleX
  );
  const localTop = clamp(localBounds.top - payload.padding, 0, (payload.blockBounds.maxY - payload.blockBounds.minY) * payload.scaleY);
  const localBottom = clamp(
    localBounds.top + localBounds.height - payload.padding,
    0,
    (payload.blockBounds.maxY - payload.blockBounds.minY) * payload.scaleY
  );

  const minX = payload.blockBounds.minX + localMinX / payload.scaleX;
  const maxX = payload.blockBounds.minX + localMaxX / payload.scaleX;
  const maxY = payload.blockBounds.maxY - localTop / payload.scaleY;
  const minY = payload.blockBounds.maxY - localBottom / payload.scaleY;

  return {
    minX: clamp(minX, payload.blockBounds.minX, payload.blockBounds.maxX),
    minY: clamp(minY, payload.blockBounds.minY, payload.blockBounds.maxY),
    maxX: clamp(maxX, payload.blockBounds.minX, payload.blockBounds.maxX),
    maxY: clamp(maxY, payload.blockBounds.minY, payload.blockBounds.maxY)
  };
}

export function buildPrioritizedSelectionChatContext(payload: {
  selectedText: string;
  surroundingText?: string | null;
  title?: string | null;
}): string {
  const selectedText = normalizeSelectionText(payload.selectedText);
  if (selectedText.length === 0) {
    return '';
  }

  const title = normalizeSelectionText(payload.title ?? '');
  const surroundingText = normalizeSelectionText(trimSelectionContextText(payload.surroundingText ?? '', 2200));
  const sections: string[] = [];

  if (title.length > 0) {
    sections.push(title);
  }

  sections.push(`Primary selection (answer this first):\n${selectedText}`);

  if (surroundingText.length > 0 && surroundingText !== selectedText) {
    sections.push(
      `Secondary surrounding context from the same document (use only when it helps explain the selection):\n${surroundingText}`
    );
  }

  return sections.join('\n\n');
}

function normalizeTextSelectionFragments(fragments: TextSelectionFragment[]): TextSelectionFragment[] {
  return fragments
    .filter(
      (fragment) =>
        Number.isFinite(fragment.left) &&
        Number.isFinite(fragment.top) &&
        Number.isFinite(fragment.width) &&
        Number.isFinite(fragment.height) &&
        fragment.width > 0 &&
        fragment.height > 0
    )
    .sort((left, right) => {
      const topDelta = left.top - right.top;
      if (Math.abs(topDelta) > 0.5) {
        return topDelta;
      }
      return left.left - right.left;
    });
}

function normalizeSelectionText(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function trimSelectionContextText(text: string, maxLength = 1600): string {
  const normalized = text.replace(/\n{3,}/g, '\n\n').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
