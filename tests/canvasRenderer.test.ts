import { describe, expect, it } from 'vitest';

import { CanvasRenderer } from '../src/viewer/canvasRenderer.js';
import type { CanvasLike } from '../src/viewer/canvasRenderer.js';
import type { PDFLayout } from '../src/types.js';
import { PDFDocument } from '../src/pdfDocument.js';

class MockContext {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
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
});
