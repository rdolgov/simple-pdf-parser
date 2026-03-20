import type { PDFImageBounds, PDFTextItem } from './types.js';

export interface TextItemSubstringMatch {
  start: number;
  end: number;
  text: string;
  bounds: PDFImageBounds;
}

interface TextItemCharacterMetrics {
  text: string[];
  startAdvances: number[];
  endAdvances: number[];
  totalAdvance: number;
}

export function computeTextItemSubstringBounds(
  item: PDFTextItem,
  start: number,
  end: number
): PDFImageBounds | undefined {
  if (!(start >= 0) || !(end > start)) {
    return undefined;
  }

  const characterMetrics = buildTextItemCharacterMetrics(item);
  if (!characterMetrics) {
    return undefined;
  }

  const clampedStart = Math.min(start, characterMetrics.text.length);
  const clampedEnd = Math.min(end, characterMetrics.text.length);
  if (!(clampedEnd > clampedStart)) {
    return undefined;
  }

  const startAdvance = characterMetrics.startAdvances[clampedStart] ?? 0;
  const endAdvance = characterMetrics.endAdvances[clampedEnd - 1] ?? startAdvance;
  return boundsFromAdvanceRange(item, startAdvance, endAdvance, characterMetrics.totalAdvance);
}

export function findTextItemSubstringMatches(
  item: PDFTextItem,
  query: string,
  options: { caseSensitive?: boolean } = {}
): TextItemSubstringMatch[] {
  const needle = Array.from(query);
  if (needle.length === 0) {
    return [];
  }

  const haystack = Array.from(item.text);
  const caseSensitive = options.caseSensitive ?? false;
  const normalizedHaystack = caseSensitive ? haystack : haystack.map((char) => char.toLocaleLowerCase());
  const normalizedNeedle = caseSensitive ? needle : needle.map((char) => char.toLocaleLowerCase());
  const matches: TextItemSubstringMatch[] = [];

  for (let startIndex = 0; startIndex <= normalizedHaystack.length - normalizedNeedle.length; startIndex += 1) {
    let didMatch = true;
    for (let offset = 0; offset < normalizedNeedle.length; offset += 1) {
      if (normalizedHaystack[startIndex + offset] !== normalizedNeedle[offset]) {
        didMatch = false;
        break;
      }
    }
    if (!didMatch) {
      continue;
    }

    const endIndex = startIndex + normalizedNeedle.length;
    const bounds = computeTextItemSubstringBounds(item, startIndex, endIndex);
    if (!bounds) {
      continue;
    }

    matches.push({
      start: startIndex,
      end: endIndex,
      text: haystack.slice(startIndex, endIndex).join(''),
      bounds
    });
  }

  return matches;
}

function buildTextItemCharacterMetrics(item: PDFTextItem): TextItemCharacterMetrics | undefined {
  const itemCharacters = Array.from(item.text);
  if (itemCharacters.length === 0) {
    return undefined;
  }

  const glyphText = item.glyphSpans?.map((span) => span.text).join('');
  if (glyphText && glyphText === item.text) {
    return buildMetricsFromGlyphSpans(item);
  }

  return buildUniformMetrics(itemCharacters, projectedTextWidth(item));
}

function buildMetricsFromGlyphSpans(item: PDFTextItem): TextItemCharacterMetrics | undefined {
  const glyphSpans = item.glyphSpans;
  if (!glyphSpans || glyphSpans.length === 0) {
    return undefined;
  }

  const characters: string[] = [];
  const startAdvances: number[] = [];
  const endAdvances: number[] = [];
  let consumedAdvance = 0;

  for (const span of glyphSpans) {
    const spanCharacters = Array.from(span.text);
    if (spanCharacters.length === 0) {
      consumedAdvance += Math.max(span.advance, 0);
      continue;
    }

    const perCharacterAdvance = Math.max(span.advance, 0) / spanCharacters.length;
    for (const character of spanCharacters) {
      characters.push(character);
      startAdvances.push(consumedAdvance);
      consumedAdvance += perCharacterAdvance;
      endAdvances.push(consumedAdvance);
    }
  }

  if (characters.length === 0) {
    return undefined;
  }

  return {
    text: characters,
    startAdvances,
    endAdvances,
    totalAdvance: consumedAdvance
  };
}

function buildUniformMetrics(characters: string[], totalAdvance: number): TextItemCharacterMetrics | undefined {
  if (characters.length === 0) {
    return undefined;
  }

  const safeAdvance = totalAdvance > 0 ? totalAdvance : 1;
  const perCharacterAdvance = safeAdvance / characters.length;
  const startAdvances: number[] = [];
  const endAdvances: number[] = [];
  let consumedAdvance = 0;

  for (let index = 0; index < characters.length; index += 1) {
    startAdvances.push(consumedAdvance);
    consumedAdvance += perCharacterAdvance;
    endAdvances.push(consumedAdvance);
  }

  return {
    text: characters,
    startAdvances,
    endAdvances,
    totalAdvance: safeAdvance
  };
}

function boundsFromAdvanceRange(
  item: PDFTextItem,
  startAdvance: number,
  endAdvance: number,
  totalAdvance: number
): PDFImageBounds {
  const baselineStart = item.baselineStart;
  const baselineEnd = item.baselineEnd;
  const projectedWidth = projectedTextWidth(item);
  const startRatio = totalAdvance > 0 ? startAdvance / totalAdvance : 0;
  const endRatio = totalAdvance > 0 ? endAdvance / totalAdvance : 1;

  if (
    baselineStart &&
    baselineEnd &&
    projectedWidth > 0 &&
    Number.isFinite(startRatio) &&
    Number.isFinite(endRatio)
  ) {
    const dx = baselineEnd.x - baselineStart.x;
    const dy = baselineEnd.y - baselineStart.y;
    const baselineLength = Math.hypot(dx, dy);
    if (baselineLength > 0) {
      const unitX = dx / baselineLength;
      const unitY = dy / baselineLength;
      const normalX = -unitY;
      const normalY = unitX;
      const itemCorners = [
        { x: item.bounds.minX, y: item.bounds.minY },
        { x: item.bounds.minX, y: item.bounds.maxY },
        { x: item.bounds.maxX, y: item.bounds.minY },
        { x: item.bounds.maxX, y: item.bounds.maxY }
      ];
      let minNormal = Infinity;
      let maxNormal = -Infinity;
      for (const corner of itemCorners) {
        const offsetX = corner.x - baselineStart.x;
        const offsetY = corner.y - baselineStart.y;
        const projection = offsetX * normalX + offsetY * normalY;
        minNormal = Math.min(minNormal, projection);
        maxNormal = Math.max(maxNormal, projection);
      }

      const startPoint = {
        x: baselineStart.x + dx * startRatio,
        y: baselineStart.y + dy * startRatio
      };
      const endPoint = {
        x: baselineStart.x + dx * endRatio,
        y: baselineStart.y + dy * endRatio
      };
      const corners = [
        { x: startPoint.x + normalX * minNormal, y: startPoint.y + normalY * minNormal },
        { x: startPoint.x + normalX * maxNormal, y: startPoint.y + normalY * maxNormal },
        { x: endPoint.x + normalX * minNormal, y: endPoint.y + normalY * minNormal },
        { x: endPoint.x + normalX * maxNormal, y: endPoint.y + normalY * maxNormal }
      ];
      const xs = corners.map((corner) => corner.x);
      const ys = corners.map((corner) => corner.y);
      return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys)
      };
    }
  }

  const width = item.bounds.maxX - item.bounds.minX;
  return {
    minX: item.bounds.minX + width * startRatio,
    maxX: item.bounds.minX + width * endRatio,
    minY: item.bounds.minY,
    maxY: item.bounds.maxY
  };
}

function projectedTextWidth(item: PDFTextItem): number {
  const baselineStart = item.baselineStart;
  const baselineEnd = item.baselineEnd;
  if (baselineStart && baselineEnd) {
    const width = Math.hypot(baselineEnd.x - baselineStart.x, baselineEnd.y - baselineStart.y);
    if (width > 0) {
      return width;
    }
  }
  return Math.max(0, item.bounds.maxX - item.bounds.minX);
}
