import type { PDFTextItem } from '../types.js';

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
  'each', 'either', 'for', 'from', 'given', 'has', 'have', 'how', 'if', 'in',
  'into', 'is', 'it', 'its', 'know', 'let', 'lets', 'measure', 'mean', 'more', 'most',
  'no', 'not', 'of', 'on', 'one', 'only', 'or', 'other', 'our', 'out', 'over',
  'perfectly', 'probable', 'same', 'see', 'selected', 'so', 'some', 'start', 'such', 'than', 'that',
  'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those',
  'therefore', 'through', 'thus', 'to', 'under', 'up', 'use', 'using', 'we',
  'were', 'what', 'when', 'where', 'which', 'while', 'who', 'why', 'with',
  'within', 'without', 'would', 'write', 'you'
]);

const TECHNICAL_WORDS = new Set([
  'algorithm', 'approximation', 'average', 'bayes', 'binary', 'channel',
  'channels', 'character', 'code', 'coding', 'communication', 'complete',
  'conditional', 'content', 'data', 'define', 'defining',
  'describe', 'distribution', 'document', 'efficient', 'english', 'entropy',
  'enumeration', 'exact', 'exercise', 'exercises', 'figure', 'first',
  'formula', 'function', 'fundamental', 'gaussian', 'hardware', 'huffman', 'immediately', 'implicit',
  'independent', 'inference', 'information', 'initial', 'intuitive', 'joint',
  'letter', 'letters', 'likelihood', 'matrix', 'message', 'messages', 'method',
  'methods', 'model', 'models', 'monte', 'natural', 'noisy', 'orbiting', 'page', 'paper',
  'prefix', 'probability', 'random', 'review', 'second', 'source', 'stirling',
  'system', 'telephone', 'theorem', 'variable', 'variables', 'variance',
  'introduction', 'magnetization', 'neighbouring', 'reproducing', 'spacecraft'
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

const MATH_FONT_PATTERN = /(cmex|cmsy|cmmi|line10|msam|msbm|symbol|wasy|stmary)/i;
const MAX_WORD_LENGTH = 28;
const MIN_IMPROVEMENT = 2.5;
const ORIGINAL_BOUNDARY_REWARD = 2.75;
const INSERTED_BOUNDARY_PENALTY = 5.75;

export function refineLexicalTextBoundaries(items: PDFTextItem[]): PDFTextItem[] {
  if (items.length === 0) {
    return [];
  }

  const lexicon = buildLexicon(items);
  let changed = false;

  const refinedItems = items.map((item) => {
    if (!isEligibleTextItem(item)) {
      return item;
    }

    const refinedText = refineItemText(item.text, normalizeFontKey(item.font), lexicon);
    if (refinedText === item.text) {
      return item;
    }

    changed = true;
    return {
      ...item,
      text: refinedText
    };
  });

  return changed ? refinedItems : items.slice();
}

function buildLexicon(items: PDFTextItem[]): BoundaryLexicon {
  const globalWordCounts = new Map<string, number>();
  const fontWordCounts = new Map<string, Map<string, number>>();
  const globalBigramCounts = new Map<string, number>();
  const fontBigramCounts = new Map<string, Map<string, number>>();

  for (const item of items) {
    if (!isEligibleTextItem(item)) {
      continue;
    }

    const fontKey = normalizeFontKey(item.font);
    const fontCounts = getOrCreateWordCounts(fontWordCounts, fontKey);
    const fontBigramEntries = getOrCreateWordCounts(fontBigramCounts, fontKey);
    const words = extractLexiconWords(item.text);

    for (const word of words) {
      incrementCount(globalWordCounts, word);
      incrementCount(fontCounts, word);
    }

    for (let index = 1; index < words.length; index += 1) {
      const previous = words[index - 1];
      const current = words[index];
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

function refineItemText(text: string, fontKey: string, lexicon: BoundaryLexicon): string {
  const dehyphenated = mergeKnownHyphenatedSplits(text, fontKey, lexicon);
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

    refined += refineSegment(dehyphenated.slice(cursor, end), fontKey, lexicon);
    cursor = end;
  }

  return mergeStrongSplitWordRuns(mergeCanonicalShortWordPairs(refined, fontKey, lexicon), fontKey, lexicon);
}

function refineSegment(segment: string, fontKey: string, lexicon: BoundaryLexicon): string {
  const trailingWhitespace = segment.match(/\s+$/)?.[0] ?? '';
  const core = segment.slice(0, segment.length - trailingWhitespace.length);

  if (!core.includes(' ') && core.length < 8) {
    return segment;
  }

  if (hasAllCapsAcronymWords(core)) {
    return segment;
  }

  const collapsed = collapseSegment(core);
  if (collapsed.joined.length < 4) {
    return segment;
  }

  const originalWords = core.split(/\s+/).filter(Boolean);
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
  const dpPlan = findBestSegmentation(collapsed.joined, collapsed.originalBoundaries, fontKey, lexicon);
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

function collapseSegment(segment: string): { joined: string; originalBoundaries: Set<number> } {
  let joined = '';
  let sawWhitespace = false;
  const originalBoundaries = new Set<number>();

  for (const char of segment) {
    if (char === ' ') {
      if (joined.length > 0) {
        sawWhitespace = true;
      }
      continue;
    }

    if (!isAsciiLetter(char)) {
      continue;
    }

    if (sawWhitespace && joined.length > 0) {
      originalBoundaries.add(joined.length);
    }

    joined += char;
    sawWhitespace = false;
  }

  return { joined, originalBoundaries };
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
  const bestAt: Array<BoundaryPlan | undefined> = new Array(joined.length + 1);
  bestAt[0] = { score: 0, words: [] };

  for (let start = 0; start < joined.length; start += 1) {
    const current = bestAt[start];
    if (!current) {
      continue;
    }

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
      const previousBest = bestAt[end];

      if (!previousBest || score > previousBest.score) {
        bestAt[end] = {
          score,
          words: [...current.words, candidate]
        };
      }
    }
  }

  return bestAt[joined.length];
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
      for (const runLength of [4, 3, 2]) {
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

function mergeKnownHyphenatedSplits(
  text: string,
  fontKey: string,
  lexicon: BoundaryLexicon
): string {
  return text.replace(/\b([A-Za-z]{2,})-\s+([A-Za-z]{2,})\b/g, (match, left, right) => {
    const merged = `${left}${right}`;
    return scoreWord(merged, fontKey, lexicon) >= 9 ? merged : match;
  });
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
  const isKnown = isCommon || isTechnical || fontCount > 0 || globalCount > 0;
  const shouldTrustFrequency =
    isCommon ||
    isTechnical ||
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

  if (hasPlausibleWordShape(normalized)) {
    score += 1.25;
  } else {
    score -= 3.5;
  }

  if (!isKnown) {
    score -= normalized.length <= 3 ? 8 : 2.5;
  }

  if (!shouldTrustFrequency) {
    score -= 4.5;
  }

  if (/[aeiouy]{3,}/.test(normalized) || /[^aeiouy]{6,}/.test(normalized)) {
    score -= 1.5;
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
  if ((COMMON_WORDS.has(mergedWord) || TECHNICAL_WORDS.has(mergedWord)) && (previousWord.length <= 3 || nextWord.length <= 3)) {
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

  if (COMMON_WORDS.has(normalized) || TECHNICAL_WORDS.has(normalized)) {
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
  if (!isStrongKnownWord(previousWord, fontKey, lexicon) || !isStrongKnownWord(nextWord, fontKey, lexicon)) {
    return false;
  }

  if (previousWord.length <= 3 || nextWord.length <= 3) {
    return true;
  }

  if (TECHNICAL_WORDS.has(previousWord.toLowerCase()) || TECHNICAL_WORDS.has(nextWord.toLowerCase())) {
    return true;
  }

  return scoreBigram(previousWord, nextWord, fontKey, lexicon) > 0;
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

function tokenizeWordSeparators(text: string): BoundaryToken[] {
  const matches = text.match(/[A-Za-z]+|\s+|[^A-Za-z\s]+/g) ?? [];
  return matches.map((value) => ({
    kind: /^[A-Za-z]+$/.test(value) ? 'word' : 'sep',
    value
  }));
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
  const isExplicitKnownWord = COMMON_WORDS.has(normalizedMerged) || TECHNICAL_WORDS.has(normalizedMerged);

  if (!hasWeakFragment || mergedScore < 9) {
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
