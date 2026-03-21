import { describe, expect, it } from 'vitest';

import {
  detectStructuredExtractPageYBand,
  normalizeStructuredExtractRatioBounds,
  readStructuredExtractRawBounds,
  toPdfBoundsFromNormalizedRatioBounds
} from '../src/query/structuredExtractBounds';

describe('structuredExtractBounds', () => {
  it('detects a dominant stacked y-band for later pages', () => {
    const band = detectStructuredExtractPageYBand([
      { bbox: [0.176, 1.159, 0.648, 0.029] },
      { bbox: [0.221, 1.193, 0.562, 0.088] },
      { bbox: [0.176, 1.300, 0.648, 0.070] }
    ]);

    expect(band).toBe(1);
  });

  it('does not force a stacked y-band from minor overflow near the page footer', () => {
    const band = detectStructuredExtractPageYBand([
      { bbox: [0.176, 0.086, 0.648, 0.082] },
      { bbox: [0.176, 0.925, 0.648, 0.043] },
      { bbox: [0.495, 1.027, 0.01, 0.012] }
    ]);

    expect(band).toBe(0);
  });

  it('unwraps stacked y coordinates into page-local ratio bounds', () => {
    const raw = readStructuredExtractRawBounds([0.221, 1.193, 0.562, 0.088]);
    expect(raw).not.toBeNull();

    const normalized = normalizeStructuredExtractRatioBounds(raw!, 1);
    expect(normalized?.map((value) => Number(value.toFixed(4)))).toEqual([0.221, 0.193, 0.562, 0.088]);

    const pdfBounds = toPdfBoundsFromNormalizedRatioBounds(normalized!, 612, 792);
    expect(pdfBounds[1]).toBeGreaterThan(0);
    expect(pdfBounds[3]).toBeGreaterThan(pdfBounds[1]);
  });

  it('clamps minor bottom overflow without wrapping it to the top of the page', () => {
    const raw = readStructuredExtractRawBounds([0.495, 1.027, 0.01, 0.012]);
    expect(raw).not.toBeNull();

    const normalized = normalizeStructuredExtractRatioBounds(raw!, 0);
    expect(normalized).toBeNull();
  });
});
