import { describe, expect, it } from 'vitest';
import { refineTextBlockForSelection } from '../testApp/src/utils/textBlockSelection';

describe('textBlockSelection', () => {
  it('keeps full paragraph blocks for ordinary wrapped prose', () => {
    const block = paragraphBlock([
      line('Biology is the scientific study of life.', 72, 640, 420, 660, 16),
      line('It is a natural science with broad scope.', 72, 618, 410, 638, 16),
      line('Researchers study structure, function, and growth.', 72, 596, 452, 616, 16)
    ]);

    const refined = refineTextBlockForSelection(block, { x: 190, y: 628 });

    expect(refined.lines).toHaveLength(3);
    expect(refined.text).toContain('Biology is the scientific study of life.');
    expect(refined.text).toContain('Researchers study structure, function, and growth.');
  });

  it('still narrows headings when a detached outlier line is selected', () => {
    const block = headingBlock([
      line('Attention Is All You Need', 72, 700, 420, 726, 24),
      line('*', 430, 698, 438, 736, 10)
    ]);

    const refined = refineTextBlockForSelection(block, { x: 434, y: 714 });

    expect(refined.lines).toHaveLength(1);
    expect(refined.text).toBe('*');
  });
});

function paragraphBlock(lines: ReturnType<typeof line>[]) {
  return {
    type: 'paragraph' as const,
    text: lines.map((entry) => entry.text).join(' '),
    lines,
    spans: lines.flatMap((entry) => entry.spans),
    bounds: mergeBounds(lines),
    confidence: 0.8
  };
}

function headingBlock(lines: ReturnType<typeof line>[]) {
  return {
    type: 'heading' as const,
    level: 1 as const,
    text: lines.map((entry) => entry.text).join(' '),
    lines,
    spans: lines.flatMap((entry) => entry.spans),
    bounds: mergeBounds(lines),
    confidence: 0.9
  };
}

function line(
  text: string,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  fontSize: number
) {
  return {
    text,
    bounds: { minX, minY, maxX, maxY },
    lineHeight: maxY - minY,
    spans: [
      {
        text,
        fontSize,
        bounds: { minX, minY, maxX, maxY }
      }
    ]
  };
}

function mergeBounds(lines: Array<{ bounds: { minX: number; minY: number; maxX: number; maxY: number } }>) {
  return lines.reduce(
    (merged, entry) => ({
      minX: Math.min(merged.minX, entry.bounds.minX),
      minY: Math.min(merged.minY, entry.bounds.minY),
      maxX: Math.max(merged.maxX, entry.bounds.maxX),
      maxY: Math.max(merged.maxY, entry.bounds.maxY)
    }),
    {
      minX: lines[0]?.bounds.minX ?? 0,
      minY: lines[0]?.bounds.minY ?? 0,
      maxX: lines[0]?.bounds.maxX ?? 0,
      maxY: lines[0]?.bounds.maxY ?? 0
    }
  );
}
