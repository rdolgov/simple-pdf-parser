import { describe, expect, it } from 'vitest';

import { mergeStructuredDetectPageResults, mergeStructuredDetectUnitResults } from '../server/src/structuredDetectMerge';

describe('structuredDetectMerge', () => {
  it('merges page-scoped extraction results into one ordered document with scoped asset paths', () => {
    const merged = mergeStructuredDetectPageResults([
      {
        pageNumber: 2,
        result: {
          model: 'gemini-3-flash-preview',
          rawText: 'second page',
          document: {
            pages: [{ page_number: 0, width: 200, height: 300 }],
            elements: [
              {
                Path: '//Document/Paragraph',
                Page: 0,
                Text: 'Second page paragraph',
                filePaths: ['table-2.xlsx']
              }
            ]
          },
          parsedTables: [
            {
              name: 'table-2.xlsx',
              rows: [['B']]
            }
          ],
          assetMap: {}
        }
      },
      {
        pageNumber: 1,
        result: {
          model: 'gemini-3-flash-preview',
          rawText: 'first page',
          document: {
            pages: [{ page_number: 0, width: 200, height: 300 }],
            elements: [
              {
                Path: '//Document/Table',
                Page: 0,
                Text: 'First page table',
                filePaths: ['table-1.xlsx', 'figure-1.png']
              }
            ]
          },
          parsedTables: [
            {
              name: 'table-1.xlsx',
              rows: [['A']]
            }
          ],
          assetMap: {
            'figure-1.png': 'data:image/png;base64,AAAA'
          }
        }
      }
    ]);

    expect((merged.document as { pages?: unknown[] }).pages).toHaveLength(2);
    expect((merged.document as { pages?: Array<{ page_number?: number }> }).pages?.map((page) => page.page_number)).toEqual([
      0,
      1
    ]);
    expect((merged.document as { elements?: Array<{ Page?: number; elementId?: number; filePaths?: string[] }> }).elements).toEqual([
      {
        Path: '//Document/Table',
        Page: 0,
        Text: 'First page table',
        elementId: 0,
        filePaths: ['pages/page-0001/table-1.xlsx', 'pages/page-0001/figure-1.png']
      },
      {
        Path: '//Document/Paragraph',
        Page: 1,
        Text: 'Second page paragraph',
        elementId: 1,
        filePaths: ['pages/page-0002/table-2.xlsx']
      }
    ]);
    expect(merged.parsedTables).toEqual([
      { name: 'pages/page-0001/table-1.xlsx', rows: [['A']] },
      { name: 'pages/page-0002/table-2.xlsx', rows: [['B']] }
    ]);
    expect(merged.assetMap).toEqual({
      'pages/page-0001/figure-1.png': 'data:image/png;base64,AAAA'
    });
    expect(merged.rawText).toBe('first page\n\nsecond page');
  });

  it('renumbers multi-page batch results onto absolute page numbers', () => {
    const merged = mergeStructuredDetectUnitResults([
      {
        startPage: 2,
        pageCount: 2,
        result: {
          model: 'gemini-3-flash-preview',
          rawText: 'middle batch',
          document: {
            pages: [
              { page_number: 0, width: 200, height: 300 },
              { page_number: 1, width: 200, height: 300 }
            ],
            elements: [
              {
                Path: '//Document/Figure',
                Page: 0,
                filePaths: ['figure-2.png']
              },
              {
                Path: '//Document/Table',
                Page: 1,
                filePaths: ['table-3.xlsx']
              }
            ]
          },
          parsedTables: [
            {
              name: 'table-3.xlsx',
              rows: [['C']]
            }
          ],
          assetMap: {
            'figure-2.png': 'data:image/png;base64,BBBB'
          }
        }
      }
    ]);

    expect((merged.document as { pages?: Array<{ page_number?: number }> }).pages?.map((page) => page.page_number)).toEqual([
      1,
      2
    ]);
    expect((merged.document as { elements?: Array<{ Page?: number; filePaths?: string[] }> }).elements).toEqual([
      {
        Path: '//Document/Figure',
        Page: 1,
        elementId: 0,
        filePaths: ['pages/page-0002/figure-2.png']
      },
      {
        Path: '//Document/Table',
        Page: 2,
        elementId: 1,
        filePaths: ['pages/page-0003/table-3.xlsx']
      }
    ]);
    expect(merged.parsedTables).toEqual([
      { name: 'pages/page-0003/table-3.xlsx', rows: [['C']] }
    ]);
    expect(merged.assetMap).toEqual({
      'pages/page-0002/figure-2.png': 'data:image/png;base64,BBBB'
    });
  });
});
