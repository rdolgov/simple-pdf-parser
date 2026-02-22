export function decorateFocusPdfPages(container: HTMLElement): void {
  const doc = container.ownerDocument ?? document;
  cleanupFocusPdfDecorations(container);
  const pages = Array.from(container.querySelectorAll<HTMLElement>('.pdf-html-page'));
  pages.forEach((page, index) => {
    page.classList.add('focus-pdf-page');
    decorateFocusPdfSections(page, doc);
    if (index < pages.length - 1) {
      const nextPage = pages[index + 1];
      const currentNumber = Number(page.dataset.pageNumber ?? '0');
      const nextNumber = Number(nextPage?.dataset.pageNumber ?? '0');
      const hiddenBetween =
        Number.isFinite(currentNumber) && Number.isFinite(nextNumber)
          ? Math.max(0, nextNumber - currentNumber - 1)
          : 0;
      const separator = doc.createElement('div');
      separator.className = 'focus-pdf-page-break';
      if (hiddenBetween > 0) {
        separator.textContent = `${hiddenBetween} hidden page${hiddenBetween === 1 ? '' : 's'}`;
        separator.dataset.hiddenCount = String(hiddenBetween);
      } else {
        separator.textContent = 'Next page';
        separator.dataset.hiddenCount = '0';
      }
      const parent = page.parentElement;
      if (parent) {
        parent.insertBefore(separator, page.nextSibling);
      } else {
        page.after(separator);
      }
    }
  });
}

export function cleanupFocusPdfDecorations(container: HTMLElement): void {
  container.querySelectorAll('.focus-pdf-page-break').forEach((element) => element.remove());
  container.querySelectorAll('.focus-pdf-page').forEach((page) => {
    page.classList.remove('focus-pdf-page');
    page.removeAttribute('data-trim-applied');
    page.style.removeProperty('--focus-trim-offset');
    page.style.removeProperty('--focus-visible-height');
    page.style.removeProperty('height');
    const inner = page.querySelector<HTMLElement>('.focus-pdf-page-inner');
    if (inner) {
      inner.style.transform = '';
    }
  });
  container.querySelectorAll('.focus-pdf-hidden-block').forEach((block) => block.classList.remove('focus-pdf-hidden-block'));
}

function decorateFocusPdfSections(page: HTMLElement, doc: Document): void {
  const inner = ensureFocusPdfPageInner(page, doc);
  const blocks = Array.from(inner.querySelectorAll<HTMLElement>('[data-block-index]'));
  if (blocks.length === 0) {
    return;
  }
  let pendingHidden = 0;
  let lastVisible: HTMLElement | null = null;

  for (const block of blocks) {
    const isHighlight = block.dataset.relevanceState === 'highlight';
    if (isHighlight) {
      pendingHidden = 0;
      lastVisible = block;
      continue;
    }
    block.classList.add('focus-pdf-hidden-block');
    pendingHidden += 1;
  }

  const visibleBlocks = blocks.filter((block) => block.dataset.relevanceState === 'highlight');
  const trimCandidates: HTMLElement[] = [...visibleBlocks];
  if (trimCandidates.length === 0) {
    page.removeAttribute('data-trim-applied');
    inner.style.transform = '';
    page.style.height = '';
    return;
  }
  const highlightBuffer = 100;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const node of trimCandidates) {
    const nodeTop = Math.max(0, node.offsetTop - highlightBuffer);
    const nodeBottom = Math.min(inner.scrollHeight, node.offsetTop + node.offsetHeight + highlightBuffer);
    top = Math.min(top, nodeTop);
    bottom = Math.max(bottom, nodeBottom);
  }
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || top >= bottom) {
    page.removeAttribute('data-trim-applied');
    inner.style.transform = '';
    page.style.height = '';
    return;
  }
  const height = Math.max(160, bottom - top);
  page.dataset.trimApplied = '1';
  page.style.setProperty('--focus-trim-offset', `${top}px`);
  page.style.setProperty('--focus-visible-height', `${height}px`);
  page.style.height = `${height}px`;
  inner.style.transform = `translateY(${-top}px)`;
}

function ensureFocusPdfPageInner(page: HTMLElement, doc: Document): HTMLElement {
  const existing = page.querySelector<HTMLElement>('.focus-pdf-page-inner');
  if (existing) {
    return existing;
  }
  const inner = doc.createElement('div');
  inner.className = 'focus-pdf-page-inner';
  while (page.firstChild) {
    inner.append(page.firstChild);
  }
  page.append(inner);
  return inner;
}
