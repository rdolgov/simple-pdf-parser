import { describe, expect, it } from 'vitest';

import { CanvasRenderer } from '../src/viewer/canvasRenderer.js';
import type { CanvasLike } from '../src/viewer/canvasRenderer.js';
import type { PDFLayout } from '../src/types.js';
import { PDFDocument } from '../src/pdfDocument.js';
import { RecordingCanvas, RecordingContext } from './support/recordingCanvas.js';

class MockContext {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  lineCap: CanvasLineCap = 'butt';
  lineJoin: CanvasLineJoin = 'miter';
  miterLimit = 10;
  font = '';
  textBaseline = 'alphabetic';
  imageSmoothingEnabled = true;
  textRendering?: string;
  operations: string[] = [];

  setTransform() {
    this.operations.push('setTransform');
  }

  scale(x: number, y: number) {
    this.operations.push(`scale:${x},${y}`);
  }

  clearRect(x: number, y: number, width: number, height: number) {
    this.operations.push(`clearRect:${x},${y},${width},${height}`);
  }

  save() {
    this.operations.push('save');
  }

  restore() {
    this.operations.push('restore');
  }

  fillRect(x: number, y: number, width: number, height: number) {
    this.operations.push(`fillRect:${x},${y},${width},${height}`);
  }

  fillText(text: string, x: number, y: number) {
    this.operations.push(`fillText:${text}@${x},${y}`);
  }

  measureText(text: string) {
    return { width: Math.max(text.length * 10, 1) } as TextMetrics;
  }

  translate(x: number, y: number) {
    this.operations.push(`translate:${x},${y}`);
  }

  rotate(angle: number) {
    this.operations.push(`rotate:${angle.toFixed(3)}`);
  }

  beginPath() {
    this.operations.push('beginPath');
  }

  moveTo(x: number, y: number) {
    this.operations.push(`moveTo:${x},${y}`);
  }

  lineTo(x: number, y: number) {
    this.operations.push(`lineTo:${x},${y}`);
  }

  stroke() {
    this.operations.push('stroke');
    this.operations.push(`strokeWidth:${this.lineWidth}`);
  }

  fill(fillRule?: CanvasFillRule) {
    this.operations.push(`fill:${fillRule ?? 'nonzero'}`);
  }

  rect(x: number, y: number, width: number, height: number) {
    this.operations.push(`rect:${x},${y},${width},${height}`);
  }

  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
    this.operations.push(`bezierCurveTo:${x1},${y1},${x2},${y2},${x3},${y3}`);
  }

  closePath() {
    this.operations.push('closePath');
  }
}

class MockCanvas implements CanvasLike {
  width = 0;
  height = 0;
  constructor(private readonly context: CanvasRenderingContext2D) {}

  getContext(type: '2d'): CanvasRenderingContext2D | null {
    if (type === '2d') {
      return this.context;
    }
    return null;
  }
}

class ScriptMetricRecordingContext extends RecordingContext {
  override measureText(text: string): TextMetrics {
    const fontSize = readFontSizeForTest(this.font);
    const width = Math.max(text.length * fontSize * 0.52, 1);
    const isSmallScript = fontSize <= 7.5;
    const actualBoundingBoxAscent = isSmallScript ? fontSize * 1.05 : fontSize * 0.8;
    const actualBoundingBoxDescent = isSmallScript ? fontSize * 0.45 : fontSize * 0.2;
    return {
      width,
      actualBoundingBoxAscent,
      actualBoundingBoxDescent,
      fontBoundingBoxAscent: actualBoundingBoxAscent,
      fontBoundingBoxDescent: actualBoundingBoxDescent
    } as TextMetrics;
  }
}

describe('CanvasRenderer', () => {
  it('renders PDF text items onto a canvas context', () => {
    const contextImpl = new MockContext();
    const canvas = new MockCanvas(contextImpl as unknown as CanvasRenderingContext2D);

    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          textItems: [
            {
              text: 'Hello',
              bounds: { minX: 100, minY: 720, maxX: 150, maxY: 732 },
              fontSize: 12
            },
            {
              text: 'World',
              bounds: { minX: 100, minY: 702, maxX: 140, maxY: 714 },
              fontSize: 12
            }
          ],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          size: { width: 612, height: 792 }
        }
      ]
    };

    const document = new PDFDocument(layout);
    const renderer = new CanvasRenderer({
      backgroundColor: '#eeeeee',
      textColor: '#111111',
      pagePadding: 8,
      scale: 1
    });

    renderer.render(canvas, document, 1);

    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);

    const operations = contextImpl.operations;
    expect(operations.some((entry) => entry.startsWith('fillText:Hello'))).toBe(true);
    expect(operations.some((entry) => entry.startsWith('fillText:World'))).toBe(true);
  });

  it('renders CMEX brace construction fragments as vector braces', () => {
    const contextImpl = new MockContext();
    const canvas = new MockCanvas(contextImpl as unknown as CanvasRenderingContext2D);

    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          textItems: [
            {
              text: 'z}|',
              bounds: { minX: 20, minY: 60, maxX: 34, maxY: 70 },
              font: 'CMEX10',
              fontSize: 10,
              baselineStart: { x: 20, y: 62 },
              baselineEnd: { x: 34, y: 62 }
            },
            {
              text: '{',
              bounds: { minX: 34.5, minY: 50, maxX: 39, maxY: 73 },
              font: 'CMEX10',
              fontSize: 10,
              baselineStart: { x: 34.5, y: 62 },
              baselineEnd: { x: 39, y: 62 }
            },
            {
              text: '{z',
              bounds: { minX: 50, minY: 40, maxX: 59, maxY: 50 },
              font: 'CMEX10',
              fontSize: 10,
              baselineStart: { x: 50, y: 42 },
              baselineEnd: { x: 59, y: 42 }
            },
            {
              text: '|',
              bounds: { minX: 45.5, minY: 20, maxX: 50, maxY: 43 },
              font: 'CMEX10',
              fontSize: 10,
              baselineStart: { x: 45.5, y: 42 },
              baselineEnd: { x: 50, y: 42 }
            },
            {
              text: '}',
              bounds: { minX: 59.5, minY: 20, maxX: 64, maxY: 43 },
              font: 'CMEX10',
              fontSize: 10,
              baselineStart: { x: 59.5, y: 42 },
              baselineEnd: { x: 64, y: 42 }
            }
          ],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          size: { width: 100, height: 100 }
        }
      ]
    };

    const document = new PDFDocument(layout);
    const renderer = new CanvasRenderer({ pagePadding: 8, scale: 1 });

    renderer.render(canvas, document, 1);

    const operations = contextImpl.operations;
    expect(operations.filter((entry) => entry.startsWith('bezierCurveTo:')).length).toBeGreaterThanOrEqual(8);
    expect(operations.filter((entry) => entry === 'stroke').length).toBeGreaterThanOrEqual(2);
    expect(operations.some((entry) => entry.startsWith('fillText:z}|@'))).toBe(false);
    expect(operations.some((entry) => entry.startsWith('fillText:{@'))).toBe(false);
    expect(operations.some((entry) => entry.startsWith('fillText:{z@'))).toBe(false);
    expect(operations.some((entry) => entry.startsWith('fillText:|@'))).toBe(false);
    expect(operations.some((entry) => entry.startsWith('fillText:}@'))).toBe(false);
  });

  it('renders CMMI glyph spans character-by-character instead of browser-shaping the full run', () => {
    const contextImpl = new MockContext();
    const canvas = new MockCanvas(contextImpl as unknown as CanvasRenderingContext2D);

    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          textItems: [
            {
              text: 'rrr',
              bounds: { minX: 20, minY: 60, maxX: 44, maxY: 70 },
              font: 'CMMI10~80',
              fontSize: 10,
              fontStyle: 'italic',
              baselineStart: { x: 20, y: 62 },
              baselineEnd: { x: 44, y: 62 },
              glyphSpans: [
                { text: 'r', advance: 8 },
                { text: 'r', advance: 8 },
                { text: 'r', advance: 8 }
              ]
            }
          ],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          size: { width: 100, height: 100 }
        }
      ]
    };

    const document = new PDFDocument(layout);
    const renderer = new CanvasRenderer({ pagePadding: 8, scale: 1 });

    renderer.render(canvas, document, 1);

    const rDraws = contextImpl.operations.filter((entry) => entry.startsWith('fillText:r@'));
    expect(rDraws).toHaveLength(3);
    expect(contextImpl.operations.some((entry) => entry.startsWith('fillText:rrr@'))).toBe(false);
  });

  it('renders Computer Modern italic words with per-glyph advances instead of browser-shaping the full run', () => {
    const contextImpl = new MockContext();
    const canvas = new MockCanvas(contextImpl as unknown as CanvasRenderingContext2D);

    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          textItems: [
            {
              text: 'Approximating',
              bounds: { minX: 20, minY: 60, maxX: 96, maxY: 72 },
              font: 'CMTI12',
              fontSize: 12,
              fontStyle: 'italic',
              baselineStart: { x: 20, y: 62 },
              baselineEnd: { x: 96, y: 62 },
              glyphSpans: Array.from('Approximating', (text) => ({ text, advance: 500 }))
            }
          ],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          size: { width: 120, height: 100 }
        }
      ]
    };

    const document = new PDFDocument(layout);
    const renderer = new CanvasRenderer({ pagePadding: 8, scale: 1 });

    renderer.render(canvas, document, 1);

    expect(contextImpl.operations.some((entry) => entry.startsWith('fillText:Approximating@'))).toBe(false);
    expect(contextImpl.operations.filter((entry) => entry.startsWith('fillText:A@'))).toHaveLength(1);
    expect(contextImpl.operations.filter((entry) => entry.startsWith('fillText:p@')).length).toBeGreaterThanOrEqual(2);
  });

  it('renders tall CMEX delimiters as vector outlines instead of scaled text glyphs', () => {
    const contextImpl = new MockContext();
    const canvas = new MockCanvas(contextImpl as unknown as CanvasRenderingContext2D);

    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          textItems: [
            {
              text: '(',
              bounds: { minX: 20, minY: 30, maxX: 25, maxY: 56 },
              font: 'CMEX10',
              fontSize: 10,
              baselineStart: { x: 20, y: 55 },
              baselineEnd: { x: 25, y: 55 }
            },
            {
              text: ')',
              bounds: { minX: 28, minY: 30, maxX: 33, maxY: 56 },
              font: 'CMEX10',
              fontSize: 10,
              baselineStart: { x: 28, y: 55 },
              baselineEnd: { x: 33, y: 55 }
            }
          ],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          size: { width: 80, height: 100 }
        }
      ]
    };

    const document = new PDFDocument(layout);
    const renderer = new CanvasRenderer({ pagePadding: 8, scale: 1 });

    renderer.render(canvas, document, 1);

    expect(contextImpl.operations.filter((entry) => entry.startsWith('bezierCurveTo:')).length).toBeGreaterThanOrEqual(4);
    expect(contextImpl.operations.some((entry) => entry.startsWith('fillText:(@'))).toBe(false);
    expect(contextImpl.operations.some((entry) => entry.startsWith('fillText:)@'))).toBe(false);
  });

  it('renders preserved Bezier page paths instead of flattening them to straight lines', () => {
    const contextImpl = new MockContext();
    const canvas = new MockCanvas(contextImpl as unknown as CanvasRenderingContext2D);

    const layout = {
      pages: [
        {
          number: 1,
          textItems: [],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          pathItems: [
            {
              commands: [
                { op: 'M' as const, x: 40, y: 40 },
                { op: 'C' as const, x1: 50, y1: 60, x2: 70, y2: 60, x3: 80, y3: 40 },
                { op: 'Z' as const }
              ],
              lineWidth: 2,
              strokeColor: [0, 0, 0, 1] as [number, number, number, number],
              fillColor: [1, 1, 1, 1] as [number, number, number, number],
              fillRule: 'nonzero' as const,
              lineCap: 'round' as const,
              lineJoin: 'round' as const,
              miterLimit: 10
            }
          ],
          size: { width: 100, height: 100 }
        }
      ]
    };

    const document = new PDFDocument(layout);
    const renderer = new CanvasRenderer({ pagePadding: 8, scale: 1 });

    renderer.render(canvas, document, 1);

    expect(contextImpl.operations.some((entry) => entry.startsWith('bezierCurveTo:'))).toBe(true);
    expect(contextImpl.operations).toContain('fill:nonzero');
    expect(contextImpl.operations).toContain('stroke');
  });

  it('renders solid image masks with fillRect instead of raster blurring', () => {
    const contextImpl = new MockContext();
    const canvas = new MockCanvas(contextImpl as unknown as CanvasRenderingContext2D);

    const layout = {
      pages: [
        {
          number: 1,
          textItems: [],
          imageItems: [
            {
              name: 'inline:1',
              bounds: { minX: 10, minY: 80, maxX: 90, maxY: 81 },
              fillColor: [0, 0, 0, 1] as [number, number, number, number],
              mask: {
                width: 1,
                height: 1,
                data: new Uint8Array([0]),
                blackIs1: false
              }
            }
          ],
          lineItems: [],
          rectItems: [],
          size: { width: 100, height: 100 }
        }
      ]
    };

    const document = new PDFDocument(layout);
    const renderer = new CanvasRenderer({ pagePadding: 8, scale: 1 });

    renderer.render(canvas, document, 1);

    expect(contextImpl.operations.some((entry) => entry.startsWith('fillRect:18,27,80,1'))).toBe(true);
  });

  it('uses a small thin-stroke floor instead of forcing sub-point strokes to 0.5pt', () => {
    const contextImpl = new MockContext();
    const canvas = new MockCanvas(contextImpl as unknown as CanvasRenderingContext2D);

    const layout = {
      pages: [
        {
          number: 1,
          textItems: [],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          pathItems: [
            {
              commands: [
                { op: 'M' as const, x: 10, y: 10 },
                { op: 'L' as const, x: 90, y: 10 }
              ],
              lineWidth: 0.1,
              strokeColor: [0, 0, 0, 1] as [number, number, number, number],
              fillColor: null,
              fillRule: 'nonzero' as const,
              lineCap: 'butt' as const,
              lineJoin: 'miter' as const,
              miterLimit: 10
            }
          ],
          size: { width: 100, height: 100 }
        }
      ]
    };

    const document = new PDFDocument(layout);
    const renderer = new CanvasRenderer({ pagePadding: 8, scale: 1 });

    renderer.render(canvas, document, 1);

    expect(contextImpl.operations).toContain('strokeWidth:0.25');
    expect(contextImpl.operations).not.toContain('strokeWidth:0.5');
  });

  it('throws when page does not exist', () => {
    const contextImpl = new MockContext();
    const canvas = new MockCanvas(contextImpl as unknown as CanvasRenderingContext2D);
    const document = new PDFDocument({ pages: [] });
    const renderer = new CanvasRenderer();

    expect(() => renderer.render(canvas, document, 1)).toThrow('Page 1 does not exist.');
  });

  it('renders rotated text items using their baseline geometry', () => {
    const contextImpl = new MockContext();
    const canvas = new MockCanvas(contextImpl as unknown as CanvasRenderingContext2D);

    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          textItems: [
            {
              text: 'arXiv:1610.04457v1 [physics.pop-ph] 28 Sep 2016',
              bounds: { minX: 16, minY: 187, maxX: 36, maxY: 677 },
              baselineStart: { x: 26, y: 187 },
              baselineEnd: { x: 26, y: 677 },
              fontSize: 20
            }
          ],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          size: { width: 612, height: 792 }
        }
      ]
    };

    const document = new PDFDocument(layout);
    const renderer = new CanvasRenderer({ pagePadding: 8, scale: 1 });
    renderer.render(canvas, document, 1);

    const operations = contextImpl.operations;
    expect(operations.some((entry) => entry.startsWith('rotate:-1.571'))).toBe(true);
    expect(operations.some((entry) => entry.startsWith('fillText:arXiv:1610.04457v1'))).toBe(true);
  });

  it('skips suspiciously wide whitespace Type3 OCR artifacts', () => {
    const contextImpl = new MockContext();
    const canvas = new MockCanvas(contextImpl as unknown as CanvasRenderingContext2D);

    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          textItems: [
            {
              text: '\u00a0',
              bounds: { minX: 100, minY: 720, maxX: 260, maxY: 728 },
              type3Glyphs: [
                {
                  glyphName: 'bogusSpace',
                  width: 1,
                  pathCommands: [
                    { op: 'M', x: 0, y: 0 },
                    { op: 'L', x: 0.5, y: 0 },
                    { op: 'L', x: 0.5, y: 0.7 },
                    { op: 'Z' },
                    { op: 'f' }
                  ]
                }
              ]
            }
          ],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          size: { width: 612, height: 792 }
        }
      ]
    };

    const document = new PDFDocument(layout);
    const renderer = new CanvasRenderer({ pagePadding: 8, scale: 1 });
    renderer.render(canvas, document, 1);

    const operations = contextImpl.operations;
    expect(operations.some((entry) => entry.startsWith('moveTo:'))).toBe(false);
    expect(operations.some((entry) => entry.startsWith('fill:'))).toBe(false);
  });

  it('uses the parsed baseline to vertically place Type3 glyphs', () => {
    const contextImpl = new MockContext();
    const canvas = new MockCanvas(contextImpl as unknown as CanvasRenderingContext2D);

    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          textItems: [
            {
              text: 'A',
              bounds: { minX: 100, minY: 50, maxX: 104, maxY: 60 },
              baselineStart: { x: 100, y: 52 },
              baselineEnd: { x: 108, y: 52 },
              type3Glyphs: [
                {
                  glyphName: 'A',
                  width: 1,
                  pathCommands: [
                    { op: 'M', x: 0.1, y: 0 },
                    { op: 'L', x: 0.4, y: 0.7 },
                    { op: 'L', x: 0.7, y: 0 },
                    { op: 'Z' },
                    { op: 'f' }
                  ]
                }
              ]
            }
          ],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          size: { width: 200, height: 200 }
        }
      ]
    };

    const document = new PDFDocument(layout);
    const renderer = new CanvasRenderer({ pagePadding: 8, scale: 1 });
    renderer.render(canvas, document, 1);

    expect(contextImpl.operations).toContain('translate:108,156');
    expect(contextImpl.operations).not.toContain('translate:108,153');
  });

  it('uses Type3 baseline advances instead of centering glyphs inside their bounds', () => {
    const contextImpl = new RecordingContext();
    const canvas = new RecordingCanvas(contextImpl);

    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          textItems: [
            {
              text: 'A',
              bounds: { minX: 10, minY: 10, maxX: 14, maxY: 18 },
              baselineStart: { x: 10, y: 10 },
              baselineEnd: { x: 18, y: 10 },
              glyphSpans: [{ text: 'A', advance: 1, glyphCode: 65 }],
              type3Glyphs: [
                {
                  glyphName: 'A',
                  width: 1,
                  pathCommands: [
                    { op: 'M', x: 0.1, y: 0 },
                    { op: 'L', x: 0.4, y: 0.7 },
                    { op: 'L', x: 0.7, y: 0 },
                    { op: 'Z' },
                    { op: 'f' }
                  ]
                }
              ]
            }
          ],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          size: { width: 100, height: 100 }
        }
      ]
    };

    const document = new PDFDocument(layout);
    const renderer = new CanvasRenderer({ pagePadding: 8, scale: 1 });
    renderer.render(canvas, document, 1);

    const fillPaint = contextImpl.pathPaints.find((paint) => paint.kind === 'fill');
    expect(fillPaint).toBeDefined();
    expect(fillPaint!.translateX).toBeCloseTo(18, 5);
    expect(fillPaint!.translateX).toBeLessThan(18.5);
  });

  it('renders CMEX product operators as vector strokes instead of raw text glyphs', () => {
    const contextImpl = new MockContext();
    const canvas = new MockCanvas(contextImpl as unknown as CanvasRenderingContext2D);

    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          textItems: [
            {
              text: '∏',
              bounds: { minX: 40, minY: 40, maxX: 54, maxY: 62 },
              font: 'CMEX10',
              fontSize: 10,
              baselineStart: { x: 40, y: 50 },
              baselineEnd: { x: 54, y: 50 },
              glyphSpans: [{ text: '∏', advance: 14, glyphCode: 89 }]
            },
            {
              text: 'N',
              bounds: { minX: 43, minY: 57, maxX: 48, maxY: 63 },
              font: 'CMMI7',
              fontSize: 6
            },
            {
              text: 'n=1',
              bounds: { minX: 41, minY: 33, maxX: 52, maxY: 39 },
              font: 'Times New Roman',
              fontSize: 6
            }
          ],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          size: { width: 100, height: 100 }
        }
      ]
    };

    const document = new PDFDocument(layout);
    const renderer = new CanvasRenderer({ pagePadding: 8, scale: 1 });
    renderer.render(canvas, document, 1);

    const operations = contextImpl.operations;
    expect(operations.some((entry) => entry.startsWith('fillText:∏@'))).toBe(false);
    expect(operations.filter((entry) => entry.startsWith('lineTo:')).length).toBeGreaterThanOrEqual(4);
    expect(operations.some((entry) => entry === 'stroke')).toBe(true);
    expect(operations.some((entry) => entry.startsWith('fillText:N@'))).toBe(true);
    expect(operations.some((entry) => entry.startsWith('fillText:n=1@'))).toBe(true);
  });

  it('renders CMEX summation operators as vector strokes instead of raw text glyphs', () => {
    const contextImpl = new MockContext();
    const canvas = new MockCanvas(contextImpl as unknown as CanvasRenderingContext2D);

    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          textItems: [
            {
              text: '∑',
              bounds: { minX: 40, minY: 40, maxX: 54, maxY: 62 },
              font: 'CMEX10',
              fontSize: 10,
              baselineStart: { x: 40, y: 50 },
              baselineEnd: { x: 54, y: 50 },
              glyphSpans: [{ text: '∑', advance: 14, glyphCode: 88 }]
            },
            {
              text: 'N',
              bounds: { minX: 43, minY: 57, maxX: 48, maxY: 63 },
              font: 'CMMI7',
              fontSize: 6
            },
            {
              text: 'r=0',
              bounds: { minX: 41, minY: 33, maxX: 52, maxY: 39 },
              font: 'Times New Roman',
              fontSize: 6
            }
          ],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          size: { width: 100, height: 100 }
        }
      ]
    };

    const document = new PDFDocument(layout);
    const renderer = new CanvasRenderer({ pagePadding: 8, scale: 1 });
    renderer.render(canvas, document, 1);

    const operations = contextImpl.operations;
    expect(operations.some((entry) => entry.startsWith('fillText:∑@'))).toBe(false);
    expect(operations.filter((entry) => entry.startsWith('lineTo:')).length).toBeGreaterThanOrEqual(4);
    expect(operations.some((entry) => entry === 'stroke')).toBe(true);
    expect(operations.some((entry) => entry.startsWith('fillText:N@'))).toBe(true);
    expect(operations.some((entry) => entry.startsWith('fillText:r=0@'))).toBe(true);
  });

  it('uses parsed vertical bounds to shrink script-sized text when browser metrics are too tall', () => {
    const contextImpl = new ScriptMetricRecordingContext();
    const canvas = new RecordingCanvas(contextImpl);

    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          textItems: [
            {
              text: 'W',
              bounds: { minX: 40, minY: 40, maxX: 49.5, maxY: 50 },
              font: 'CMMI10',
              fontSize: 10,
              baselineStart: { x: 40, y: 42 },
              baselineEnd: { x: 49.5, y: 42 }
            },
            {
              text: 'i',
              bounds: { minX: 49.8, minY: 42.8, maxX: 52.3, maxY: 49.8 },
              font: 'Times New Roman',
              fontSize: 7,
              baselineStart: { x: 49.8, y: 44.2 },
              baselineEnd: { x: 52.3, y: 44.2 }
            }
          ],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          size: { width: 100, height: 100 }
        }
      ]
    };

    const document = new PDFDocument(layout);
    const renderer = new CanvasRenderer({ pagePadding: 8, scale: 1 });
    renderer.render(canvas, document, 1);

    const mainDraw = contextImpl.textDraws.find((draw) => draw.text === 'W');
    const scriptDraw = contextImpl.textDraws.find((draw) => draw.text === 'i');

    expect(mainDraw).toBeDefined();
    expect(scriptDraw).toBeDefined();
    expect(mainDraw?.scaleY).toBe(1);
    expect(scriptDraw!.scaleY).toBeLessThan(1);
  });

  it('shrinks compact superscript and subscript tokens enough to avoid crowding adjacent formula glyphs', () => {
    const contextImpl = new ScriptMetricRecordingContext();
    const canvas = new RecordingCanvas(contextImpl);

    const layout: PDFLayout = {
      pages: [
        {
          number: 1,
          textItems: [
            {
              text: 'O',
              bounds: { minX: 61.7, minY: 54.8, maxX: 67.8, maxY: 61.8 },
              font: 'CMMI7',
              fontSize: 6.9738,
              baselineStart: { x: 61.7, y: 56.2 },
              baselineEnd: { x: 67.8, y: 56.2 }
            },
            {
              text: 'W',
              bounds: { minX: 52, minY: 50, maxX: 61.4, maxY: 60 },
              font: 'CMMI10',
              fontSize: 10,
              baselineStart: { x: 52, y: 52 },
              baselineEnd: { x: 61.4, y: 52 }
            },
            {
              text: 'head',
              bounds: { minX: 20, minY: 50, maxX: 41, maxY: 60 },
              font: 'Times New Roman',
              fontSize: 10,
              baselineStart: { x: 20, y: 52 },
              baselineEnd: { x: 41, y: 52 }
            },
            {
              text: '1',
              bounds: { minX: 41.1, minY: 49.2, maxX: 44.9, maxY: 56.2 },
              font: 'Times New Roman',
              fontSize: 6.9738,
              baselineStart: { x: 41.1, y: 50.6 },
              baselineEnd: { x: 44.9, y: 50.6 }
            }
          ],
          imageItems: [],
          lineItems: [],
          rectItems: [],
          size: { width: 100, height: 100 }
        }
      ]
    };

    const document = new PDFDocument(layout);
    const renderer = new CanvasRenderer({ pagePadding: 8, scale: 1 });
    renderer.render(canvas, document, 1);

    const headDraw = contextImpl.textDraws.find((draw) => draw.text === 'head');
    const subscriptDraw = contextImpl.textDraws.find((draw) => draw.text === '1');
    const mainDraw = contextImpl.textDraws.find((draw) => draw.text === 'W');
    const superscriptDraw = contextImpl.textDraws.find((draw) => draw.text === 'O');

    expect(headDraw).toBeDefined();
    expect(mainDraw).toBeDefined();
    expect(subscriptDraw).toBeDefined();
    expect(superscriptDraw).toBeDefined();
    expect(headDraw?.scaleY).toBe(1);
    expect(mainDraw?.scaleY).toBe(1);
    expect(subscriptDraw!.scaleY).toBeLessThan(0.95);
    expect(superscriptDraw!.scaleY).toBeLessThan(0.9);
    expect(subscriptDraw!.scaleX).toBeLessThan(headDraw!.scaleX);
    expect(superscriptDraw!.scaleX).toBeLessThan(mainDraw!.scaleX);
    expect(subscriptDraw!.translateY - mainDraw!.translateY).toBeGreaterThan(1.8);
    expect(subscriptDraw!.translateY - mainDraw!.translateY).toBeLessThan(5.5);
    expect(mainDraw!.translateY - superscriptDraw!.translateY).toBeGreaterThan(4.8);
    expect(mainDraw!.translateY - superscriptDraw!.translateY).toBeLessThan(6);
  });
});

function readFontSizeForTest(font: string): number {
  const match = font.match(/(\d+(?:\.\d+)?)px/);
  return match ? Number.parseFloat(match[1]) : 12;
}
