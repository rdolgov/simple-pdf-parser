export type FormulaFragmentMatch = {
  kind: 'formula';
  content: string;
  source: 'heuristic';
  start: number;
  end: number;
  confidence: number;
};

type FormulaPatternDefinition = {
  id: 'equation' | 'function' | 'complexity' | 'symbolic' | 'group';
  pattern: RegExp;
};

const FORMULA_PATTERNS: FormulaPatternDefinition[] = [
  {
    id: 'equation',
    pattern:
      /\b(?:[A-Za-z][A-Za-z0-9_]*|[A-Z][A-Za-z0-9_]*)\s*(?:\([^)\n]{0,80}\))?\s*(?:=|≈|≤|≥|≠|∈|→|←)\s*[^.;:\n]{1,140}/g
  },
  {
    id: 'function',
    pattern: /\b(?:softmax|max|min|log|exp|sin|cos|tan|concat|attention|ffn)\s*\([^)\n]{1,80}\)/gi
  },
  {
    id: 'complexity',
    pattern: /\bO\s*\([^)\n]{1,40}\)/g
  },
  {
    id: 'symbolic',
    pattern: /[∑∏∫√][^.;,\n]{1,64}/g
  },
  {
    id: 'group',
    pattern: /\([^)\n]*[=+\-*/^≤≥≈≠∈][^)\n]*\)/g
  }
];

const MATH_CHAR_PATTERN = /[=+\-*/^()[\]{}∑∏∫√∞≈≠≤≥∈∉→←αβγδεζηθικλμνξπρστυφχψω₀₁₂₃₄₅₆₇₈₉⁰¹²³⁴⁵⁶⁷⁸⁹]/;
const STRONG_SIGNAL_PATTERN = /(?:=|≈|≤|≥|≠|∈|∑|∏|∫|√|\bO\s*\(|\b(?:softmax|attention|concat|ffn)\s*\()/i;
const TRIM_EDGE_PATTERN = /^[\s:;,]+|[\s:;,.]+$/g;
const INLINE_PROSE_CUE_PATTERN =
  /\s+(?:before|after|during|while|where|with|without|inside|outside|under|over|through|across|for|from|into|than|then|that|which)\b/i;
const TRAILING_LOWERCASE_WORDS_PATTERN = /\s+[a-z]{3,}(?:\s+[a-z]{3,})+$/;

export function findFormulaFragmentMatches(
  text: string,
  occupiedRanges: Array<{ start: number; end: number }> = []
): FormulaFragmentMatch[] {
  if (!text) {
    return [];
  }

  const candidates: FormulaFragmentMatch[] = [];

  for (const definition of FORMULA_PATTERNS) {
    const pattern = definition.pattern;
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const normalized = normalizeCandidate(text, match.index, match.index + match[0].length, definition.id);
      if (!normalized) {
        continue;
      }

      const confidence = scoreFormulaText(normalized.content);
      if (!hasStrongMathSignal(normalized.content) && confidence < 0.3) {
        continue;
      }

      if (overlapsAnyRange(normalized.start, normalized.end, occupiedRanges)) {
        continue;
      }

      candidates.push({
        kind: 'formula',
        content: normalized.content,
        source: 'heuristic',
        start: normalized.start,
        end: normalized.end,
        confidence
      });
    }
  }

  return mergeOverlappingMatches(candidates);
}

function normalizeCandidate(
  text: string,
  rawStart: number,
  rawEnd: number,
  patternId: FormulaPatternDefinition['id']
): { start: number; end: number; content: string } | null {
  let start = rawStart;

  while (start < rawEnd && /[\s:;,]/.test(text[start] ?? '')) {
    start += 1;
  }

  const end = findBestCandidateEnd(text, start, rawEnd, patternId);
  const content = text.slice(start, end).replace(TRIM_EDGE_PATTERN, '').trim();
  if (content.length < 3) {
    return null;
  }

  return {
    start,
    end,
    content
  };
}

function findBestCandidateEnd(
  text: string,
  start: number,
  rawEnd: number,
  patternId: FormulaPatternDefinition['id']
): number {
  let bestEnd = rawEnd;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidateEnd of collectCandidateEnds(text, start, rawEnd, patternId)) {
    const candidate = text.slice(start, candidateEnd).replace(TRIM_EDGE_PATTERN, '').trim();
    if (candidate.length < 3) {
      continue;
    }

    const score = scoreCandidateWindow(candidate, patternId);
    if (score > bestScore || (score === bestScore && candidateEnd > bestEnd)) {
      bestScore = score;
      bestEnd = candidateEnd;
    }
  }

  return bestEnd;
}

function collectCandidateEnds(
  text: string,
  start: number,
  rawEnd: number,
  patternId: FormulaPatternDefinition['id']
): number[] {
  const candidates = new Set<number>([rawEnd]);

  for (let index = start + 1; index < rawEnd; index += 1) {
    const current = text[index] ?? '';
    const previous = text[index - 1] ?? '';
    const next = text[index + 1] ?? '';
    const suffix = text.slice(index, rawEnd);

    if (/\s/.test(current) && /\S/.test(previous)) {
      candidates.add(index);
    }
    if (/[),\]}]/.test(current) && (!next || /\s|[.,;:]/.test(next))) {
      candidates.add(index + 1);
    }
    if (
      patternId === 'equation' &&
      /\s/.test(current) &&
      (TRAILING_LOWERCASE_WORDS_PATTERN.test(suffix) || INLINE_PROSE_CUE_PATTERN.test(suffix))
    ) {
      candidates.add(index);
    }
  }

  return [...candidates]
    .filter((candidateEnd) => candidateEnd > start)
    .sort((left, right) => left - right);
}

function hasStrongMathSignal(text: string): boolean {
  return STRONG_SIGNAL_PATTERN.test(text);
}

function scoreFormulaText(text: string): number {
  if (!text) {
    return 0;
  }

  let mathCharCount = 0;
  for (const char of text) {
    if (MATH_CHAR_PATTERN.test(char)) {
      mathCharCount += 1;
    }
  }

  let patternScore = 0;
  if (/[A-Za-z]\s*=/.test(text)) patternScore += 0.25;
  if (/\b(?:softmax|attention|concat|ffn|max|min|log|exp)\s*\(/i.test(text)) patternScore += 0.25;
  if (/\bO\s*\(/.test(text)) patternScore += 0.25;
  if (/[∑∏∫√∞≈≠≤≥∈]/.test(text)) patternScore += 0.3;
  if (/\d+\s*[+\-*/^]\s*\d+/.test(text)) patternScore += 0.2;

  return Math.min(1, mathCharCount / Math.max(text.length, 1) + patternScore);
}

function scoreCandidateWindow(text: string, patternId: FormulaPatternDefinition['id']): number {
  let score = scoreFormulaText(text);

  if (patternId === 'equation' && /(?:=|≈|≤|≥|≠|∈|→|←)/.test(text)) {
    score += 0.3;
  }
  if (/\b[A-Za-z][A-Za-z0-9_]*\s*\([^)\n]{0,80}\)\s*(?:=|≈|≤|≥|≠|∈|→|←)/.test(text)) {
    score += 0.15;
  }
  if (endsWithFormulaToken(text)) {
    score += 0.08;
  }
  if (TRAILING_LOWERCASE_WORDS_PATTERN.test(text)) {
    score -= 0.4;
  }
  if (INLINE_PROSE_CUE_PATTERN.test(text)) {
    score -= 0.3;
  }

  return score + Math.min(text.length, 48) / 240;
}

function endsWithFormulaToken(text: string): boolean {
  return /(?:[)\]}]|[A-Za-z]\d*|\d)\s*$/.test(text);
}

function overlapsAnyRange(start: number, end: number, ranges: Array<{ start: number; end: number }>): boolean {
  return ranges.some((range) => Math.max(start, range.start) < Math.min(end, range.end));
}

function mergeOverlappingMatches(matches: FormulaFragmentMatch[]): FormulaFragmentMatch[] {
  const sorted = [...matches].sort((left, right) => left.start - right.start || right.confidence - left.confidence);
  const merged: FormulaFragmentMatch[] = [];

  for (const match of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || previous.end <= match.start) {
      merged.push(match);
      continue;
    }

    if (rankMatch(match) > rankMatch(previous)) {
      merged[merged.length - 1] = match;
    }
  }

  return merged;
}

function rankMatch(match: FormulaFragmentMatch): number {
  let score = match.confidence;
  if (/(?:=|≈|≤|≥|≠|∈|→|←)/.test(match.content)) {
    score += 0.25;
  }
  if (/\b[A-Za-z][A-Za-z0-9_]*\s*\([^)\n]{0,80}\)\s*(?:=|≈|≤|≥|≠|∈|→|←)/.test(match.content)) {
    score += 0.15;
  }
  score += Math.min(match.end - match.start, 80) / 400;
  return score;
}
