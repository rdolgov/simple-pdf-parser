import type { HtmlPageLayout, PDFPage, PDFTextItem } from 'pdf-layout-parser';
import type { AnnotationBounds } from '../storage/annotationStorage';
import { findParagraphBlockAtPoint } from './highlightUtils';
import { buildSectionContext } from './sectionContext';

export interface LassoPromptContext {
  documentTitle?: string;
  pageNumber: number;
  totalPages: number;
  selectionBounds: AnnotationBounds;
  nearbyPageText: string;
  sectionHeading?: string;
  sectionText?: string;
  documentContextText?: string;
}

const LOCAL_TEXT_PADDING = 54;
const LOCAL_TEXT_LIMIT = 1600;
const SECTION_TEXT_LIMIT = 2200;
const DOCUMENT_TEXT_LIMIT = 5200;

export function buildDocumentContextExcerpt(documentText: string, maxCharacters = DOCUMENT_TEXT_LIMIT): string | undefined {
  const normalized = collapseWhitespace(documentText);
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= maxCharacters) {
    return normalized;
  }

  const segmentLength = Math.max(400, Math.floor((maxCharacters - 100) / 3));
  const middleStart = Math.max(0, Math.floor((normalized.length - segmentLength) / 2));
  const endStart = Math.max(0, normalized.length - segmentLength);

  return [
    `Beginning: ${normalized.slice(0, segmentLength).trim()}`,
    `Middle: ${normalized.slice(middleStart, middleStart + segmentLength).trim()}`,
    `Ending: ${normalized.slice(endStart).trim()}`
  ].join('\n\n');
}

export function buildLassoPromptContext(payload: {
  page: PDFPage;
  pageNumber: number;
  totalPages: number;
  htmlPage: HtmlPageLayout | null;
  documentTitle?: string;
  documentText?: string;
  selectionBounds: AnnotationBounds;
}): LassoPromptContext {
  const nearbyPageText = extractNearbyPageText(payload.page, payload.selectionBounds);
  const selectionCenterX = (payload.selectionBounds.minX + payload.selectionBounds.maxX) / 2;
  const selectionCenterY = (payload.selectionBounds.minY + payload.selectionBounds.maxY) / 2;
  const selectedBlock = payload.htmlPage
    ? findParagraphBlockAtPoint(payload.htmlPage, selectionCenterX, selectionCenterY)
    : null;
  const sectionContext = buildSectionContext(payload.htmlPage, selectedBlock);

  return {
    documentTitle: payload.documentTitle,
    pageNumber: payload.pageNumber,
    totalPages: payload.totalPages,
    selectionBounds: payload.selectionBounds,
    nearbyPageText: nearbyPageText || '[No nearby text was recovered from this page region.]',
    sectionHeading: normalizeOptionalText(sectionContext.sectionHeading),
    sectionText: normalizeOptionalText(sectionContext.sectionText, SECTION_TEXT_LIMIT),
    documentContextText: buildDocumentContextExcerpt(payload.documentText ?? '')
  };
}

export function buildLassoChatContextText(context: LassoPromptContext): string {
  const lines = [
    `Document: ${context.documentTitle?.trim() || 'Untitled PDF'}`,
    `Page: ${context.pageNumber} of ${context.totalPages}`,
    `Selection bounds: x=${formatNumber(context.selectionBounds.minX)}-${formatNumber(context.selectionBounds.maxX)}, y=${formatNumber(context.selectionBounds.minY)}-${formatNumber(context.selectionBounds.maxY)}`
  ];

  if (context.sectionHeading) {
    lines.push(`Section heading: ${context.sectionHeading}`);
  }

  lines.push(`Nearby page text:\n${context.nearbyPageText}`);

  if (context.sectionText) {
    lines.push(`Section context:\n${context.sectionText}`);
  }

  if (context.documentContextText) {
    lines.push(`Whole-document context excerpt:\n${context.documentContextText}`);
  }

  lines.push('The initial answer for this chat was generated from a screenshot of the selected region, a larger nearby page crop, and a full-page thumbnail.');

  return lines.join('\n\n');
}

export function buildLassoExplainPrompt(context: LassoPromptContext): string {
  return `You are analyzing a user-selected region from a PDF page.

The attached image contains three panels:
1. The exact selected region.
2. A larger crop showing the page area around that region.
3. A full-page thumbnail with the selected region outlined.

Your job is to explain the selected region itself, using the surrounding page and whole-document context only to disambiguate it.

Document title:
"""${context.documentTitle?.trim() || 'Untitled PDF'}"""

Page:
"""${context.pageNumber} of ${context.totalPages}"""

${context.sectionHeading ? `Nearest section heading:\n"""${context.sectionHeading}"""\n\n` : ''}Nearby page text:
"""${context.nearbyPageText}"""

${context.sectionText ? `Section context:\n"""${context.sectionText}"""\n\n` : ''}${context.documentContextText ? `Whole-document context excerpt:\n"""${context.documentContextText}"""\n\n` : ''}Instructions:
- Explain what the selected region shows or says.
- If it is a formula, define the important symbols and the role of the expression.
- If it is a figure or table fragment, describe the visible elements and what point they support.
- If the selection is partial or ambiguous, say what is visible and what remains uncertain.
- Tie the explanation back to the page and document context without drifting into a generic summary of the entire paper.
- Keep the answer concise but specific.`;
}

export function buildLassoInteractiveWidgetPrompt(context: LassoPromptContext): string {
  return `Create a compact, self-contained HTML/CSS/JavaScript teaching widget for a selected region from a PDF.

The attached image contains:
1. The exact selected region.
2. A larger crop with the nearby page context.
3. A full-page thumbnail showing where the selection sits on the page.

Document title:
"""${context.documentTitle?.trim() || 'Untitled PDF'}"""

Page:
"""${context.pageNumber} of ${context.totalPages}"""

${context.sectionHeading ? `Nearest section heading:\n"""${context.sectionHeading}"""\n\n` : ''}Nearby page text:
"""${context.nearbyPageText}"""

${context.sectionText ? `Section context:\n"""${context.sectionText}"""\n\n` : ''}${context.documentContextText ? `Whole-document context excerpt:\n"""${context.documentContextText}"""\n\n` : ''}Requirements:
- Teach the selected region, not the whole paper.
- Use the screenshot as the primary source of truth and the text context to resolve ambiguity.
- Use only vanilla HTML, CSS, and JavaScript.
- No external libraries, fonts, images, network requests, forms, popups, navigation, storage APIs, or parent-window access.
- Fit comfortably in a panel around 560px wide and 520px tall.
- Include a clear title, a concise explanation, and at least one interactive control such as tabs, buttons, a slider, or a toggle.
- Prefer worked examples, step-by-step reveals, simple diagrams built in CSS/SVG, or manipulations of the visible formula/figure components.
- Keep the tone practical and explanatory, not flashy.
- Return strict JSON only, with this exact shape:
{
  "title": "Short widget title",
  "html": "<div>...</div>",
  "css": "/* widget styles */",
  "js": "/* widget behavior */"
}

Important:
- The "html" field must be a fragment only, not a full document.
- Put all styling in "css" and all behavior in "js".
- The "js" field must work when executed after the HTML has already been inserted into the DOM.
- Do not wrap the JSON in markdown fences.`;
}

export function buildLassoGraphicPrompt(context: LassoPromptContext): string {
  return `Create a single polished explanatory graphic based on a selected region from a PDF document.

This is not a request to redraw the screenshot itself. Instead, create a clean standalone visual that helps a reader understand the selected content.

Document title:
"""${context.documentTitle?.trim() || 'Untitled PDF'}"""

Page:
"""${context.pageNumber} of ${context.totalPages}"""

${context.sectionHeading ? `Nearest section heading:\n"""${context.sectionHeading}"""\n\n` : ''}Nearby page text:
"""${context.nearbyPageText}"""

${context.sectionText ? `Section context:\n"""${context.sectionText}"""\n\n` : ''}${context.documentContextText ? `Whole-document context excerpt:\n"""${context.documentContextText}"""\n\n` : ''}Requirements:
- White or very light background.
- Professional academic infographic style.
- Focus on the selected region only, not the whole document.
- If the region is a formula, diagram, or mechanism, translate it into a simplified explanatory visual.
- If the region is prose, create a concise concept graphic or structured visual summary.
- Use large readable labels.
- Keep the composition compact and clear.
- Do not imitate the original PDF page layout.
- Do not include browser UI, frames, or screenshots of the source page.
- Avoid decorative flourishes that do not help explanation.
- Return only the image.`;
}

function extractNearbyPageText(page: PDFPage, selectionBounds: AnnotationBounds): string {
  const expanded = {
    minX: Math.max(0, selectionBounds.minX - LOCAL_TEXT_PADDING),
    minY: Math.max(0, selectionBounds.minY - LOCAL_TEXT_PADDING),
    maxX: Math.min(page.size.width, selectionBounds.maxX + LOCAL_TEXT_PADDING),
    maxY: Math.min(page.size.height, selectionBounds.maxY + LOCAL_TEXT_PADDING)
  };

  const nearbyItems = page.textItems.filter((item) => intersects(item.bounds, expanded));
  if (nearbyItems.length === 0) {
    return '';
  }

  const orderedLines = groupTextItemsIntoLines(nearbyItems);
  const text = orderedLines
    .map((line) => line.map((item) => item.text.trim()).filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n');

  return normalizeOptionalText(text, LOCAL_TEXT_LIMIT) ?? '';
}

function groupTextItemsIntoLines(items: PDFTextItem[]): PDFTextItem[][] {
  const sorted = [...items].sort((left, right) => {
    const leftCenterY = (left.bounds.minY + left.bounds.maxY) / 2;
    const rightCenterY = (right.bounds.minY + right.bounds.maxY) / 2;
    if (Math.abs(leftCenterY - rightCenterY) > 5) {
      return rightCenterY - leftCenterY;
    }
    return left.bounds.minX - right.bounds.minX;
  });

  const lines: Array<{ centerY: number; items: PDFTextItem[] }> = [];

  for (const item of sorted) {
    const centerY = (item.bounds.minY + item.bounds.maxY) / 2;
    const existingLine = lines.find((line) => Math.abs(line.centerY - centerY) <= 5);

    if (existingLine) {
      existingLine.items.push(item);
      existingLine.centerY = (existingLine.centerY * (existingLine.items.length - 1) + centerY) / existingLine.items.length;
      continue;
    }

    lines.push({ centerY, items: [item] });
  }

  return lines
    .sort((left, right) => right.centerY - left.centerY)
    .map((line) => line.items.sort((left, right) => left.bounds.minX - right.bounds.minX));
}

function intersects(left: AnnotationBounds, right: AnnotationBounds): boolean {
  return (
    left.minX <= right.maxX &&
    left.maxX >= right.minX &&
    left.minY <= right.maxY &&
    left.maxY >= right.minY
  );
}

function normalizeOptionalText(value?: string, maxLength = Number.POSITIVE_INFINITY): string | undefined {
  const normalized = collapseWhitespace(value ?? '');
  if (!normalized) {
    return undefined;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function formatNumber(value: number): string {
  return value.toFixed(1);
}
