import type { PDFTextItem } from '../types.js';
import { isDisplayCmexOperator } from './embeddedFontRenderPolicy.js';

export interface VectorDisplayOperatorPlan {
  kind: 'product' | 'sum';
  left: number;
  right: number;
  top: number;
  bottom: number;
  strokeWidth: number;
}

export function resolveVectorDisplayOperatorPlan(
  item: PDFTextItem,
  projectPoint: (x: number, y: number) => { x: number; y: number },
  scale: number
): VectorDisplayOperatorPlan | undefined {
  if (!isDisplayCmexOperator(item)) {
    return undefined;
  }

  const glyphCode = item.glyphSpans?.[0]?.glyphCode;
  if (glyphCode !== 88 && glyphCode !== 89) {
    return undefined;
  }

  const topLeft = projectPoint(item.bounds.minX, item.bounds.maxY);
  const bottomRight = projectPoint(item.bounds.maxX, item.bounds.minY);
  const left = Math.min(topLeft.x, bottomRight.x);
  const right = Math.max(topLeft.x, bottomRight.x);
  const top = Math.min(topLeft.y, bottomRight.y);
  const bottom = Math.max(topLeft.y, bottomRight.y);

  if (!(right > left) || !(bottom > top)) {
    return undefined;
  }

  return {
    kind: glyphCode === 88 ? 'sum' : 'product',
    left,
    right,
    top,
    bottom,
    strokeWidth: Math.max((item.fontSize ?? 12) * scale * 0.036, 0.34)
  };
}

export function traceVectorDisplayOperator(
  context: CanvasRenderingContext2D,
  plan: VectorDisplayOperatorPlan
): void {
  if (plan.kind === 'sum') {
    traceVectorSum(context, plan);
    return;
  }

  if (plan.kind !== 'product') {
    return;
  }

  const width = Math.max(1, plan.right - plan.left);
  const height = Math.max(1, plan.bottom - plan.top);
  const leftStemX = plan.left + width * 0.33;
  const rightStemX = plan.right - width * 0.33;
  const topY = plan.top + height * 0.4;
  const bottomY = plan.bottom - height * 0.2;
  const overhang = width * 0.04;

  context.moveTo(leftStemX, topY);
  context.lineTo(leftStemX, bottomY);

  context.moveTo(rightStemX, topY);
  context.lineTo(rightStemX, bottomY);

  context.moveTo(leftStemX - overhang, topY);
  context.lineTo(rightStemX + overhang, topY);

  context.moveTo(leftStemX - overhang, bottomY);
  context.lineTo(rightStemX + overhang, bottomY);
}

function traceVectorSum(
  context: CanvasRenderingContext2D,
  plan: VectorDisplayOperatorPlan
): void {
  const width = Math.max(1, plan.right - plan.left);
  const height = Math.max(1, plan.bottom - plan.top);
  const topY = plan.top + height * 0.41;
  const middleY = plan.top + height * 0.61;
  const bottomY = plan.bottom - height * 0.21;
  const leftX = plan.left + width * 0.26;
  const upperMidX = plan.left + width * 0.58;
  const rightX = plan.right - width * 0.1;

  context.moveTo(rightX, topY);
  context.lineTo(leftX, topY);
  context.lineTo(upperMidX, middleY);
  context.lineTo(leftX, bottomY);
  context.lineTo(rightX, bottomY);
}
