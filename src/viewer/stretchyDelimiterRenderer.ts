import type { PDFTextItem } from '../types.js';

export interface VectorStretchyDelimiterPlan {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  strokeWidth: number;
}

export function resolveVectorStretchyDelimiterPlan(
  item: PDFTextItem,
  projectPoint: (x: number, y: number) => { x: number; y: number },
  scale: number
): VectorStretchyDelimiterPlan | undefined {
  if (!/cmex/i.test(item.font ?? '') || !/^[()[\]|]$/.test(item.text.trim())) {
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
    text: item.text.trim(),
    left,
    right,
    top,
    bottom,
    strokeWidth: Math.max((item.fontSize ?? 12) * scale * 0.04, 0.45)
  };
}

export function traceVectorStretchyDelimiter(
  context: CanvasRenderingContext2D,
  plan: VectorStretchyDelimiterPlan
): void {
  const width = Math.max(1, plan.right - plan.left);
  const height = Math.max(1, plan.bottom - plan.top);
  const middleY = (plan.top + plan.bottom) / 2;
  const insetX = width * 0.18;
  const outerLeft = plan.left + insetX;
  const outerRight = plan.right - insetX;
  const shoulderY = plan.top + height * 0.12;
  const lowerShoulderY = plan.bottom - height * 0.12;

  switch (plan.text) {
    case '(':
      context.moveTo(outerRight, plan.top);
      context.bezierCurveTo(
        outerLeft,
        shoulderY,
        plan.left,
        middleY - height * 0.18,
        plan.left + width * 0.1,
        middleY
      );
      context.bezierCurveTo(
        plan.left,
        middleY + height * 0.18,
        outerLeft,
        lowerShoulderY,
        outerRight,
        plan.bottom
      );
      return;
    case ')':
      context.moveTo(outerLeft, plan.top);
      context.bezierCurveTo(
        outerRight,
        shoulderY,
        plan.right,
        middleY - height * 0.18,
        plan.right - width * 0.1,
        middleY
      );
      context.bezierCurveTo(
        plan.right,
        middleY + height * 0.18,
        outerRight,
        lowerShoulderY,
        outerLeft,
        plan.bottom
      );
      return;
    case '[': {
      const stemX = plan.left + width * 0.25;
      context.moveTo(plan.right, plan.top);
      context.lineTo(stemX, plan.top);
      context.lineTo(stemX, plan.bottom);
      context.lineTo(plan.right, plan.bottom);
      return;
    }
    case ']': {
      const stemX = plan.right - width * 0.25;
      context.moveTo(plan.left, plan.top);
      context.lineTo(stemX, plan.top);
      context.lineTo(stemX, plan.bottom);
      context.lineTo(plan.left, plan.bottom);
      return;
    }
    case '|': {
      const stemX = (plan.left + plan.right) / 2;
      context.moveTo(stemX, plan.top);
      context.lineTo(stemX, plan.bottom);
      return;
    }
    default:
      return;
  }
}
