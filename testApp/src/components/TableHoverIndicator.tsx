import type { PDFImageBounds } from 'pdf-layout-parser';

type TableHoverIndicatorProps = {
  bounds: PDFImageBounds;
  pageHeight: number;
  scaleX: number;
  scaleY: number;
  zoom: number;
};

export function TableHoverIndicator({
  bounds,
  pageHeight,
  scaleX,
  scaleY,
  zoom
}: TableHoverIndicatorProps): JSX.Element {
  const canvasPadding = 16 * zoom;
  const left = bounds.minX * scaleX + canvasPadding;
  const top = (pageHeight - bounds.maxY) * scaleY + canvasPadding;
  const width = (bounds.maxX - bounds.minX) * scaleX;
  const height = (bounds.maxY - bounds.minY) * scaleY;

  return (
    <div
      className="canvas-table-hover-indicator"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`
      }}
    >
      <div className="canvas-table-hover-indicator__chip">
        <TableHoverIcon />
        <span>Open table</span>
      </div>
    </div>
  );
}

function TableHoverIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
      <rect x="2" y="3" width="14" height="12" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <line x1="2" y1="7" x2="16" y2="7" stroke="currentColor" strokeWidth="1.3" />
      <line x1="2" y1="11" x2="16" y2="11" stroke="currentColor" strokeWidth="1.3" />
      <line x1="7" y1="3" x2="7" y2="15" stroke="currentColor" strokeWidth="1.3" />
      <line x1="11" y1="3" x2="11" y2="15" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
