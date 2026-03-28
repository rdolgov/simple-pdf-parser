import type { CSSProperties, MouseEvent } from 'react';

import type { AnnotationBounds } from '../storage/annotationStorage';
import { findFormulaFragmentMatches, type FormulaFragmentMatch } from '../utils/formulaFragmentDetector';
import { buildHighlightLineSpanSlices, type HighlightLineData } from '../utils/highlightUtils';
import { buildInterestingTextLayout, type InterestingTextMatch } from '../utils/interestingTextSegments';

const HIGHLIGHT_PADDING = 12;

interface InterestingTextOverlayProps {
  blockBounds: AnnotationBounds;
  lines: HighlightLineData[];
  paragraphText: string;
  scaleX: number;
  scaleY: number;
  hasReferenceExtraction: boolean;
  enableFormulaPrototype: boolean;
  onCitationClick: (
    citationNumber: string,
    event: MouseEvent<HTMLElement>,
    paragraphText: string,
    bounds: AnnotationBounds
  ) => void;
  onFormulaClick: (formulaText: string, event: MouseEvent<HTMLElement>) => void;
}

type OverlayMatch = InterestingTextMatch | FormulaFragmentMatch;

type Hotspot = {
  key: string;
  match: OverlayMatch;
  style: CSSProperties;
};

export function InterestingTextOverlay({
  blockBounds,
  lines,
  paragraphText,
  scaleX,
  scaleY,
  hasReferenceExtraction,
  enableFormulaPrototype,
  onCitationClick,
  onFormulaClick
}: InterestingTextOverlayProps): JSX.Element | null {
  const layout = buildInterestingTextLayout(lines.map((line) => ({ text: line.text })));
  const formulaMatches = enableFormulaPrototype
    ? findFormulaFragmentMatches(
        layout.text,
        layout.matches.map((match) => ({ start: match.start, end: match.end }))
      )
    : [];
  const overlayMatches = [...layout.matches, ...formulaMatches].sort((left, right) => left.start - right.start);
  const hotspots = buildHotspots(overlayMatches, layout.lineSlices, lines, blockBounds, scaleX, scaleY);
  if (hotspots.length === 0) {
    return null;
  }

  const resolvedParagraphText = paragraphText.trim().length > 0 ? paragraphText : layout.text.trim();

  const stopPropagation = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  return (
    <div className="interesting-text-overlay">
      {hotspots.map((hotspot) => {
        if (hotspot.match.kind === 'url') {
          return (
            <a
              key={hotspot.key}
              className="interesting-text-hotspot interesting-text-hotspot--link"
              href={hotspot.match.href}
              target="_blank"
              rel="noreferrer"
              style={hotspot.style}
              aria-label={`Open link ${hotspot.match.content}`}
              title={hotspot.match.href}
              onClick={stopPropagation}
              onMouseDown={stopPropagation}
            />
          );
        }

        if (hotspot.match.kind === 'formula') {
          return (
            <button
              key={hotspot.key}
              type="button"
              className="interesting-text-hotspot interesting-text-hotspot--formula"
              style={hotspot.style}
              aria-label={`Inspect formula fragment ${hotspot.match.content}`}
              title={`Inspect math fragment: ${hotspot.match.content}`}
              onClick={(event) => {
                event.stopPropagation();
                onFormulaClick(hotspot.match.content, event);
              }}
              onMouseDown={stopPropagation}
            />
          );
        }

        const firstNumber = hotspot.match.numbers[0] ?? '';
        return (
          <button
            key={hotspot.key}
            type="button"
            className="interesting-text-hotspot interesting-text-hotspot--citation"
            style={hotspot.style}
            aria-label={`Open citation ${hotspot.match.content}`}
            title={
              hasReferenceExtraction
                ? `View reference ${hotspot.match.content}`
                : `View citation ${hotspot.match.content} (run extraction for reference details)`
            }
            onClick={(event) => {
              event.stopPropagation();
              onCitationClick(firstNumber, event, resolvedParagraphText, blockBounds);
            }}
            onMouseDown={stopPropagation}
          />
        );
      })}
    </div>
  );
}

function buildHotspots(
  matches: OverlayMatch[],
  lineSlices: Array<{ start: number; end: number }>,
  lines: HighlightLineData[],
  blockBounds: AnnotationBounds,
  scaleX: number,
  scaleY: number
): Hotspot[] {
  const hotspots: Hotspot[] = [];

  for (const match of matches) {
    for (let lineIndex = 0; lineIndex < lineSlices.length; lineIndex += 1) {
      const lineSlice = lineSlices[lineIndex];
      const line = lines[lineIndex];
      const bounds = line?.bounds;

      if (!bounds) {
        continue;
      }

      const fragmentStart = Math.max(match.start, lineSlice.start);
      const fragmentEnd = Math.min(match.end, lineSlice.end);
      if (fragmentEnd <= fragmentStart) {
        continue;
      }

      const lineLocalStart = fragmentStart - lineSlice.start;
      const lineLocalEnd = fragmentEnd - lineSlice.start;
      const spanHotspots = buildSpanHotspots({
        match,
        line,
        lineIndex,
        lineLocalStart,
        lineLocalEnd,
        blockBounds,
        scaleX,
        scaleY
      });

      if (spanHotspots.length > 0) {
        hotspots.push(...spanHotspots);
        continue;
      }

      hotspots.push(
        buildApproximateLineHotspot({
          match,
          lineSlice,
          lineIndex,
          bounds,
          blockBounds,
          scaleX,
          scaleY,
          fragmentStart,
          fragmentEnd
        })
      );
    }
  }

  return hotspots;
}

function buildSpanHotspots(payload: {
  match: OverlayMatch;
  line: HighlightLineData;
  lineIndex: number;
  lineLocalStart: number;
  lineLocalEnd: number;
  blockBounds: AnnotationBounds;
  scaleX: number;
  scaleY: number;
}): Hotspot[] {
  const { match, line, lineIndex, lineLocalStart, lineLocalEnd, blockBounds, scaleX, scaleY } = payload;
  const spanSlices = buildHighlightLineSpanSlices(line);
  if (spanSlices.length === 0) {
    return [];
  }

  const hotspots: Hotspot[] = [];

  for (let spanIndex = 0; spanIndex < spanSlices.length; spanIndex += 1) {
    const spanSlice = spanSlices[spanIndex];
    const overlapStart = Math.max(lineLocalStart, spanSlice.start);
    const overlapEnd = Math.min(lineLocalEnd, spanSlice.end);
    if (overlapEnd <= overlapStart) {
      continue;
    }

    const spanLength = Math.max(spanSlice.end - spanSlice.start, 1);
    const spanWidth = Math.max(spanSlice.bounds.maxX - spanSlice.bounds.minX, 1);
    const startRatio = (overlapStart - spanSlice.start) / spanLength;
    const endRatio = (overlapEnd - spanSlice.start) / spanLength;

    const hotspotLeft =
      HIGHLIGHT_PADDING + (spanSlice.bounds.minX - blockBounds.minX + spanWidth * startRatio) * scaleX;
    const hotspotTop = HIGHLIGHT_PADDING + (blockBounds.maxY - spanSlice.bounds.maxY) * scaleY;
    const hotspotWidth = Math.max((spanWidth * (endRatio - startRatio)) * scaleX, 6);
    const hotspotHeight = Math.max((spanSlice.bounds.maxY - spanSlice.bounds.minY) * scaleY, 12);

    hotspots.push({
      key: `${match.kind}-${match.start}-${match.end}-${lineIndex}-${spanIndex}`,
      match,
      style: {
        left: `${hotspotLeft}px`,
        top: `${hotspotTop}px`,
        width: `${hotspotWidth}px`,
        height: `${hotspotHeight}px`
      }
    });
  }

  return hotspots;
}

function buildApproximateLineHotspot(payload: {
  match: OverlayMatch;
  lineSlice: { start: number; end: number };
  lineIndex: number;
  bounds: AnnotationBounds;
  blockBounds: AnnotationBounds;
  scaleX: number;
  scaleY: number;
  fragmentStart: number;
  fragmentEnd: number;
}): Hotspot {
  const { match, lineSlice, lineIndex, bounds, blockBounds, scaleX, scaleY, fragmentStart, fragmentEnd } = payload;
  const lineLength = Math.max(lineSlice.end - lineSlice.start, 1);
  const lineWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const startRatio = (fragmentStart - lineSlice.start) / lineLength;
  const endRatio = (fragmentEnd - lineSlice.start) / lineLength;

  const hotspotLeft = HIGHLIGHT_PADDING + (bounds.minX - blockBounds.minX + lineWidth * startRatio) * scaleX;
  const hotspotTop = HIGHLIGHT_PADDING + (blockBounds.maxY - bounds.maxY) * scaleY;
  const hotspotWidth = Math.max((lineWidth * (endRatio - startRatio)) * scaleX, 12);
  const hotspotHeight = Math.max((bounds.maxY - bounds.minY) * scaleY, 12);

  return {
    key: `${match.kind}-${match.start}-${match.end}-${lineIndex}`,
    match,
    style: {
      left: `${hotspotLeft}px`,
      top: `${hotspotTop}px`,
      width: `${hotspotWidth}px`,
      height: `${hotspotHeight}px`
    }
  };
}
