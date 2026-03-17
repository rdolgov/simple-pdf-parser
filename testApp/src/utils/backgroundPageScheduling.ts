import { MAIN_THREAD_PAGE_RENDER_COUNT } from './backgroundCanvasRendering';

const DEFAULT_LOOK_AHEAD = 3;
const DEFAULT_LOOK_BEHIND = 2;

export function buildViewportPriorityPageOrder(
  visiblePageNumbers: Iterable<number>,
  totalPages: number,
  lookAhead = DEFAULT_LOOK_AHEAD,
  lookBehind = DEFAULT_LOOK_BEHIND
): number[] {
  const visible = [...new Set(visiblePageNumbers)]
    .filter((pageNumber) => pageNumber > MAIN_THREAD_PAGE_RENDER_COUNT && pageNumber <= totalPages)
    .sort((left, right) => left - right);

  if (visible.length === 0) {
    return [];
  }

  const firstVisiblePage = visible[0];
  const lastVisiblePage = visible[visible.length - 1];
  const orderedPages: number[] = [];
  const seenPages = new Set<number>();

  const pushPage = (pageNumber: number) => {
    if (
      pageNumber <= MAIN_THREAD_PAGE_RENDER_COUNT ||
      pageNumber > totalPages ||
      seenPages.has(pageNumber)
    ) {
      return;
    }
    seenPages.add(pageNumber);
    orderedPages.push(pageNumber);
  };

  visible.forEach(pushPage);

  for (let offset = 1; offset <= lookAhead; offset += 1) {
    pushPage(lastVisiblePage + offset);
  }

  for (let offset = 1; offset <= lookBehind; offset += 1) {
    pushPage(firstVisiblePage - offset);
  }

  return orderedPages;
}

export function selectNextPendingBackgroundPage(
  pendingPageNumbers: Iterable<number>,
  priorityPageNumbers: readonly number[]
): number | undefined {
  const pending = [...pendingPageNumbers].sort((left, right) => left - right);
  if (pending.length === 0) {
    return undefined;
  }

  const pendingSet = new Set(pending);
  for (const pageNumber of priorityPageNumbers) {
    if (pendingSet.has(pageNumber)) {
      return pageNumber;
    }
  }

  return pending[0];
}
