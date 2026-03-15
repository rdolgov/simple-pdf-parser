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
  font = '';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  imageSmoothingEnabled = true;
  textRendering?: string;
  readonly textDraws: RecordedTextDraw[] = [];
  readonly pathPaints: RecordedPathPaint[] = [];

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

  fillRect(): void {}

  strokeRect(): void {}

  beginPath(): void {}

  moveTo(): void {}

  lineTo(): void {}

  closePath(): void {}

  stroke(): void {
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

  drawImage(): void {}

  rect(): void {}

  bezierCurveTo(): void {}

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
