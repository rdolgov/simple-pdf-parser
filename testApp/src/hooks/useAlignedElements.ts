/**
 * Hook to compute and cache aligned element bounds
 * Combines Gemini extraction with PDF text items for accurate positioning
 */

import { useState, useEffect, useMemo } from 'react';
import type { PDFPage, PDFTextItem } from 'pdf-layout-parser';
import type { GeminiDocumentExtraction } from '../storage/geminiExtractionStorage';
import {
  type AlignmentResult,
  type AlignedElement,
  alignElementBounds,
  findAlignedElementAtPoint,
  getAlignedElementsForPage
} from '../utils/elementBoundsAligner';

export interface UseAlignedElementsOptions {
  geminiExtraction: GeminiDocumentExtraction | null;
  pdfPages: PDFPage[];
  getTextItemsForPage: (pageNumber: number) => PDFTextItem[];
}

export interface UseAlignedElementsResult {
  alignment: AlignmentResult | null;
  isAligning: boolean;
  findElementAtPoint: (
    pageNumber: number,
    pdfX: number,
    pdfY: number,
    elementType?: AlignedElement['type'],
    tolerance?: number
  ) => AlignedElement | null;
  getElementsForPage: (
    pageNumber: number,
    elementType?: AlignedElement['type']
  ) => AlignedElement[];
}

export function useAlignedElements({
  geminiExtraction,
  pdfPages,
  getTextItemsForPage
}: UseAlignedElementsOptions): UseAlignedElementsResult {
  const [alignment, setAlignment] = useState<AlignmentResult | null>(null);
  const [isAligning, setIsAligning] = useState(false);

  // Build text items map
  const textItemsByPage = useMemo(() => {
    const map = new Map<number, PDFTextItem[]>();
    for (const page of pdfPages) {
      const items = getTextItemsForPage(page.number);
      if (items.length > 0) {
        map.set(page.number, items);
      }
    }
    return map;
  }, [pdfPages, getTextItemsForPage]);

  // Compute alignment when inputs change
  useEffect(() => {
    if (!geminiExtraction || pdfPages.length === 0) {
      setAlignment(null);
      return;
    }

    setIsAligning(true);

    // Use requestIdleCallback or setTimeout to avoid blocking
    const timeoutId = setTimeout(() => {
      try {
        const result = alignElementBounds(geminiExtraction, pdfPages, textItemsByPage);
        setAlignment(result);
        console.debug('[AlignedElements] Alignment complete:', {
          pages: result.pages.length,
          totalElements: result.pages.reduce((sum, p) => sum + p.elements.length, 0)
        });
      } catch (err) {
        console.error('[AlignedElements] Alignment failed:', err);
        setAlignment(null);
      } finally {
        setIsAligning(false);
      }
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [geminiExtraction, pdfPages, textItemsByPage]);

  // Memoized lookup functions
  const findElementAtPoint = useMemo(() => {
    return (
      pageNumber: number,
      pdfX: number,
      pdfY: number,
      elementType?: AlignedElement['type'],
      tolerance: number = 10
    ): AlignedElement | null => {
      if (!alignment) return null;
      return findAlignedElementAtPoint(alignment, pageNumber, pdfX, pdfY, elementType, tolerance);
    };
  }, [alignment]);

  const getElementsForPage = useMemo(() => {
    return (
      pageNumber: number,
      elementType?: AlignedElement['type']
    ): AlignedElement[] => {
      if (!alignment) return [];
      return getAlignedElementsForPage(alignment, pageNumber, elementType);
    };
  }, [alignment]);

  return {
    alignment,
    isAligning,
    findElementAtPoint,
    getElementsForPage
  };
}
