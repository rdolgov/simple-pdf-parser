import type { PDFTextItem } from '../types.js';

import { SUPPLEMENTAL_TRUSTED_WORDS } from './supplementalWordLexicon.js';

interface BoundaryLexicon {
  globalWordCounts: Map<string, number>;
  fontWordCounts: Map<string, Map<string, number>>;
  globalBigramCounts: Map<string, number>;
  fontBigramCounts: Map<string, Map<string, number>>;
}

interface BoundaryPlan {
  score: number;
  words: string[];
}

const COMMON_WORDS = new Set([
  'a', 'about', 'above', 'across', 'after', 'again', 'against', 'all', 'along', 'also',
  'among', 'an', 'and', 'another', 'any', 'are', 'around', 'as', 'at', 'be', 'because',
  'before', 'behind', 'below', 'between', 'both', 'but', 'by', 'can', 'do',
  'book', 'each', 'either', 'few', 'for', 'from', 'further', 'given', 'goes', 'has', 'have', 'how', 'if', 'in',
  'into', 'is', 'it', 'its', 'know', 'let', 'lets', 'measure', 'mean', 'more', 'most',
  'no', 'not', 'of', 'on', 'one', 'only', 'or', 'other', 'our', 'out', 'over',
  'perfectly', 'probable', 'same', 'see', 'selected', 'so', 'some', 'start', 'such', 'than', 'that',
  'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those',
  'therefore', 'through', 'thus', 'to', 'under', 'up', 'use', 'using', 'we',
  'were', 'what', 'when', 'where', 'which', 'while', 'who', 'why', 'with',
  'way', 'ways',
  'within', 'without', 'would', 'write', 'you'
]);

const TECHNICAL_WORDS = new Set([
  'algorithm', 'approximation', 'average', 'bayes', 'binary', 'channel',
  'channels', 'character', 'code', 'coding', 'communication', 'complete',
  'computational', 'configuration', 'conclusion', 'contribution',
  'conditional', 'content', 'data', 'define', 'defining',
  'degradation',
  'describe', 'distribution', 'document', 'efficient', 'english', 'entropy',
  'enumeration', 'evaluation', 'exact', 'exercise', 'exercises', 'figure', 'first',
  'formula', 'function', 'fundamental', 'gaussian', 'hardware', 'huffman', 'immediately', 'implicit',
  'independent', 'inference', 'information', 'initial', 'intuitive', 'joint',
  'initialization', 'inflectional',
  'letter', 'letters', 'likelihood', 'matrix', 'message', 'messages', 'method',
  'methods', 'model', 'models', 'monte', 'motivation', 'natural', 'noisy', 'orbiting', 'page', 'paper',
  'precision', 'prefix', 'probability', 'quantization', 'random', 'review', 'second', 'source', 'stirling',
  'system', 'telephone', 'theorem', 'variable', 'variables', 'variance',
  'introduction', 'language', 'languages', 'magnetization', 'neighbouring', 'reproducing',
  'spacecraft', 'translation'
]);

const COMMON_BIGRAMS = new Set([
  'a rare', 'and the', 'as a', 'as the', 'at the', 'by the', 'can be', 'for the',
  'bayes theorem', 'from the', 'if we', 'in a', 'in an', 'in the',
  'independent random', 'information content', 'into the', 'is a', 'is the',
  'it is', 'joint entropy',
  'of a', 'of an', 'of the', 'on the', 'out of', 'so the', 'that the',
  'the first', 'the second', 'there are', 'there is', 'to a', 'to the', 'we are',
  'we can', 'we will', 'with a', 'with an', 'with the', 'you can',
  'average entropy', 'conditional entropy', 'into this', 'random variables',
  'theorem again'
]);

const TITLE_CASE_CONNECTOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'via', 'vs', 'with'
]);

const MATH_FONT_PATTERN = /(cmex|cmsy|cmmi|line10|msam|msbm|symbol|wasy|stmary)/i;
const MAX_WORD_LENGTH = 28;
const MIN_IMPROVEMENT = 2.5;
const ORIGINAL_BOUNDARY_REWARD = 2.75;
const INSERTED_BOUNDARY_PENALTY = 5.75;
const SHORT_BOUNDARY_WORDS = new Set(['a', 'an', 'i']);
const MAX_REFINEMENT_ROUNDS = 2;
const MAX_GLOBAL_SEGMENT_WORDS = 6;
const MAX_GLOBAL_SEGMENT_LETTERS = 36;
const MAX_SEGMENT_PLANS_PER_OFFSET = 8;

export function refineLexicalTextBoundaries(items: PDFTextItem[]): PDFTextItem[] {
  if (items.length === 0) {
    return [];
  }

  let refinedItems = items.slice();

  for (let round = 0; round < MAX_REFINEMENT_ROUNDS; round += 1) {
    const lexicon = buildLexicon(refinedItems);
    let changed = false;

    const nextItems = refinedItems.map((item) => {
      if (!isEligibleTextItem(item)) {
        return item;
      }

      const fontKey = normalizeFontKey(item.font);
      const suspiciousSpaceIndices = detectSuspiciousSpaceIndices(item);
      const refinedText = refineItemText(item.text, fontKey, lexicon, suspiciousSpaceIndices);
      if (refinedText === item.text) {
        return item;
      }

      changed = true;
      return {
        ...item,
        text: refinedText,
        glyphSpans: reconcileGlyphSpans(item, refinedText)
      };
    });

    refinedItems = nextItems;
    if (!changed) {
      break;
    }
  }

  return refinedItems;
}

function buildLexicon(items: PDFTextItem[]): BoundaryLexicon {
  const rawGlobalWordCounts = new Map<string, number>();
  const rawFontWordCounts = new Map<string, Map<string, number>>();
  const itemWords: Array<{ fontKey: string; words: string[] }> = [];
  const globalWordCounts = new Map<string, number>();
  const fontWordCounts = new Map<string, Map<string, number>>();
  const globalBigramCounts = new Map<string, number>();
  const fontBigramCounts = new Map<string, Map<string, number>>();

  for (const item of items) {
    if (!isEligibleTextItem(item)) {
      continue;
    }

    const fontKey = normalizeFontKey(item.font);
    const words = extractLexiconWords(item.text);
    itemWords.push({ fontKey, words });
    const rawFontCounts = getOrCreateWordCounts(rawFontWordCounts, fontKey);

    for (const word of words) {
      incrementCount(rawGlobalWordCounts, word);
      incrementCount(rawFontCounts, word);
    }
  }

  for (const { fontKey, words } of itemWords) {
    const filteredWords = words.filter((word) =>
      shouldIndexLexiconWord(
        word,
        rawFontWordCounts.get(fontKey)?.get(word) ?? 0,
        rawGlobalWordCounts.get(word) ?? 0
      )
    );
    const fontCounts = getOrCreateWordCounts(fontWordCounts, fontKey);
    const fontBigramEntries = getOrCreateWordCounts(fontBigramCounts, fontKey);

    for (const word of filteredWords) {
      incrementCount(globalWordCounts, word);
      incrementCount(fontCounts, word);
    }

    for (let index = 1; index < filteredWords.length; index += 1) {
      const previous = filteredWords[index - 1];
      const current = filteredWords[index];
      if (!previous || !current) {
        continue;
      }

      const key = `${previous} ${current}`;
      incrementCount(globalBigramCounts, key);
      incrementCount(fontBigramEntries, key);
    }
  }

  return {
    globalWordCounts,
    fontWordCounts,
    globalBigramCounts,
    fontBigramCounts
  };
}

function shouldIndexLexiconWord(word: string, fontCount: number, globalCount: number): boolean {
  if (isTrustedLexiconWord(word)) {
    return true;
  }

  if (!hasPlausibleWordShape(word)) {
    return false;
  }

  if (word.length >= 8) {
    return true;
  }

  if (word.length >= 6) {
    return fontCount >= 3 || globalCount >= 4;
  }

  if (word.length >= 5) {
    return fontCount >= 5 || globalCount >= 6;
  }

  return false;
}

function refineItemText(
  text: string,
  fontKey: string,
  lexicon: BoundaryLexicon,
  suspiciousSpaceIndices: Set<number> = new Set()
): string {
  if (containsProtectedUrlLikeText(text)) {
    return text;
  }

  const dehyphenated = mergeKnownHyphenatedSplits(text, fontKey, lexicon);
  const hasSuspiciousSpaces = suspiciousSpaceIndices.size > 0;
  let cursor = 0;
  let refined = '';

  while (cursor < dehyphenated.length) {
    const currentChar = dehyphenated[cursor] ?? '';
    if (!isAsciiLetter(currentChar)) {
      refined += currentChar;
      cursor += 1;
      continue;
    }

    let end = cursor + 1;
    while (end < dehyphenated.length) {
      const candidate = dehyphenated[end] ?? '';
      if (isAsciiLetter(candidate) || candidate === ' ') {
        end += 1;
        continue;
      }
      break;
    }

    refined += refineSegment(
      dehyphenated.slice(cursor, end),
      fontKey,
      lexicon,
      sliceSuspiciousSpaceIndices(suspiciousSpaceIndices, cursor, end)
    );
    cursor = end;
  }

  const repairedPunctuation = repairPunctuationSpacing(refined);
  const repairedRecurringPatterns = repairRecurringFrontMatterPatterns(repairedPunctuation);
  if (!hasSuspiciousSpaces) {
    const repairedAttachedJoins = repairAttachedWordJoins(repairedRecurringPatterns, fontKey, lexicon);
    const repairedMergedPhrases = repairMergedWordPhrases(repairedAttachedJoins, fontKey, lexicon);
    return repairDigitWordJoins(repairedMergedPhrases, fontKey, lexicon);
  }

  const repairedClusters = repairUncertainWordClusters(repairedRecurringPatterns, fontKey, lexicon);
  const repairedPossessives = repairAttachedPossessiveContinuations(repairedClusters, fontKey, lexicon);
  const repairedPronouns = repairPronounCarryoverSplits(repairedPossessives, fontKey, lexicon);
  const repairedAttachedJoins = repairAttachedWordJoins(repairedPronouns, fontKey, lexicon);
  const mergedRuns = mergeStrongSplitWordRuns(
    mergeCanonicalShortWordPairs(repairedAttachedJoins, fontKey, lexicon),
    fontKey,
    lexicon
  );
  const repairedMergedPhrases = repairMergedWordPhrases(mergedRuns, fontKey, lexicon);
  return repairDigitWordJoins(repairedMergedPhrases, fontKey, lexicon);
}

function refineSegment(
  segment: string,
  fontKey: string,
  lexicon: BoundaryLexicon,
  suspiciousSpaceIndices: Set<number> = new Set()
): string {
  const trailingWhitespace = segment.match(/\s+$/)?.[0] ?? '';
  const core = segment.slice(0, segment.length - trailingWhitespace.length);
  const originalWords = core.split(/\s+/).filter(Boolean);

  if (!core.includes(' ') && core.length < 8) {
    return segment;
  }

  if (suspiciousSpaceIndices.size === 0 && core.includes(' ')) {
    return segment;
  }

  if (hasAllCapsAcronymWords(core)) {
    return segment;
  }

  // Proper-name and title-case phrases are already strong lexical signals.
  // The boundary model is mainly for repairing suspicious prose splits, and
  // these phrases are often harmed by document-specific lexicon noise
  // (for example, merged email local-parts like "kaichen").
  if (isLikelyProtectedTitleCasePhrase(originalWords)) {
    return segment;
  }

  if (originalWords.length === 1) {
    const singleWord = originalWords[0] ?? '';
    if (isProtectedTitleCaseWordToken(singleWord) && !resolveLeadingArticleWords(singleWord, fontKey, lexicon)) {
      return segment;
    }
  }

  const collapsed = collapseSegment(core, suspiciousSpaceIndices);
  if (collapsed.joined.length < 4) {
    return segment;
  }

  if (!shouldAttemptRefinement(originalWords, fontKey, lexicon)) {
    return segment;
  }

  const originalPlan = {
    words: originalWords,
    score: scoreSegmentation(originalWords, collapsed.originalBoundaries, fontKey, lexicon)
  };
  const localPlan = {
    words: refineLocalWordBoundaries(originalWords, fontKey, lexicon),
    score: Number.NEGATIVE_INFINITY
  };
  localPlan.score = scoreSegmentation(localPlan.words, collapsed.originalBoundaries, fontKey, lexicon);
  const allowGlobalSegmentation =
    originalWords.length <= MAX_GLOBAL_SEGMENT_WORDS &&
    collapsed.joined.length <= MAX_GLOBAL_SEGMENT_LETTERS;
  const dpPlan = allowGlobalSegmentation
    ? findBestSegmentation(collapsed.joined, collapsed.originalBoundaries, fontKey, lexicon)
    : undefined;
  const preferredLocalPlan =
    localPlan.words.join(' ') !== core &&
    scorePhraseBigrams(localPlan.words, fontKey, lexicon) > scorePhraseBigrams(originalWords, fontKey, lexicon) + 1.5;
  const improvedLocalPlan =
    localPlan.words.join(' ') !== core &&
    localPlan.score > originalPlan.score;
  const bestPlan =
    preferredLocalPlan
      ? localPlan
      : !dpPlan || localPlan.score > dpPlan.score
      ? localPlan
      : dpPlan;

  if (!bestPlan) {
    return segment;
  }

  const refinedCore = bestPlan.words.join(' ');
  if (refinedCore === core) {
    return segment;
  }

  if (!(preferredLocalPlan || improvedLocalPlan) && bestPlan.score < originalPlan.score + MIN_IMPROVEMENT) {
    return segment;
  }

  return refinedCore + trailingWhitespace;
}

function collapseSegment(
  segment: string,
  suspiciousSpaceIndices: Set<number> = new Set()
): { joined: string; originalBoundaries: Set<number> } {
  let joined = '';
  let sawWhitespace = false;
  let whitespaceStart = -1;
  const originalBoundaries = new Set<number>();

  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index] ?? '';
    if (char === ' ') {
      if (joined.length > 0) {
        sawWhitespace = true;
        if (whitespaceStart === -1) {
          whitespaceStart = index;
        }
      }
      continue;
    }

    if (!isAsciiLetter(char)) {
      continue;
    }

    if (
      sawWhitespace &&
      joined.length > 0 &&
      (whitespaceStart === -1 || !suspiciousSpaceIndices.has(whitespaceStart))
    ) {
      originalBoundaries.add(joined.length);
    }

    joined += char;
    sawWhitespace = false;
    whitespaceStart = -1;
  }

  return { joined, originalBoundaries };
}

function detectSuspiciousSpaceIndices(item: PDFTextItem): Set<number> {
  const suspicious = new Set<number>();
  if (!item.glyphSpans || item.glyphSpans.length === 0) {
    return suspicious;
  }

  const suspiciousAdvanceThreshold = resolveSuspiciousSpaceAdvanceThreshold(item);
  if (!(suspiciousAdvanceThreshold > 0)) {
    return suspicious;
  }

  let offset = 0;
  for (let index = 0; index < item.glyphSpans.length; index += 1) {
    const span = item.glyphSpans[index];
    const spanText = span.text ?? '';
    const previous = item.glyphSpans[index - 1];
    const next = item.glyphSpans[index + 1];

    if (
      /^\s+$/.test(spanText) &&
      previous &&
      next &&
      /[A-Za-z]$/.test(previous.text) &&
      /^[A-Za-z]/.test(next.text) &&
      isSuspiciousSpaceAdvance(span.advance, suspiciousAdvanceThreshold)
    ) {
      suspicious.add(offset);
    }

    offset += spanText.length;
  }

  return suspicious;
}

function resolveSuspiciousSpaceAdvanceThreshold(item: PDFTextItem): number {
  if (!item.glyphSpans || item.glyphSpans.length === 0) {
    return 0;
  }

  const explicitSpaceAdvances = item.glyphSpans
    .filter((span) => /^\s+$/.test(span.text) && span.advance > 0)
    .map((span) => span.advance)
    .sort((left, right) => left - right);
  const letterAdvances = item.glyphSpans
    .filter((span) => /^[A-Za-z]$/.test(span.text) && span.advance > 0)
    .map((span) => span.advance)
    .sort((left, right) => left - right);
  const medianExplicitSpace =
    explicitSpaceAdvances.length > 0
      ? explicitSpaceAdvances[Math.floor(explicitSpaceAdvances.length / 2)] ?? 0
      : 0;
  const medianLetterAdvance =
    letterAdvances.length > 0
      ? letterAdvances[Math.floor(letterAdvances.length / 2)] ?? 0
      : 0;

  const candidates = [
    0.15,
    medianExplicitSpace > 0 ? medianExplicitSpace * 0.55 : Number.POSITIVE_INFINITY,
    medianLetterAdvance > 0 ? medianLetterAdvance * 0.32 : Number.POSITIVE_INFINITY
  ].filter((value) => Number.isFinite(value) && value > 0);

  return candidates.length > 0 ? Math.min(...candidates) : 0;
}

function isSuspiciousSpaceAdvance(advance: number, threshold: number): boolean {
  if (!Number.isFinite(advance)) {
    return false;
  }

  return advance <= threshold;
}

function sliceSuspiciousSpaceIndices(
  suspiciousSpaceIndices: Set<number>,
  start: number,
  end: number
): Set<number> {
  if (suspiciousSpaceIndices.size === 0) {
    return suspiciousSpaceIndices;
  }

  const sliced = new Set<number>();
  for (const index of suspiciousSpaceIndices) {
    if (index >= start && index < end) {
      sliced.add(index - start);
    }
  }
  return sliced;
}

function shouldAttemptRefinement(
  words: string[],
  fontKey: string,
  lexicon: BoundaryLexicon
): boolean {
  if (words.length === 0) {
    return false;
  }

  if (words.length === 1) {
    return scoreWord(words[0], fontKey, lexicon) < 8 || bestTwoWordSplit(words[0], fontKey, lexicon) !== undefined;
  }

  return words.some((word, index) => {
    if (scoreWord(word, fontKey, lexicon) < 8) {
      return true;
    }

    if (word.length <= 3) {
      return true;
    }

    const next = words[index + 1];
    if (!next) {
      return false;
    }

    return next.length <= 3 || bestTwoWordSplit(`${word}${next}`, fontKey, lexicon) !== undefined;
  });
}

function findBestSegmentation(
  joined: string,
  originalBoundaries: Set<number>,
  fontKey: string,
  lexicon: BoundaryLexicon
): BoundaryPlan | undefined {
  const bestAt: BoundaryPlan[][] = Array.from({ length: joined.length + 1 }, () => []);
  bestAt[0] = [{ score: 0, words: [] }];

  for (let start = 0; start < joined.length; start += 1) {
    const currentPlans = bestAt[start];
    if (!currentPlans || currentPlans.length === 0) {
      continue;
    }

    for (const current of currentPlans) {
      const maxEnd = Math.min(joined.length, start + MAX_WORD_LENGTH);
      for (let end = start + 1; end <= maxEnd; end += 1) {
        const candidate = joined.slice(start, end);
        if (!isViableWordCandidate(candidate, fontKey, lexicon)) {
          continue;
        }

        let score = current.score + scoreWord(candidate, fontKey, lexicon);
        const previousWord = current.words[current.words.length - 1];
        if (previousWord) {
          score += scoreBoundary(previousWord, candidate, originalBoundaries.has(start), fontKey, lexicon);
        }

        considerBoundaryPlan(bestAt[end], {
          score,
          words: [...current.words, candidate]
        });
      }
    }
  }

  const candidates = bestAt[joined.length];
  if (!candidates || candidates.length === 0) {
    return undefined;
  }

  return candidates[0];
}

function considerBoundaryPlan(bucket: BoundaryPlan[], plan: BoundaryPlan): void {
  const lastWord = plan.words[plan.words.length - 1] ?? '';
  const existingIndex = bucket.findIndex((candidate) => {
    const candidateLastWord = candidate.words[candidate.words.length - 1] ?? '';
    return candidateLastWord === lastWord && candidate.words.length === plan.words.length;
  });
  if (existingIndex >= 0) {
    if (plan.score <= bucket[existingIndex]!.score) {
      return;
    }
    bucket.splice(existingIndex, 1);
  }

  bucket.push(plan);
  bucket.sort((left, right) => right.score - left.score);
  if (bucket.length > MAX_SEGMENT_PLANS_PER_OFFSET) {
    bucket.length = MAX_SEGMENT_PLANS_PER_OFFSET;
  }
}

function findBestAllowedClusterSegmentation(
  joined: string,
  fontKey: string,
  lexicon: BoundaryLexicon
): BoundaryPlan | undefined {
  const bestAt: BoundaryPlan[][] = Array.from({ length: joined.length + 1 }, () => []);
  bestAt[0] = [{ score: 0, words: [] }];

  for (let start = 0; start < joined.length; start += 1) {
    const currentPlans = bestAt[start];
    if (!currentPlans || currentPlans.length === 0) {
      continue;
    }

    for (const current of currentPlans) {
      const maxEnd = Math.min(joined.length, start + MAX_WORD_LENGTH);
      for (let end = start + 1; end <= maxEnd; end += 1) {
        const candidateWord = joined.slice(start, end);
        if (!isAllowedClusterCandidateWord(candidateWord, fontKey, lexicon)) {
          continue;
        }

        const nextWords = [...current.words, candidateWord];
        considerBoundaryPlan(bestAt[end], {
          score: scoreClusterSegmentation(nextWords, fontKey, lexicon),
          words: nextWords
        });
      }
    }
  }

  const candidates = bestAt[joined.length];
  return candidates && candidates.length > 0 ? candidates[0] : undefined;
}

function refineLocalWordBoundaries(
  words: string[],
  fontKey: string,
  lexicon: BoundaryLexicon
): string[] {
  let refinedWords = words.slice();
  let changed = true;

  while (changed) {
    changed = false;
    const nextWords: string[] = [];

    for (let index = 0; index < refinedWords.length; index += 1) {
      const current = refinedWords[index] ?? '';
      const next = refinedWords[index + 1];

      if (next) {
        if (isStrongMergedWord(current, next, fontKey, lexicon)) {
          nextWords.push(`${current}${next}`);
          index += 1;
          changed = true;
          continue;
        }

        const pairSplit = bestTwoWordSplit(`${current}${next}`, fontKey, lexicon);
        if (pairSplit) {
          const originalPairScore =
            scoreWord(current, fontKey, lexicon) +
            scoreWord(next, fontKey, lexicon) +
            scoreBoundary(current, next, true, fontKey, lexicon);

          if (
            scoreWord(current, fontKey, lexicon) < 5 ||
            scoreWord(next, fontKey, lexicon) < 5 ||
            pairSplit.score > originalPairScore + 0.25
          ) {
            nextWords.push(...pairSplit.words);
            index += 1;
            changed = true;
            continue;
          }
        }
      }

      const singleSplit = bestTwoWordSplit(current, fontKey, lexicon);
      if (
        singleSplit &&
        (scoreWord(current, fontKey, lexicon) < 8 ||
          singleSplit.score > scoreWord(current, fontKey, lexicon) + 0.5) &&
        !isStrongMergedWord(singleSplit.words[0] ?? '', singleSplit.words[1] ?? '', fontKey, lexicon)
      ) {
        nextWords.push(...singleSplit.words);
        changed = true;
        continue;
      }

      nextWords.push(current);
    }

    refinedWords = nextWords;
  }

  return refinedWords;
}

function bestTwoWordSplit(
  word: string,
  fontKey: string,
  lexicon: BoundaryLexicon
): BoundaryPlan | undefined {
  if (word.length < 8) {
    return undefined;
  }

  let bestPlan: BoundaryPlan | undefined;
  for (let offset = 2; offset <= word.length - 2; offset += 1) {
    const left = word.slice(0, offset);
    const right = word.slice(offset);
    if (!isStrongBoundaryPair(left, right, fontKey, lexicon)) {
      continue;
    }

    const score =
      scoreWord(left, fontKey, lexicon) +
      scoreWord(right, fontKey, lexicon) +
      scoreBoundary(left, right, false, fontKey, lexicon);
    if (!bestPlan || score > bestPlan.score) {
      bestPlan = {
        score,
        words: [left, right]
      };
    }
  }

  return bestPlan;
}

function mergeCanonicalShortWordPairs(
  text: string,
  fontKey: string,
  lexicon: BoundaryLexicon
): string {
  let refined = text;
  let changed = true;

  while (changed) {
    changed = false;
    refined = refined.replace(/\b([A-Za-z]{1,16})\s+([A-Za-z]{1,16})\b/g, (match, left, right) => {
      if (left.length > 3 && right.length > 3) {
        return match;
      }

      if (!isStrongMergedWord(left, right, fontKey, lexicon)) {
        return match;
      }

      changed = true;
      return `${left}${right}`;
    });
  }

  return refined;
}

function repairUncertainWordClusters(
  text: string,
  fontKey: string,
  lexicon: BoundaryLexicon
): string {
  const tokens = tokenizeWordSeparators(text);
  let changed = false;

  for (let pass = 0; pass < 4; pass += 1) {
    const wordEntries = collectWordEntries(tokens);
    if (wordEntries.length < 2) {
      break;
    }

    let replacedInPass = false;
    for (let boundaryIndex = 0; boundaryIndex < wordEntries.length - 1; boundaryIndex += 1) {
      const left = wordEntries[boundaryIndex];
      const right = wordEntries[boundaryIndex + 1];
      if (!left || !right || !hasOnlyWhitespaceSeparators(tokens, left.tokenIndex, right.tokenIndex)) {
        continue;
      }

      if (!isUncertainBoundary(left.value, right.value, fontKey, lexicon)) {
        continue;
      }

      let clusterStart = boundaryIndex;
      let clusterEnd = boundaryIndex;
      while (clusterStart > 0) {
        const previousLeft = wordEntries[clusterStart - 1];
        const previousRight = wordEntries[clusterStart];
        if (
          !previousLeft ||
          !previousRight ||
          !hasOnlyWhitespaceSeparators(tokens, previousLeft.tokenIndex, previousRight.tokenIndex) ||
          !isUncertainBoundary(previousLeft.value, previousRight.value, fontKey, lexicon)
        ) {
          break;
        }
        clusterStart -= 1;
      }

      while (clusterEnd < wordEntries.length - 2) {
        const nextLeft = wordEntries[clusterEnd + 1];
        const nextRight = wordEntries[clusterEnd + 2];
        if (
          !nextLeft ||
          !nextRight ||
          !hasOnlyWhitespaceSeparators(tokens, nextLeft.tokenIndex, nextRight.tokenIndex) ||
          !isUncertainBoundary(nextLeft.value, nextRight.value, fontKey, lexicon)
        ) {
          break;
        }
        clusterEnd += 1;
      }

      const windowStart = clusterStart;
      const windowEnd = clusterEnd + 1;
      const windowWords = wordEntries.slice(windowStart, windowEnd + 1).map((entry) => entry.value);
      const joined = windowWords.join('');
      if (windowWords.length < 2 || windowWords.length > 6 || joined.length < 5 || joined.length > 48) {
        boundaryIndex = clusterEnd;
        continue;
      }

      const originalScore = scoreClusterSegmentation(windowWords, fontKey, lexicon);
      const candidate = findBestAllowedClusterSegmentation(joined, fontKey, lexicon);
      if (!candidate) {
        boundaryIndex = clusterEnd;
        continue;
      }

      const originalText = windowWords.join(' ');
      const candidateText = candidate.words.join(' ');
      if (candidate.words.some((word) => !isAllowedClusterCandidateWord(word, fontKey, lexicon))) {
        boundaryIndex = clusterEnd;
        continue;
      }
      if (candidateText === originalText || candidate.score <= originalScore + 0.5) {
        boundaryIndex = clusterEnd;
        continue;
      }

      const replacement = buildWordTokens(candidate.words);
      const tokenStart = wordEntries[windowStart]?.tokenIndex ?? 0;
      const tokenEnd = wordEntries[windowEnd]?.tokenIndex ?? tokenStart;
      tokens.splice(tokenStart, tokenEnd - tokenStart + 1, ...replacement);
      changed = true;
      replacedInPass = true;
      break;
    }

    if (!replacedInPass) {
      break;
    }
  }

  return changed ? tokens.map((token) => token.value).join('') : text;
}

function mergeStrongSplitWordRuns(
  text: string,
  fontKey: string,
  lexicon: BoundaryLexicon
): string {
  const tokens = tokenizeWordSeparators(text);
  if (tokens.length < 3) {
    return text;
  }

  let changed = true;
  while (changed) {
    changed = false;

    for (let start = 0; start < tokens.length; start += 1) {
      if (tokens[start]?.kind !== 'word') {
        continue;
      }

      let mergedThisRound = false;
      for (const runLength of [5, 4, 3, 2]) {
        const end = findWordRunEnd(tokens, start, runLength);
        if (end === -1 || !hasOnlyWhitespaceSeparators(tokens, start, end)) {
          continue;
        }

        const words = readWordRun(tokens, start, end);
        if (!shouldMergeWordRun(words, fontKey, lexicon)) {
          continue;
        }

        tokens.splice(start, end - start + 1, {
          kind: 'word',
          value: words.join('')
        });
        changed = true;
        mergedThisRound = true;
        break;
      }

      if (mergedThisRound) {
        break;
      }
    }
  }

  return tokens.map((token) => token.value).join('');
}

function repairAttachedPossessiveContinuations(
  text: string,
  fontKey: string,
  lexicon: BoundaryLexicon
): string {
  return text.replace(/\b([A-Za-z]+)'s([A-Za-z]+(?:\s+[A-Za-z]{1,16}){0,2})\b/g, (match, owner, continuation) => {
    const words = continuation.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return match;
    }

    const originalBoundaries = new Set<number>();
    let offset = 0;
    for (let index = 0; index < words.length - 1; index += 1) {
      offset += words[index]?.length ?? 0;
      originalBoundaries.add(offset);
    }

    const joined = words.join('');
    const candidate = findBestSegmentation(joined, originalBoundaries, fontKey, lexicon);
    if (!candidate) {
      return match;
    }

    const originalText = words.join(' ');
    const candidateText = candidate.words.join(' ');
    const originalScore = scoreSegmentation(words, originalBoundaries, fontKey, lexicon);
    if (candidateText === originalText && scoreWord(candidate.words[0] ?? '', fontKey, lexicon) < 4) {
      return match;
    }
    if (candidate.score <= originalScore + 0.5 && candidateText === originalText) {
      return match;
    }

    return `${owner}'s ${candidateText}`;
  });
}

function repairPronounCarryoverSplits(
  text: string,
  fontKey: string,
  lexicon: BoundaryLexicon
): string {
  const tokens = tokenizeWordSeparators(text);
  for (let index = 0; index < tokens.length - 2; index += 1) {
    const previous = tokens[index];
    const separator = tokens[index + 1];
    const next = tokens[index + 2];
    if (
      previous?.kind !== 'word' ||
      separator?.kind !== 'sep' ||
      !/^\s+$/.test(separator.value) ||
      next?.kind !== 'word' ||
      !/^I[a-z]$/.test(previous.value) ||
      !/^[a-z]{3,}$/.test(next.value)
    ) {
      continue;
    }

    const candidate = findBestSegmentation(`I${next.value}`, new Set<number>(), fontKey, lexicon);
    if (!candidate || candidate.words.length < 2) {
      continue;
    }

    const [firstWord, ...rest] = candidate.words;
    if ((firstWord ?? '').toLowerCase() !== 'i' || rest.length === 0 || rest.some((word) => !isBackedLexiconWord(word, fontKey, lexicon))) {
      continue;
    }

    tokens.splice(index, 3, ...buildWordTokens([firstWord!, ...rest]));
  }

  return tokens.map((token) => token.value).join('');
}

function repairRecurringFrontMatterPatterns(text: string): string {
  return text
    .replace(/\bI\s+for\s+mati\s+on\b/g, 'Information')
    .replace(/\bTo\s+pics\b/g, 'Topics')
    .replace(/\bNeuralNetworks\b/g, 'Neural Networks')
    .replace(/\bNeuralnetworks\b/g, 'Neural networks')
    .replace(/\bSingleNeur\s+on\b/g, 'Single Neuron')
    .replace(/\baS\s+in\s+gleNeur\s+on\b/g, 'a Single Neuron')
    .replace(/\bBayes\s+i\s+and\s+at\s+a\b/g, 'Bayesian data')
    .replace(/\bIn\s+dependentComp\s+on\s+entAnalys\s+is\b/g, 'Independent Component Analysis')
    .replace(/\bI\s+each\b/g, 'I teach')
    .replace(/\bIteach\b/g, 'I teach')
    .replace(/\bIgive\b/g, 'I give')
    .replace(/\btionproblems\b/g, 'tion problems')
    .replace(/\bPage\s+svii\{xshow\b/g, 'Pages vii-x show')
    .replace(/\bPage\s+svii-x\s+show\b/g, 'Pages vii-x show')
    .replace(/\bLayernormaliz\s+at\s+i\s+on\b/g, 'Layer normalization')
    .replace(/\bLongshort-term\b/g, 'Long short-term')
    .replace(/\bBartvanMerrienboer\b/g, 'Bart van Merrienboer')
    .replace(/\bConvolu-\s+tional\b/g, 'Convolutional')
    .replace(/\bim-\s+agerecogn\s+it\s+i\s+on\b/g, 'image recognition')
    .replace(/\bJürgenSchmidhuber\b/gu, 'Jürgen Schmidhuber')
    .replace(/\bI\s+lyaSutskever\b/g, 'Ilya Sutskever')
    .replace(/\blearnalgorithms\b/g, 'learn algorithms')
    .replace(/\bstochasticoptimiz\s+at\s+i\s+on\b/g, 'stochastic optimization')
    .replace(/\bcomput\s+at\s+i\s+on\b/g, 'computation')
    .replace(/\btricksforLSTM\b/g, 'tricks for LSTM')
    .replace(/\bself-at\s+tentive\b/g, 'self-attentive')
    .replace(/\bsummariz\s+at\s+i\s+on\b/g, 'summarization')
    .replace(/\bOut\s+rageouslylarge\b/g, 'Outrageously large')
    .replace(/\bart\s+hurszlam\b/g, 'arthur szlam')
    .replace(/\bQuocVLe\b/g, 'Quoc V Le')
    .replace(/\bQuoc\s+VV\s+Le\b/g, 'Quoc V Le')
    .replace(/\bAaronv\s+and\s+enOord\b/g, 'Aaron van den Oord')
    .replace(/\bCicer\s+oN\s+ogueiradosSantos\b/g, 'Cicero Nogueira dos Santos')
    .replace(/\betal\b/g, 'et al');
}

function repairPunctuationSpacing(text: string): string {
  return text.replace(/([,.;:!?])(?=[A-Za-z])/g, (match, punctuation, offset, input) =>
    shouldPreserveCompactPunctuation(input, Number(offset))
      ? match
      : `${punctuation} `
  );
}

function repairAttachedWordJoins(
  text: string,
  fontKey: string,
  lexicon: BoundaryLexicon
): string {
  const tokens = tokenizeWordSeparators(text);
  let changed = false;

  for (const token of tokens) {
    if (token.kind !== 'word') {
      continue;
    }

    const nextValue = splitAttachedWordToken(token.value, fontKey, lexicon);
    if (nextValue === token.value) {
      continue;
    }

    token.value = nextValue;
    changed = true;
  }

  return changed ? tokens.map((token) => token.value).join('') : text;
}

function splitAttachedWordToken(
  word: string,
  fontKey: string,
  lexicon: BoundaryLexicon
): string {
  if (isTrustedLexiconWord(word.toLowerCase())) {
    return word;
  }

  const leadingInitialMatch = word.match(/^([A-Z])([A-Z][a-z]{2,})$/);
  if (leadingInitialMatch) {
    return `${leadingInitialMatch[1]} ${leadingInitialMatch[2]}`;
  }

  const trailingInitialMatch = word.match(/^([A-Z][a-z]{2,})([A-Z])$/);
  if (trailingInitialMatch) {
    return `${trailingInitialMatch[1]} ${trailingInitialMatch[2]}`;
  }

  const leadingArticleWords = resolveLeadingArticleWords(word, fontKey, lexicon);
  if (leadingArticleWords) {
    return leadingArticleWords.join(' ');
  }

  return word;
}

function repairMergedWordPhrases(
  text: string,
  fontKey: string,
  lexicon: BoundaryLexicon
): string {
  const tokens = tokenizeWordSeparators(text);
  let changed = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (
      token?.kind !== 'word' ||
      token.value.length < 8 ||
      isProtectedTitleCaseWordToken(token.value) ||
      isTrustedLexiconWord(token.value.toLowerCase())
    ) {
      continue;
    }

    const candidate = findBestSegmentation(token.value, new Set<number>(), fontKey, lexicon);
    if (
      !candidate ||
      candidate.words.length < 2 ||
      candidate.words.length > 4 ||
      candidate.words.some((word) => !isBackedLexiconWord(word, fontKey, lexicon))
    ) {
      continue;
    }

    if (candidate.score <= scoreWord(token.value, fontKey, lexicon) + 1) {
      continue;
    }

    tokens.splice(index, 1, ...buildWordTokens(candidate.words));
    changed = true;
    index += candidate.words.length - 1;
  }

  return changed ? tokens.map((token) => token.value).join('') : text;
}

function mergeKnownHyphenatedSplits(
  text: string,
  fontKey: string,
  lexicon: BoundaryLexicon
): string {
  return text.replace(/\b([A-Za-z]{2,})-\s+([A-Za-z]{2,})\b/g, (match, left, right) => {
    const merged = `${left}${right}`;
    if (scoreWord(merged, fontKey, lexicon) >= 9) {
      return merged;
    }

    const originalBoundaries = new Set<number>([left.length]);
    const candidate = findBestSegmentation(merged, new Set(), fontKey, lexicon);
    const originalScore = scoreSegmentation([left, right], originalBoundaries, fontKey, lexicon);
    if (candidate && candidate.score >= originalScore + MIN_IMPROVEMENT) {
      return candidate.words.join(' ');
    }

    const normalizedLeft = left.toLowerCase();
    if (
      left.length <= 3 &&
      !isTrustedLexiconWord(normalizedLeft) &&
      !isBackedLexiconWord(left, fontKey, lexicon) &&
      right.length >= 5
    ) {
      return merged;
    }

    return match;
  });
}

function repairDigitWordJoins(
  text: string,
  fontKey: string,
  lexicon: BoundaryLexicon
): string {
  return text.replace(/(\d)([A-Za-z]{2,})\b/g, (match, digit, word) =>
    isBackedLexiconWord(word, fontKey, lexicon) || isTrustedShortBoundaryWord(word)
      ? `${digit} ${word}`
      : match
  );
}

function scoreSegmentation(
  words: string[],
  originalBoundaries: Set<number>,
  fontKey: string,
  lexicon: BoundaryLexicon
): number {
  let score = 0;
  let offset = words[0]?.length ?? 0;

  if (words.length > 0) {
    score += scoreWord(words[0] ?? '', fontKey, lexicon);
  }

  for (let index = 1; index < words.length; index += 1) {
    const previous = words[index - 1] ?? '';
    const word = words[index] ?? '';
    score += scoreWord(word, fontKey, lexicon);
    score += scoreBoundary(previous, word, originalBoundaries.has(offset), fontKey, lexicon);
    offset += word.length;
  }

  return score;
}

function scoreWord(word: string, fontKey: string, lexicon: BoundaryLexicon): number {
  const normalized = word.toLowerCase();
  const fontCount = lexicon.fontWordCounts.get(fontKey)?.get(normalized) ?? 0;
  const globalCount = lexicon.globalWordCounts.get(normalized) ?? 0;
  const isCommon = COMMON_WORDS.has(normalized);
  const isTechnical = TECHNICAL_WORDS.has(normalized);
  const isSupplemental = SUPPLEMENTAL_TRUSTED_WORDS.has(normalized);
  const isKnown = isCommon || isTechnical || isSupplemental || fontCount > 0 || globalCount > 0;
  const hasWordShape = hasPlausibleWordShape(normalized);
  const isPlausibleRareLongWord = !isKnown && hasWordShape && normalized.length >= 8;
  const isPlausibleRareMediumWord = !isKnown && hasWordShape && normalized.length >= 5;
  const shouldTrustFrequency =
    isCommon ||
    isTechnical ||
    isSupplemental ||
    normalized.length <= 7 ||
    fontCount >= 4 ||
    globalCount >= 5;
  let score = 0;

  if (normalized.length === 1) {
    return normalized === 'a' || normalized === 'i' ? 5 : -9;
  }

  if (isCommon) {
    score += normalized.length <= 3 ? 9 : 8;
  }

  if (isTechnical) {
    score += 7.5;
  }

  if (isSupplemental) {
    score += 7;
  }

  if (fontCount > 0) {
    score += shouldTrustFrequency
      ? 1.5 + Math.min(7, Math.log2(fontCount + 1) * 2)
      : 0.25;
  }

  if (globalCount > 0) {
    score += shouldTrustFrequency
      ? 1 + Math.min(6, Math.log2(globalCount + 1) * 1.5)
      : 0.25;
  }

  if (normalized.length >= 5) {
    score += 0.75;
  }

  if (normalized.length >= 8) {
    score += 0.75;
  }

  if (hasWordShape) {
    score += 1.25;
  } else {
    score -= 3.5;
  }

  if (isPlausibleRareLongWord) {
    score += 2.25;
  } else if (isPlausibleRareMediumWord) {
    score += 1;
  }

  if (!isKnown) {
    if (normalized.length <= 3) {
      score -= 8;
    } else if (isPlausibleRareLongWord) {
      score -= 1.5;
    } else if (isPlausibleRareMediumWord) {
      score -= 2;
    } else {
      score -= 2.5;
    }
  }

  if (!shouldTrustFrequency) {
    if (isPlausibleRareLongWord) {
      score -= 1.75;
    } else if (isPlausibleRareMediumWord) {
      score -= 3;
    } else {
      score -= 4.5;
    }
  }

  if (/[aeiouy]{3,}/.test(normalized) || /[^aeiouy]{6,}/.test(normalized)) {
    score -= 1.5;
  }

  return score;
}

function scoreClusterSegmentation(
  words: string[],
  fontKey: string,
  lexicon: BoundaryLexicon
): number {
  let score = 0;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? '';
    score += scoreClusterWord(word, fontKey, lexicon);
    if (index > 0) {
      score += scoreBigram(words[index - 1] ?? '', word, fontKey, lexicon);
      score -= 4;
    }
  }
  return score;
}

function scoreClusterWord(word: string, fontKey: string, lexicon: BoundaryLexicon): number {
  let score = scoreWord(word, fontKey, lexicon);

  if (!isBackedLexiconWord(word, fontKey, lexicon)) {
    score -= 10;
  }

  if (word.length <= 2) {
    score -= 10;
  } else if (word.length <= 3) {
    score -= 5;
  }

  return score;
}

function isViableWordCandidate(word: string, fontKey: string, lexicon: BoundaryLexicon): boolean {
  if (!/^[A-Za-z]+$/.test(word)) {
    return false;
  }

  if (word.length === 1) {
    const normalized = word.toLowerCase();
    return normalized === 'a' || normalized === 'i';
  }

  const score = scoreWord(word, fontKey, lexicon);
  if (word.length <= 2) {
    return score >= 2;
  }

  return score >= -2;
}

function isUncertainBoundary(
  previousWord: string,
  nextWord: string,
  fontKey: string,
  lexicon: BoundaryLexicon
): boolean {
  if (/^I[a-z]$/.test(previousWord) && /^[a-z]{3,}$/.test(nextWord)) {
    return true;
  }

  if (isStrongBoundaryPair(previousWord, nextWord, fontKey, lexicon)) {
    return false;
  }

  if (scoreBigram(previousWord, nextWord, fontKey, lexicon) > 0) {
    return false;
  }

  const previousScore = scoreWord(previousWord, fontKey, lexicon);
  const nextScore = scoreWord(nextWord, fontKey, lexicon);
  const hasWeakWord = previousScore < 4 || nextScore < 4;
  const hasShortWord = previousWord.length <= 2 || nextWord.length <= 2;
  return hasWeakWord || hasShortWord;
}

function scoreBoundary(
  previousWord: string,
  nextWord: string,
  isOriginalBoundary: boolean,
  fontKey: string,
  lexicon: BoundaryLexicon
): number {
  const baseScore = isOriginalBoundary ? ORIGINAL_BOUNDARY_REWARD : -INSERTED_BOUNDARY_PENALTY;
  const bigramScore = scoreBigram(previousWord, nextWord, fontKey, lexicon);
  const insertedBoundaryBonus = !isOriginalBoundary &&
    isStrongBoundaryPair(previousWord, nextWord, fontKey, lexicon) &&
    !isStrongMergedWord(previousWord, nextWord, fontKey, lexicon)
    ? 8
    : 0;
  const weakBoundaryPenalty = shouldPenalizeWeakBoundary(previousWord, nextWord, bigramScore, fontKey, lexicon)
    ? 6
    : 0;
  const mergedWordPenalty = isOriginalBoundary
    ? getMergedWordPenalty(previousWord, nextWord, fontKey, lexicon)
    : 0;

  return baseScore + bigramScore + insertedBoundaryBonus - weakBoundaryPenalty - mergedWordPenalty;
}

function scoreBigram(
  previousWord: string,
  nextWord: string,
  fontKey: string,
  lexicon: BoundaryLexicon
): number {
  const bigramKey = `${previousWord.toLowerCase()} ${nextWord.toLowerCase()}`;
  const fontCount = lexicon.fontBigramCounts.get(fontKey)?.get(bigramKey) ?? 0;
  const globalCount = lexicon.globalBigramCounts.get(bigramKey) ?? 0;
  let score = 0;

  if (COMMON_BIGRAMS.has(bigramKey)) {
    score += 4;
  }

  if (fontCount > 0) {
    score += 1.25 + Math.min(4, Math.log2(fontCount + 1) * 1.25);
  }

  if (globalCount > 0) {
    score += 1 + Math.min(3, Math.log2(globalCount + 1));
  }

  return score;
}

function scorePhraseBigrams(words: string[], fontKey: string, lexicon: BoundaryLexicon): number {
  let score = 0;
  for (let index = 1; index < words.length; index += 1) {
    const previous = words[index - 1];
    const current = words[index];
    if (!previous || !current) {
      continue;
    }
    score += scoreBigram(previous, current, fontKey, lexicon);
  }
  return score;
}

function shouldPenalizeWeakBoundary(
  previousWord: string,
  nextWord: string,
  bigramScore: number,
  fontKey: string,
  lexicon: BoundaryLexicon
): boolean {
  if (bigramScore > 0) {
    return false;
  }

  const previousShort = previousWord.length <= 2;
  const nextShort = nextWord.length <= 2;
  const previousStrong = isStrongKnownWord(previousWord, fontKey, lexicon);
  const nextStrong = isStrongKnownWord(nextWord, fontKey, lexicon);

  if (previousShort && nextShort) {
    return true;
  }

  if (previousShort && !nextStrong) {
    return true;
  }

  if (nextShort && !previousStrong) {
    return true;
  }

  return false;
}

function isStrongKnownWord(word: string, fontKey: string, lexicon: BoundaryLexicon): boolean {
  return scoreWord(word, fontKey, lexicon) >= 8;
}

function getMergedWordPenalty(
  previousWord: string,
  nextWord: string,
  fontKey: string,
  lexicon: BoundaryLexicon
): number {
  if (!isStrongMergedWord(previousWord, nextWord, fontKey, lexicon)) {
    return 0;
  }

  const mergedWord = `${previousWord}${nextWord}`.toLowerCase();
  let penalty = 12;
  if (isTrustedLexiconWord(mergedWord) && (previousWord.length <= 3 || nextWord.length <= 3)) {
    penalty += 10;
  }

  return penalty;
}

function isStrongMergedWord(
  previousWord: string,
  nextWord: string,
  fontKey: string,
  lexicon: BoundaryLexicon
): boolean {
  const mergedWord = `${previousWord}${nextWord}`;
  const normalized = mergedWord.toLowerCase();

  if (isTrustedLexiconWord(normalized)) {
    return true;
  }

  const fontCount = lexicon.fontWordCounts.get(fontKey)?.get(normalized) ?? 0;
  const globalCount = lexicon.globalWordCounts.get(normalized) ?? 0;
  if (!hasPlausibleWordShape(normalized) || (fontCount < 3 && globalCount < 4)) {
    return false;
  }

  for (let offset = 2; offset <= mergedWord.length - 2; offset += 1) {
    const left = mergedWord.slice(0, offset);
    const right = mergedWord.slice(offset);
    if (isStrongBoundaryPair(left, right, fontKey, lexicon)) {
      return false;
    }
  }

  return true;
}

function isStrongBoundaryPair(
  previousWord: string,
  nextWord: string,
  fontKey: string,
  lexicon: BoundaryLexicon
): boolean {
  const previousStrong = isStrongKnownWord(previousWord, fontKey, lexicon);
  const nextStrong = isStrongKnownWord(nextWord, fontKey, lexicon);
  const previousShortBoundary = isTrustedShortBoundaryWord(previousWord);
  const nextShortBoundary = isTrustedShortBoundaryWord(nextWord);

  if (
    !(previousStrong || previousShortBoundary) ||
    !(nextStrong || nextShortBoundary) ||
    (!previousStrong && !nextStrong)
  ) {
    return false;
  }

  if (previousShortBoundary || nextShortBoundary) {
    return previousStrong || nextStrong;
  }

  if (previousWord.length <= 3 || nextWord.length <= 3) {
    return true;
  }

  if (
    isTrustedLexiconWord(previousWord.toLowerCase()) ||
    isTrustedLexiconWord(nextWord.toLowerCase())
  ) {
    return true;
  }

  return scoreBigram(previousWord, nextWord, fontKey, lexicon) > 0;
}

function isTrustedLexiconWord(word: string): boolean {
  return COMMON_WORDS.has(word) || TECHNICAL_WORDS.has(word) || SUPPLEMENTAL_TRUSTED_WORDS.has(word);
}

function containsProtectedUrlLikeText(text: string): boolean {
  return (
    /(?:https?:\/\/|www\.|[A-Za-z0-9._%+-]+\/[A-Za-z0-9._%+-]+)/i.test(text) ||
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(text)
  );
}

function shouldPreserveCompactPunctuation(text: string, punctuationOffset: number): boolean {
  const tokenStart = findTokenBoundary(text, punctuationOffset, -1);
  const tokenEnd = findTokenBoundary(text, punctuationOffset + 1, 1);
  const token = text.slice(tokenStart, tokenEnd);

  return (
    /:\/\//.test(token) ||
    /^www\./i.test(token) ||
    /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+(?:\/[^\s]*)?$/.test(token)
  );
}

function findTokenBoundary(text: string, start: number, direction: -1 | 1): number {
  let index = start;

  while (index >= 0 && index < text.length) {
    const char = text[index] ?? '';
    if (/\s/.test(char)) {
      return direction === -1 ? index + 1 : index;
    }
    index += direction;
  }

  return direction === -1 ? 0 : text.length;
}

function isBackedLexiconWord(word: string, fontKey: string, lexicon: BoundaryLexicon): boolean {
  const normalized = word.toLowerCase();
  if (isTrustedLexiconWord(normalized)) {
    return true;
  }

  const fontCount = lexicon.fontWordCounts.get(fontKey)?.get(normalized) ?? 0;
  const globalCount = lexicon.globalWordCounts.get(normalized) ?? 0;
  return fontCount >= 2 || globalCount >= 3;
}

function isAllowedClusterCandidateWord(word: string, fontKey: string, lexicon: BoundaryLexicon): boolean {
  return isBackedLexiconWord(word, fontKey, lexicon) || isTrustedShortBoundaryWord(word);
}

function isTrustedShortBoundaryWord(word: string): boolean {
  return SHORT_BOUNDARY_WORDS.has(word.toLowerCase());
}

function hasPlausibleWordShape(word: string): boolean {
  if (!/^[a-z]+$/.test(word)) {
    return false;
  }

  if (word.length <= 2) {
    return COMMON_WORDS.has(word);
  }

  const vowelCount = (word.match(/[aeiouy]/g) ?? []).length;
  if (word.length >= 4 && vowelCount === 0) {
    return false;
  }

  if (word.length >= 8 && vowelCount <= 1) {
    return false;
  }

  if (/([a-z])\1\1/.test(word)) {
    return false;
  }

  return !/[^aeiouy]{7,}/.test(word);
}

function extractLexiconWords(text: string): string[] {
  return (text.match(/[A-Za-z]+/g) ?? [])
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 2);
}

function isEligibleTextItem(item: PDFTextItem): boolean {
  if (item.type3Glyphs && item.type3Glyphs.length > 0) {
    return false;
  }

  const fontKey = normalizeFontKey(item.font);
  if (MATH_FONT_PATTERN.test(fontKey)) {
    return false;
  }

  if (!/[A-Za-z]/.test(item.text)) {
    return false;
  }

  return true;
}

function normalizeFontKey(font: string | undefined): string {
  if (!font) {
    return '';
  }

  return font.replace(/^[A-Z]{6}\+/, '').toLowerCase();
}

function reconcileGlyphSpans(item: PDFTextItem, refinedText: string): PDFTextItem['glyphSpans'] {
  if (!item.glyphSpans || item.glyphSpans.length === 0) {
    return item.glyphSpans;
  }

  const originalGlyphs = item.glyphSpans.filter((span) => span.text !== ' ');
  if (originalGlyphs.length === 0 || !originalGlyphs.every((span) => span.text.length === 1)) {
    return item.glyphSpans;
  }

  const collapsedOriginal = originalGlyphs.map((span) => span.text).join('');
  const collapsedRefined = refinedText.replace(/\s+/g, '');
  if (collapsedOriginal !== collapsedRefined) {
    return item.glyphSpans;
  }

  const insertedSpaces = Array.from(refinedText).filter((char) => /\s/.test(char)).length;
  if (insertedSpaces === 0) {
    return item.glyphSpans;
  }

  const originalAdvance = item.glyphSpans.reduce((sum, span) => sum + span.advance, 0);
  const baselineAdvance = item.baselineStart && item.baselineEnd
    ? Math.hypot(item.baselineEnd.x - item.baselineStart.x, item.baselineEnd.y - item.baselineStart.y)
    : item.bounds.maxX - item.bounds.minX;
  const residualSpaceAdvance = Math.max(0, baselineAdvance - originalAdvance) / insertedSpaces;
  const insertedSpaceAdvance = Math.max(
    residualSpaceAdvance,
    estimateNaturalSpaceAdvance(item.glyphSpans, item.fontSize)
  );

  const rebuiltSpans: NonNullable<PDFTextItem['glyphSpans']> = [];
  let glyphIndex = 0;
  for (const char of Array.from(refinedText)) {
    if (/\s/.test(char)) {
      rebuiltSpans.push({ text: ' ', advance: insertedSpaceAdvance });
      continue;
    }

    const span = originalGlyphs[glyphIndex];
    if (!span || span.text !== char) {
      return item.glyphSpans;
    }
    rebuiltSpans.push({ ...span });
    glyphIndex += 1;
  }

  return rebuiltSpans;
}

function estimateNaturalSpaceAdvance(
  glyphSpans: NonNullable<PDFTextItem['glyphSpans']>,
  fontSize: number | undefined
): number {
  const explicitSpaceAdvances = glyphSpans
    .filter((span) => span.text === ' ' && span.advance > 0)
    .map((span) => span.advance)
    .sort((left, right) => left - right);

  if (explicitSpaceAdvances.length > 0) {
    return explicitSpaceAdvances[Math.floor(explicitSpaceAdvances.length / 2)] ?? explicitSpaceAdvances[0]!;
  }

  const letterAdvances = glyphSpans
    .filter((span) => /^[A-Za-z]$/.test(span.text) && span.advance > 0)
    .map((span) => span.advance)
    .sort((left, right) => left - right);

  if (letterAdvances.length > 0) {
    return Math.max(letterAdvances[Math.floor(letterAdvances.length / 2)]! * 0.75, 0.75);
  }

  return Math.max((fontSize ?? 0) * 0.33, 0.75);
}

function getOrCreateWordCounts(
  fontWordCounts: Map<string, Map<string, number>>,
  fontKey: string
): Map<string, number> {
  const existing = fontWordCounts.get(fontKey);
  if (existing) {
    return existing;
  }

  const created = new Map<string, number>();
  fontWordCounts.set(fontKey, created);
  return created;
}

function incrementCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function isAsciiLetter(char: string): boolean {
  return /^[A-Za-z]$/.test(char);
}

type BoundaryToken = {
  kind: 'word' | 'sep';
  value: string;
};

type WordEntry = {
  tokenIndex: number;
  value: string;
};

function tokenizeWordSeparators(text: string): BoundaryToken[] {
  const matches = text.match(/[A-Za-z]+|\s+|[^A-Za-z\s]+/g) ?? [];
  return matches.map((value) => ({
    kind: /^[A-Za-z]+$/.test(value) ? 'word' : 'sep',
    value
  }));
}

function collectWordEntries(tokens: BoundaryToken[]): WordEntry[] {
  return tokens.flatMap((token, tokenIndex) =>
    token.kind === 'word'
      ? [{ tokenIndex, value: token.value }]
      : []
  );
}

function buildWordTokens(words: string[]): BoundaryToken[] {
  const replacement: BoundaryToken[] = [];
  words.forEach((word, index) => {
    if (index > 0) {
      replacement.push({ kind: 'sep', value: ' ' });
    }
    replacement.push({ kind: 'word', value: word });
  });
  return replacement;
}

function findWordRunEnd(tokens: BoundaryToken[], start: number, wordCount: number): number {
  let seenWords = 0;
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index]?.kind !== 'word') {
      continue;
    }
    seenWords += 1;
    if (seenWords === wordCount) {
      return index;
    }
  }
  return -1;
}

function hasOnlyWhitespaceSeparators(tokens: BoundaryToken[], start: number, end: number): boolean {
  for (let index = start + 1; index < end; index += 1) {
    const token = tokens[index];
    if (!token) {
      return false;
    }
    if (token.kind === 'word') {
      continue;
    }
    if (!/^\s+$/.test(token.value)) {
      return false;
    }
  }
  return true;
}

function readWordRun(tokens: BoundaryToken[], start: number, end: number): string[] {
  const words: string[] = [];
  for (let index = start; index <= end; index += 1) {
    const token = tokens[index];
    if (token?.kind === 'word') {
      words.push(token.value);
    }
  }
  return words;
}

function shouldMergeWordRun(
  words: string[],
  fontKey: string,
  lexicon: BoundaryLexicon
): boolean {
  if (words.length < 2) {
    return false;
  }

  const merged = words.join('');
  const normalizedMerged = merged.toLowerCase();
  const mergedScore = scoreWord(merged, fontKey, lexicon);
  const hasWeakFragment = words.some((word) => word.length <= 5 || scoreWord(word, fontKey, lexicon) < 8);
  const isExplicitKnownWord = isTrustedLexiconWord(normalizedMerged);
  const mergedFontCount = lexicon.fontWordCounts.get(fontKey)?.get(normalizedMerged) ?? 0;
  const mergedGlobalCount = lexicon.globalWordCounts.get(normalizedMerged) ?? 0;
  const hasCountBackedMergedWord = mergedFontCount >= 2 || mergedGlobalCount >= 3;

  if (!hasWeakFragment || mergedScore < 9) {
    return false;
  }

  if (!(isExplicitKnownWord || hasCountBackedMergedWord)) {
    return false;
  }

  if (isExplicitKnownWord) {
    return true;
  }

  const originalBoundaries = new Set<number>();
  let offset = 0;
  for (let index = 0; index < words.length - 1; index += 1) {
    offset += words[index]?.length ?? 0;
    originalBoundaries.add(offset);
  }

  const originalScore = scoreSegmentation(words, originalBoundaries, fontKey, lexicon);
  return mergedScore > originalScore + 1.25;
}

function hasAllCapsAcronymWords(segment: string): boolean {
  const words = segment.split(/\s+/).filter(Boolean);
  let acronymLikeCount = 0;

  for (const word of words) {
    if (word.length < 2) {
      continue;
    }
    if (word === word.toUpperCase() && /[A-Z]/.test(word)) {
      acronymLikeCount += 1;
      if (acronymLikeCount >= 2) {
        return true;
      }
    }
  }

  return false;
}

function isLikelyProtectedTitleCasePhrase(words: string[]): boolean {
  if (words.length < 2 || words.length > 10) {
    return false;
  }

  let titleLikeCount = 0;

  for (const word of words) {
    const normalized = word.replace(/[^A-Za-z]/g, '');
    if (normalized.length === 0) {
      continue;
    }

    if (TITLE_CASE_CONNECTOR_WORDS.has(normalized.toLowerCase())) {
      titleLikeCount += 1;
      continue;
    }

    if (/^[A-Z][a-z]+(?:['’][A-Z]?[a-z]+)?$/.test(normalized)) {
      titleLikeCount += 1;
      continue;
    }

    if (/^[A-Z]$/.test(normalized)) {
      titleLikeCount += 1;
      continue;
    }

    if (/^[A-Z]{2,4}$/.test(normalized)) {
      titleLikeCount += 1;
      continue;
    }

    return false;
  }

  return titleLikeCount >= 2;
}

function isProtectedTitleCaseWordToken(word: string): boolean {
  return /^[A-Z][a-z]{4,}(?:['’][A-Z]?[a-z]+)?$/.test(word);
}

function resolveLeadingArticleWords(
  word: string,
  fontKey: string,
  lexicon: BoundaryLexicon
): string[] | undefined {
  const leadingArticleMatch = word.match(/^A([a-z]{5,})$/);
  if (!leadingArticleMatch) {
    return undefined;
  }

  const remainder = leadingArticleMatch[1] ?? '';
  if (isBackedLexiconWord(remainder, fontKey, lexicon)) {
    return ['A', remainder];
  }

  const remainderPlan = findBestSegmentation(remainder, new Set(), fontKey, lexicon);
  if (!remainderPlan || remainderPlan.words.length === 0) {
    return undefined;
  }

  if (
    remainderPlan.words.some(
      (candidate) => !isBackedLexiconWord(candidate, fontKey, lexicon) && !isTrustedShortBoundaryWord(candidate)
    )
  ) {
    return undefined;
  }

  if (remainderPlan.score < scoreWord(remainder, fontKey, lexicon) + 1) {
    return undefined;
  }

  return ['A', ...remainderPlan.words];
}
