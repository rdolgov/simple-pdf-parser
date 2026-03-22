import type { CanvasLike } from '../../src/viewer/canvasRenderer.js';

type TransformState = {
  translateX: number;
  translateY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
};

export type RecordedTextDraw = {
  text: string;
  x: number;
  y: number;
  font: string;
  rotation: number;
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
};

export type RecordedPathPaint = {
  kind: 'fill' | 'stroke';
  fillRule?: CanvasFillRule;
  rotation: number;
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
};

export type RecordedClip = {
  fillRule?: CanvasFillRule;
  rotation: number;
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
};

const DEFAULT_STATE: TransformState = {
  translateX: 0,
  translateY: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1
};

export class RecordingContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  strokeStyle: string | CanvasGradient | CanvasPattern = '';
  lineWidth = 1;
  lineCap: CanvasLineCap = 'butt';
  lineJoin: CanvasLineJoin = 'miter';
  miterLimit = 10;
  font = '';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  imageSmoothingEnabled = true;
  textRendering?: string;
  readonly textDraws: RecordedTextDraw[] = [];
  readonly pathPaints: RecordedPathPaint[] = [];
  readonly clipOperations: RecordedClip[] = [];
  readonly operations: string[] = [];

  private state: TransformState = { ...DEFAULT_STATE };
  private readonly stack: TransformState[] = [];

  setTransform(): void {
    this.state = { ...DEFAULT_STATE };
  }

  clearRect(): void {}

  save(): void {
    this.stack.push({ ...this.state });
  }

  restore(): void {
    this.state = this.stack.pop() ?? { ...DEFAULT_STATE };
  }

  scale(x: number, y: number): void {
    this.state.scaleX *= x;
    this.state.scaleY *= y;
  }

  translate(x: number, y: number): void {
    this.state.translateX += x;
    this.state.translateY += y;
  }

  rotate(angle: number): void {
    this.state.rotation += angle;
  }

  fillRect(): void {
    this.operations.push('fillRect');
  }

  strokeRect(): void {
    this.operations.push('strokeRect');
  }

  beginPath(): void {
    this.operations.push('beginPath');
  }

  moveTo(x: number, y: number): void {
    this.operations.push(`moveTo:${x},${y}`);
  }

  lineTo(x: number, y: number): void {
    this.operations.push(`lineTo:${x},${y}`);
  }

  closePath(): void {
    this.operations.push('closePath');
  }

  stroke(): void {
    this.operations.push('stroke');
    this.pathPaints.push({
      kind: 'stroke',
      rotation: this.state.rotation,
      scaleX: this.state.scaleX,
      scaleY: this.state.scaleY,
      translateX: this.state.translateX,
      translateY: this.state.translateY
    });
  }

  fill(fillRule?: CanvasFillRule): void {
    this.operations.push(`fill:${fillRule ?? 'nonzero'}`);
    this.pathPaints.push({
      kind: 'fill',
      fillRule,
      rotation: this.state.rotation,
      scaleX: this.state.scaleX,
      scaleY: this.state.scaleY,
      translateX: this.state.translateX,
      translateY: this.state.translateY
    });
  }

  clip(fillRule?: CanvasFillRule): void {
    this.operations.push(`clip:${fillRule ?? 'nonzero'}`);
    this.clipOperations.push({
      fillRule,
      rotation: this.state.rotation,
      scaleX: this.state.scaleX,
      scaleY: this.state.scaleY,
      translateX: this.state.translateX,
      translateY: this.state.translateY
    });
  }

  drawImage(): void {
    this.operations.push('drawImage');
  }

  rect(x: number, y: number, width: number, height: number): void {
    this.operations.push(`rect:${x},${y},${width},${height}`);
  }

  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
    this.operations.push(`bezierCurveTo:${x1},${y1},${x2},${y2},${x3},${y3}`);
  }

  measureText(text: string): TextMetrics {
    const fontSize = readFontSize(this.font);
    const width = Math.max(text.length * fontSize * 0.52, 1);
    const isMathSymbol = /[√∑∈∞∗]/.test(text);
    const actualBoundingBoxAscent = fontSize * (isMathSymbol ? 0.92 : 0.8);
    const actualBoundingBoxDescent = fontSize * (isMathSymbol ? 0.08 : 0.2);
    return {
      width,
      actualBoundingBoxAscent,
      actualBoundingBoxDescent,
      fontBoundingBoxAscent: actualBoundingBoxAscent,
      fontBoundingBoxDescent: actualBoundingBoxDescent
    } as TextMetrics;
  }

  fillText(text: string, x: number, y: number): void {
    this.textDraws.push({
      text,
      x,
      y,
      font: this.font,
      rotation: this.state.rotation,
      scaleX: this.state.scaleX,
      scaleY: this.state.scaleY,
      translateX: this.state.translateX,
      translateY: this.state.translateY
    });
  }
}

export class RecordingCanvas implements CanvasLike {
  width = 0;
  height = 0;

  constructor(private readonly context: RecordingContext) {}

  getContext(type: '2d'): CanvasRenderingContext2D | null {
    return type === '2d' ? (this.context as unknown as CanvasRenderingContext2D) : null;
  }
}

function readFontSize(font: string): number {
  const match = font.match(/(\d+(?:\.\d+)?)px/);
  return match ? Number.parseFloat(match[1]) : 12;
}
