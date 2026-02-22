/**
 * Element Bounds Aligner
 *
 * Combines multiple data sources to get accurate element positions:
 * 1. Gemini extraction - identifies element types (formula, table, reference) and content
 * 2. PDF text items - provides accurate rendered positions from the PDF parser
 *
 * Strategy:
 * - Use Gemini to identify WHAT elements are
 * - Use PDF text items to find WHERE they actually are
 * - Match by text content similarity and proximity
 */

import type { PDFTextItem, PDFPage } from 'pdf-layout-parser';
import type { GeminiDocumentExtraction, GeminiElement } from '../storage/geminiExtractionStorage';

export interface AlignedBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  confidence: 'high' | 'medium' | 'low';
  source: 'pdf' | 'gemini' | 'combined';
}

export interface AlignedElement {
  type: GeminiElement['type'];
  content: string;
  bounds: AlignedBounds;
  originalGeminiBounds: [number, number, number, number];
  matchedTextItems?: PDFTextItem[];
}

export interface PageAlignedElements {
  pageNumber: number;
  elements: AlignedElement[];
}

export interface AlignmentResult {
  pages: PageAlignedElements[];
}

/**
 * Normalize text for comparison (remove extra whitespace, lowercase)
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[₁₂₃₄₅₆₇₈₉₀]/g, (m) => {
      const subscripts: Record<string, string> = {
        '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
        '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9'
      };
      return subscripts[m] || m;
    })
    .trim();
}

/**
 * Calculate similarity between two strings (0-1)
 */
function textSimilarity(a: string, b: string): number {
  const normA = normalizeText(a);
  const normB = normalizeText(b);

  if (normA === normB) return 1;
  if (normA.length === 0 || normB.length === 0) return 0;

  // Check if one contains the other
  if (normA.includes(normB) || normB.includes(normA)) {
    const shorter = Math.min(normA.length, normB.length);
    const longer = Math.max(normA.length, normB.length);
    return shorter / longer;
  }

  // Check for common words/tokens
  const tokensA = new Set(normA.split(/\s+/));
  const tokensB = new Set(normB.split(/\s+/));
  const intersection = [...tokensA].filter(t => tokensB.has(t));
  const union = new Set([...tokensA, ...tokensB]);

  if (union.size === 0) return 0;
  return intersection.length / union.size;
}

/**
 * Check if a character is likely part of a mathematical formula
 */
function isMathChar(char: string): boolean {
  // Mathematical operators, Greek letters, subscripts, etc.
  return /[=+\-*/^()[\]{}∑∏∫√∞≈≠≤≥αβγδεζηθικλμνξπρστυφχψω₀₁₂₃₄₅₆₇₈₉⁰¹²³⁴⁵⁶⁷⁸⁹]/.test(char);
}

/**
 * Score how likely a text item is part of a formula
 */
function formulaScore(text: string): number {
  if (!text || text.length === 0) return 0;

  let mathChars = 0;
  for (const char of text) {
    if (isMathChar(char)) mathChars++;
  }

  // Also check for common formula patterns
  const formulaPatterns = [
    /[a-zA-Z]\s*[=]/,           // Variable assignment: x =
    /\([^)]+\)/,                // Parentheses with content
    /[a-zA-Z]\s*\(/,            // Function call: f(
    /\d+\s*[+\-*/^]\s*\d+/,     // Arithmetic: 1 + 2
    /[WQKVxb]\d?/i,             // Common ML variables
    /softmax|max|min|concat|attention/i, // ML function names
  ];

  let patternScore = 0;
  for (const pattern of formulaPatterns) {
    if (pattern.test(text)) patternScore += 0.2;
  }

  return Math.min(1, (mathChars / text.length) * 0.5 + patternScore);
}

/**
 * Extract key identifiers from formula content for searching
 */
function extractFormulaIdentifiers(content: string): string[] {
  const identifiers: string[] = [];

  // Look for left-hand side of equations (e.g., "lrate =", "FFN(x) =")
  const lhsMatch = content.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*[=(]/);
  if (lhsMatch) {
    identifiers.push(lhsMatch[1]);
  }

  // Look for function names like FFN, Attention, MultiHead, softmax, etc.
  const funcMatches = content.match(/\b([A-Z][a-zA-Z]+|softmax|max|min|concat|head|lrate)\s*[=(]/gi);
  if (funcMatches) {
    for (const match of funcMatches) {
      identifiers.push(match.replace(/\s*[=(]$/, ''));
    }
  }

  // Look for variable patterns like W₁, b₂, Q, K, V (single uppercase letters)
  const varMatches = content.match(/\b[A-Z][₀₁₂₃₄₅₆₇₈₉]?\b/g);
  if (varMatches) {
    identifiers.push(...varMatches);
  }

  // Look for specific math terms that are less common
  const mathTerms = ['Attention', 'MultiHead', 'Concat', 'FFN', 'PE', 'lrate', 'warmup'];
  for (const term of mathTerms) {
    if (content.toLowerCase().includes(term.toLowerCase())) {
      identifiers.push(term);
    }
  }

  return [...new Set(identifiers)]; // Remove duplicates
}

/**
 * Find text items that match the formula by searching for key identifiers
 * This is more reliable than using Gemini's position when it's inaccurate
 */
function findFormulaLineTextItems(
  formulaContent: string,
  textItems: PDFTextItem[],
  geminiBounds: { minX: number; minY: number; maxX: number; maxY: number },
  pageWidth: number,
  pageHeight: number
): PDFTextItem[] {
  const identifiers = extractFormulaIdentifiers(formulaContent);

  // Strategy 1: Find text items containing key formula identifiers
  let anchorItems: PDFTextItem[] = [];

  for (const id of identifiers) {
    const matches = textItems.filter(item =>
      item.text.includes(id) ||
      normalizeText(item.text).includes(normalizeText(id))
    );
    if (matches.length > 0 && matches.length < 5) { // Don't use if too common
      anchorItems.push(...matches);
    }
  }

  // Also look for '=' which is a strong formula indicator
  const equalsItems = textItems.filter(item =>
    item.text.includes('=') && formulaScore(item.text) > 0.2
  );
  anchorItems.push(...equalsItems);

  // Remove duplicates
  anchorItems = [...new Set(anchorItems)];

  if (anchorItems.length === 0) {
    // Fallback: use Gemini's position (original approach)
    return findItemsByGeminiPosition(textItems, geminiBounds, pageWidth);
  }

  // Check if Gemini's bounds are valid (not negative or off-page)
  const geminiCenterY = (geminiBounds.minY + geminiBounds.maxY) / 2;
  const geminiIsValid = geminiBounds.minY >= 0 && geminiBounds.maxY <= pageHeight * 1.1;

  if (geminiIsValid) {
    // Sort by distance to Gemini's position
    anchorItems.sort((a, b) => {
      const aY = (a.bounds.minY + a.bounds.maxY) / 2;
      const bY = (b.bounds.minY + b.bounds.maxY) / 2;
      return Math.abs(aY - geminiCenterY) - Math.abs(bY - geminiCenterY);
    });
  } else {
    // Gemini position is invalid - find the anchor that's part of a complete formula
    // Score each anchor based on how much it looks like a formula definition
    const scoreAnchor = (item: PDFTextItem): number => {
      let score = 0;
      const text = item.text;

      // Check if this item is on a line with other formula-like items
      const itemY = (item.bounds.minY + item.bounds.maxY) / 2;
      const lineItems = textItems.filter(t => {
        const tY = (t.bounds.minY + t.bounds.maxY) / 2;
        return Math.abs(tY - itemY) < 15;
      });

      // Get line bounds
      const lineMinX = Math.min(...lineItems.map(i => i.bounds.minX));
      const lineMaxX = Math.max(...lineItems.map(i => i.bounds.maxX));
      const lineWidth = lineMaxX - lineMinX;
      const lineCenterX = (lineMinX + lineMaxX) / 2;
      const pageCenterX = pageWidth / 2;

      // PENALTY: Skip if this looks like a table row (multiple separate items with gaps)
      const sortedByX = [...lineItems].sort((a, b) => a.bounds.minX - b.bounds.minX);
      let largeGaps = 0;
      for (let i = 1; i < sortedByX.length; i++) {
        const gap = sortedByX[i].bounds.minX - sortedByX[i - 1].bounds.maxX;
        if (gap > 30) largeGaps++;
      }
      if (largeGaps >= 2) {
        // Looks like a table with columns - strong penalty
        score -= 20;
      }

      // Strong indicator: contains "=" (equation)
      if (text.includes('=')) score += 10;

      // Score based on how formula-like the line is
      const lineText = lineItems.map(t => t.text).join(' ');
      score += formulaScore(lineText) * 5;

      // Prefer lines that are centered on the page (standalone formulas are usually centered)
      const centerOffset = Math.abs(lineCenterX - pageCenterX) / pageWidth;
      if (centerOffset < 0.15) score += 5; // Well centered
      else if (centerOffset < 0.25) score += 2; // Somewhat centered

      // Prefer lines that are not full-width (standalone formulas)
      if (lineWidth < pageWidth * 0.5) score += 4;
      else if (lineWidth < pageWidth * 0.7) score += 2;

      // Bonus for math-like content in the item itself
      score += formulaScore(text) * 2;

      // Prefer items higher on the page (formulas are usually defined before referenced)
      // PDF Y coordinates: higher Y = higher on page
      score += (itemY / pageHeight) * 2;

      return score;
    };

    // Score all anchors
    const scoredAnchors = anchorItems.map(item => ({
      item,
      score: scoreAnchor(item)
    }));
    scoredAnchors.sort((a, b) => b.score - a.score);

    // If best score is too low, don't trust the alignment
    if (scoredAnchors[0].score < 5) {
      console.debug('[Aligner] Low confidence score, skipping alignment for formula');
      return [];
    }

    anchorItems = scoredAnchors.map(s => s.item);
  }

  // Use the best anchor to find the formula line
  const bestAnchor = anchorItems[0];
  const anchorY = (bestAnchor.bounds.minY + bestAnchor.bounds.maxY) / 2;

  // Find all text items on the same line as the anchor
  const lineItems = textItems.filter(item => {
    const itemY = (item.bounds.minY + item.bounds.maxY) / 2;
    return Math.abs(itemY - anchorY) < 15; // Same line tolerance
  });

  // Check if this is a full-width paragraph line
  const lineMinX = Math.min(...lineItems.map(i => i.bounds.minX));
  const lineMaxX = Math.max(...lineItems.map(i => i.bounds.maxX));
  const lineWidth = lineMaxX - lineMinX;

  if (lineWidth > pageWidth * 0.7) {
    // Inline formula - only return math-like items
    const mathItems = lineItems.filter(item =>
      formulaScore(item.text) > 0.15 ||
      anchorItems.includes(item) ||
      /[=()[\]{}]/.test(item.text)
    );
    return mathItems.length > 0 ? mathItems : [bestAnchor];
  }

  // Standalone formula - return all items on the line that look like formula content
  const formulaItems = lineItems.filter(item =>
    formulaScore(item.text) > 0.1 ||
    /[=()[\]{}0-9]/.test(item.text) ||
    anchorItems.includes(item)
  );

  return formulaItems.length > 0 ? formulaItems : lineItems;
}

/**
 * Fallback: find items by Gemini's position
 */
function findItemsByGeminiPosition(
  textItems: PDFTextItem[],
  geminiBounds: { minX: number; minY: number; maxX: number; maxY: number },
  pageWidth: number
): PDFTextItem[] {
  const geminiCenterY = (geminiBounds.minY + geminiBounds.maxY) / 2;
  const geminiHeight = geminiBounds.maxY - geminiBounds.minY;
  const yTolerance = Math.max(geminiHeight * 1.5, 30);

  const lineItems = textItems.filter(item => {
    const itemCenterY = (item.bounds.minY + item.bounds.maxY) / 2;
    return Math.abs(itemCenterY - geminiCenterY) < yTolerance;
  });

  if (lineItems.length === 0) {
    return [];
  }

  // Filter to math-like items
  const mathItems = lineItems.filter(item =>
    formulaScore(item.text) > 0.15 || /[=()[\]{}]/.test(item.text)
  );

  return mathItems.length > 0 ? mathItems : [];
}

/**
 * Compute bounding box from a set of text items
 */
function computeBoundsFromTextItems(items: PDFTextItem[]): AlignedBounds | null {
  if (items.length === 0) return null;

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const item of items) {
    minX = Math.min(minX, item.bounds.minX);
    minY = Math.min(minY, item.bounds.minY);
    maxX = Math.max(maxX, item.bounds.maxX);
    maxY = Math.max(maxY, item.bounds.maxY);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    confidence: items.length >= 2 ? 'high' : 'medium',
    source: 'pdf'
  };
}

/**
 * Convert Gemini bounding box to PDF coordinates
 */
function geminiToPdfBounds(
  bbox: [number, number, number, number],
  pageWidth: number,
  pageHeight: number
): AlignedBounds {
  const [x, y, width, height] = bbox;
  return {
    minX: x * pageWidth,
    maxX: (x + width) * pageWidth,
    minY: (1 - y - height) * pageHeight,
    maxY: (1 - y) * pageHeight,
    confidence: 'low',
    source: 'gemini'
  };
}

/**
 * Align elements for a single page
 */
function alignPageElements(
  geminiPage: { page_number: number; elements: GeminiElement[] },
  pdfPage: PDFPage | null,
  textItems: PDFTextItem[]
): PageAlignedElements {
  const pageWidth = pdfPage?.size.width ?? 612;
  const pageHeight = pdfPage?.size.height ?? 792;

  const alignedElements: AlignedElement[] = [];

  for (const element of geminiPage.elements) {
    const geminiBounds = geminiToPdfBounds(element.bounding_box, pageWidth, pageHeight);
    const content = typeof element.content === 'string' ? element.content : JSON.stringify(element.content);

    let finalBounds: AlignedBounds = geminiBounds;
    let matchedItems: PDFTextItem[] | undefined;

    // For formulas, try to find text items on the same line in the PDF
    if (element.type === 'formula' && textItems.length > 0) {
      // Check if Gemini bounds are valid (not negative or off-page)
      const geminiIsValid = geminiBounds.minY >= 0 && geminiBounds.maxY <= pageHeight * 1.1 &&
                           geminiBounds.minY < geminiBounds.maxY;

      matchedItems = findFormulaLineTextItems(content, textItems, geminiBounds, pageWidth, pageHeight);

      if (matchedItems.length > 0) {
        const pdfBounds = computeBoundsFromTextItems(matchedItems);
        if (pdfBounds) {
          // Validate the computed bounds
          const geminiArea = (geminiBounds.maxX - geminiBounds.minX) * (geminiBounds.maxY - geminiBounds.minY);
          const pdfArea = (pdfBounds.maxX - pdfBounds.minX) * (pdfBounds.maxY - pdfBounds.minY);
          const geminiCenterY = (geminiBounds.minY + geminiBounds.maxY) / 2;
          const pdfCenterY = (pdfBounds.minY + pdfBounds.maxY) / 2;

          let useAlignment = true;

          // If PDF bounds are more than 3x larger, something went wrong
          if (pdfArea > geminiArea * 3 && geminiArea > 0) {
            console.debug('[Aligner] PDF bounds too large, skipping:', content.substring(0, 30));
            useAlignment = false;
          }

          // If Gemini bounds are valid and PDF Y is very different, something went wrong
          if (geminiIsValid && Math.abs(pdfCenterY - geminiCenterY) > pageHeight * 0.3) {
            console.debug('[Aligner] PDF Y too far from Gemini Y, skipping:', content.substring(0, 30));
            useAlignment = false;
          }

          // If Gemini bounds are INvalid (negative), we can't validate - be very conservative
          // Only use PDF bounds if they're in the middle 60% of the page height
          // (formulas are typically in the main content area, not at page edges/headers/footers)
          if (!geminiIsValid) {
            const pdfMidY = (pdfBounds.minY + pdfBounds.maxY) / 2;
            const pageTopThreshold = pageHeight * 0.15;  // Top 15%
            const pageBottomThreshold = pageHeight * 0.85;  // Bottom 15%
            const isInMiddleZone = pdfMidY > pageTopThreshold && pdfMidY < pageBottomThreshold;

            if (!isInMiddleZone) {
              console.debug('[Aligner] Invalid Gemini + PDF bounds outside middle zone (Y=' + pdfMidY.toFixed(1) + '), skipping:', content.substring(0, 30));
              useAlignment = false;
            }
          }

          if (useAlignment) {
            finalBounds = pdfBounds;
          } else {
            matchedItems = undefined;
            // If Gemini bounds are invalid, mark this formula as not reliably locatable
            if (!geminiIsValid) {
              finalBounds = { ...geminiBounds, confidence: 'low' };
            }
          }
        }
      }
    }

    // For tables, try to find the table region
    if (element.type === 'table' && textItems.length > 0) {
      // Tables are harder - use Gemini bounds but expand based on nearby text
      const nearbyItems = textItems.filter(item =>
        item.bounds.maxY >= geminiBounds.minY - 20 &&
        item.bounds.minY <= geminiBounds.maxY + 20 &&
        item.bounds.maxX >= geminiBounds.minX - 20 &&
        item.bounds.minX <= geminiBounds.maxX + 20
      );

      if (nearbyItems.length > 0) {
        const pdfBounds = computeBoundsFromTextItems(nearbyItems);
        if (pdfBounds) {
          finalBounds = {
            ...pdfBounds,
            confidence: 'medium',
            source: 'combined'
          };
          matchedItems = nearbyItems;
        }
      }
    }

    alignedElements.push({
      type: element.type,
      content,
      bounds: finalBounds,
      originalGeminiBounds: element.bounding_box,
      matchedTextItems: matchedItems
    });
  }

  return {
    pageNumber: geminiPage.page_number,
    elements: alignedElements
  };
}

/**
 * Main alignment function
 * Combines Gemini extraction with PDF text items to get accurate bounds
 */
export function alignElementBounds(
  geminiExtraction: GeminiDocumentExtraction,
  pdfPages: PDFPage[],
  textItemsByPage: Map<number, PDFTextItem[]>
): AlignmentResult {
  const pages: PageAlignedElements[] = [];

  for (const geminiPage of geminiExtraction.pages) {
    const pdfPage = pdfPages.find(p => p.number === geminiPage.page_number) ?? null;
    const textItems = textItemsByPage.get(geminiPage.page_number) ?? [];

    const alignedPage = alignPageElements(geminiPage, pdfPage, textItems);
    pages.push(alignedPage);
  }

  return { pages };
}

/**
 * Get aligned bounds for a specific element type on a page
 */
export function getAlignedElementsForPage(
  alignment: AlignmentResult,
  pageNumber: number,
  elementType?: GeminiElement['type']
): AlignedElement[] {
  const page = alignment.pages.find(p => p.pageNumber === pageNumber);
  if (!page) return [];

  if (elementType) {
    return page.elements.filter(e => e.type === elementType);
  }
  return page.elements;
}

/**
 * Find aligned element at a point
 */
export function findAlignedElementAtPoint(
  alignment: AlignmentResult,
  pageNumber: number,
  pdfX: number,
  pdfY: number,
  elementType?: GeminiElement['type'],
  tolerance: number = 10
): AlignedElement | null {
  const elements = getAlignedElementsForPage(alignment, pageNumber, elementType);

  for (const element of elements) {
    const { bounds } = element;
    if (
      pdfX >= bounds.minX - tolerance &&
      pdfX <= bounds.maxX + tolerance &&
      pdfY >= bounds.minY - tolerance &&
      pdfY <= bounds.maxY + tolerance
    ) {
      return element;
    }
  }

  return null;
}
