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
});
