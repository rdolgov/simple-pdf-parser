import type { PDFDocument, PDFPage } from 'pdf-layout-parser';

export interface AiDetectionSupport {
  supported: boolean;
  message?: string;
}

const IMAGE_DOMINANT_PAGE_COVERAGE = 0.6;
const MIN_MEANINGFUL_TEXT_CHARS_PER_IMAGE_PAGE = 120;

export function analyzeAiDetectionSupport(document: PDFDocument): AiDetectionSupport {
  const totalPages = document.pages.length;
  if (totalPages === 0) {
    return { supported: true };
  }

  const imageDominantPages = document.pages.filter(isImageDominantPage);
  if (imageDominantPages.length <= totalPages / 2) {
    return { supported: true };
  }

  const totalMeaningfulTextChars = imageDominantPages.reduce(
    (sum, page) => sum + countMeaningfulTextChars(page),
    0
  );
  const averageMeaningfulTextChars = totalMeaningfulTextChars / imageDominantPages.length;

  if (averageMeaningfulTextChars >= MIN_MEANINGFUL_TEXT_CHARS_PER_IMAGE_PAGE) {
    return { supported: true };
  }

  return {
    supported: false,
    message: 'This PDF appears to be image-based with little or no extractable text. AI detection is not supported, so API calls are skipped.'
  };
}

function isImageDominantPage(page: PDFPage): boolean {
  const pageArea = page.size.width * page.size.height;
  if (!(pageArea > 0)) {
    return false;
  }

  let maxImageCoverage = 0;
  for (const image of page.imageItems) {
    const width = Math.max(0, image.bounds.maxX - image.bounds.minX);
    const height = Math.max(0, image.bounds.maxY - image.bounds.minY);
    const coverage = (width * height) / pageArea;
    if (coverage > maxImageCoverage) {
      maxImageCoverage = coverage;
    }
  }

  return maxImageCoverage >= IMAGE_DOMINANT_PAGE_COVERAGE;
}

function countMeaningfulTextChars(page: PDFPage): number {
  let count = 0;

  for (const item of page.textItems) {
    const matches = item.text.normalize('NFKC').match(/[\p{L}\p{N}]/gu);
    count += matches?.length ?? 0;
  }

  return count;
}
