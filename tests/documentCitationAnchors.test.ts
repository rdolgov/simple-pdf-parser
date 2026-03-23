import { describe, expect, it } from 'vitest';
import { locateEvidenceQuote, resolveDocumentCitationAnchor } from '../server/src/documentCitationAnchors.js';
import type { DocumentEvidenceRecord } from '../server/src/documentEvidenceIndex.js';

function createRecord(): DocumentEvidenceRecord {
  return {
    evidenceId: 'p1-paragraph-0-test',
    pageNumber: 1,
    kind: 'paragraph',
    text: 'Alpha  Beta gamma',
    normalizedText: 'alpha beta gamma',
    bounds: {
      minX: 10,
      minY: 100,
      maxX: 90,
      maxY: 130
    },
    textRuns: [
      {
        text: 'Alpha',
        start: 0,
        end: 5,
        bounds: {
          minX: 10,
          minY: 100,
          maxX: 40,
          maxY: 120
        }
      },
      {
        text: 'Beta',
        start: 7,
        end: 11,
        bounds: {
          minX: 50,
          minY: 100,
          maxX: 74,
          maxY: 120
        }
      },
      {
        text: 'gamma',
        start: 12,
        end: 17,
        bounds: {
          minX: 75,
          minY: 100,
          maxX: 90,
          maxY: 120
        }
      }
    ]
  };
}

describe('documentCitationAnchors', () => {
  it('locates exact quotes directly in the evidence text', () => {
    const record = createRecord();
    const match = locateEvidenceQuote(record, 'Beta');
    expect(match).toEqual({
      quote: 'Beta',
      start: 7,
      end: 11,
      matchStrategy: 'exact-quote'
    });
  });

  it('falls back to normalized matching for whitespace differences', () => {
    const record = createRecord();
    const match = locateEvidenceQuote(record, 'Alpha Beta');
    expect(match?.matchStrategy).toBe('normalized-quote');
    expect(match?.quote).toBe('Alpha  Beta');
    expect(match?.start).toBe(0);
    expect(match?.end).toBe(11);
  });

  it('merges bounds across multiple runs for a resolved quote', () => {
    const record = createRecord();
    const match = locateEvidenceQuote(record, 'Beta gamma');
    const anchor = resolveDocumentCitationAnchor('doc-1', record, match, 'Beta gamma');
    expect(anchor.matchStrategy).toBe('exact-quote');
    expect(anchor.bounds).toEqual({
      minX: 50,
      minY: 100,
      maxX: 90,
      maxY: 120
    });
  });

  it('falls back to the block bounds when a quote cannot be resolved', () => {
    const record = createRecord();
    const anchor = resolveDocumentCitationAnchor('doc-1', record, null, 'missing quote');
    expect(anchor.matchStrategy).toBe('block-fallback');
    expect(anchor.bounds).toEqual(record.bounds);
  });
});
