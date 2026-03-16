import { describe, expect, it } from 'vitest';

import { CanvasRenderer } from '../src/viewer/canvasRenderer.js';
import type { CanvasLike } from '../src/viewer/canvasRenderer.js';
import type { PDFLayout } from '../src/types.js';
import { PDFDocument } from '../src/pdfDocument.js';

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
});
