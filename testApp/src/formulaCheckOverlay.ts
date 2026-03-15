import type { PDFTextItem } from 'pdf-layout-parser';

type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DrawOverlayOptions = {
  context: CanvasRenderingContext2D;
  crop: CropRect;
  cropPadding: number;
  items: PDFTextItem[];
  scale: number;
};

export function findTextItemsInCrop(items: PDFTextItem[], crop: CropRect): PDFTextItem[] {
  return items.filter((item) => {
    const intersectsX = item.bounds.maxX >= crop.x && item.bounds.minX <= crop.x + crop.width;
    const intersectsY = item.bounds.maxY >= crop.y && item.bounds.minY <= crop.y + crop.height;
    return intersectsX && intersectsY;
  });
}

export function drawFormulaCheckOverlay(options: DrawOverlayOptions): void {
  const { context, crop, cropPadding, items, scale } = options;

  context.save();
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(220, 38, 38, 0.9)';
  context.fillStyle = 'rgba(220, 38, 38, 0.12)';

  for (const item of items) {
    const left = (item.bounds.minX - crop.x) * scale + cropPadding;
    const top = (crop.y + crop.height - item.bounds.maxY) * scale + cropPadding;
    const width = Math.max(1, (item.bounds.maxX - item.bounds.minX) * scale);
    const height = Math.max(1, (item.bounds.maxY - item.bounds.minY) * scale);

    context.fillRect(left, top, width, height);
    context.strokeRect(left, top, width, height);

    if (!item.baselineStart || !item.baselineEnd) {
      continue;
    }

    context.beginPath();
    context.strokeStyle = 'rgba(37, 99, 235, 0.95)';
    context.moveTo(
      (item.baselineStart.x - crop.x) * scale + cropPadding,
      (crop.y + crop.height - item.baselineStart.y) * scale + cropPadding
    );
    context.lineTo(
      (item.baselineEnd.x - crop.x) * scale + cropPadding,
      (crop.y + crop.height - item.baselineEnd.y) * scale + cropPadding
    );
    context.stroke();
    context.strokeStyle = 'rgba(220, 38, 38, 0.9)';
  }

  context.restore();
}
