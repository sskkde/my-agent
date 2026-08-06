/**
 * Unicode-safe query dedup primitives for multi-round search.
 *
 * Pure functions only: no mutable module state, no I/O. Callers keep their own
 * seen-query history and pass it to isDuplicateQuery on every check.
 */

/** A query string reduced to canonical NFKC comparison form. */
export type NormalizedQuery = string

export type QueryMatchResult =
  | { kind: 'exact'; matched: NormalizedQuery }
  | { kind: 'similar'; matched: NormalizedQuery; similarity: number }
  | { kind: 'unique' }

export const DEFAULT_QUERY_SIMILARITY_THRESHOLD = 0.8

const CJK_CODE_POINT_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

function isCJKCodePoint(codePoint: string): boolean {
  return CJK_CODE_POINT_RE.test(codePoint)
}

/**
 * Reduce a raw query to its canonical comparison form:
 * NFKC (full-width compatibility) first, then lowercase, punctuation to spaces,
 * whitespace collapse, and trim.
 */
export function normalizeQuery(value: string): NormalizedQuery {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function exactQueryEqual(left: NormalizedQuery, right: NormalizedQuery): boolean {
  return left === right
}

/**
 * Latin-script word tokens: maximal runs of letters/numbers, split on CJK
 * characters and separators. CJK code points act as word boundaries so mixed
 * queries tokenize cleanly.
 */
export function latinWordTokens(canonical: NormalizedQuery): readonly string[] {
  const words: string[] = []
  let current = ''

  for (const codePoint of canonical) {
    if (isCJKCodePoint(codePoint)) {
      if (current.length > 0) {
        words.push(current)
        current = ''
      }
    } else if (/[\p{L}\p{N}]/u.test(codePoint)) {
      current += codePoint
    } else if (current.length > 0) {
      words.push(current)
      current = ''
    }
  }
  if (current.length > 0) {
    words.push(current)
  }

  return [...new Set(words)]
}

/**
 * CJK tokenization: bigrams over the CJK code points in order. Non-CJK
 * characters (spaces, punctuation, Latin words) are skipped, so inserting a
 * space between CJK characters does not split a bigram pair. Lone CJK
 * characters produce no bigrams, so single-character queries fall back to exact
 * comparison in compareQueries.
 */
export function cjkBigramTokens(canonical: NormalizedQuery): readonly string[] {
  const cjkCodePoints = Array.from(canonical).filter(isCJKCodePoint)
  const bigrams: string[] = []

  for (let index = 0; index + 1 < cjkCodePoints.length; index++) {
    bigrams.push(cjkCodePoints[index] + cjkCodePoints[index + 1])
  }

  return [...new Set(bigrams)]
}

/** Combined token set: Latin words plus CJK code-point bigrams. */
export function queryTokenSet(canonical: NormalizedQuery): ReadonlySet<string> {
  return new Set([...latinWordTokens(canonical), ...cjkBigramTokens(canonical)])
}

/** |A∩B|/|A∪B|; returns 0 (never NaN) when both sets are empty. */
export function jaccardSimilarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  const union = new Set(left)
  for (const item of right) {
    union.add(item)
  }
  if (union.size === 0) {
    return 0
  }

  let intersectionSize = 0
  for (const item of left) {
    if (right.has(item)) {
      intersectionSize++
    }
  }
  return intersectionSize / union.size
}

/**
 * Compare one normalized query against another. Exact canonical equality wins
 * outright; otherwise token similarity must reach the threshold. Empty token
 * sets fall back to the exact comparison so similarity is never NaN.
 */
export function compareQueries(
  left: NormalizedQuery,
  right: NormalizedQuery,
  threshold = DEFAULT_QUERY_SIMILARITY_THRESHOLD,
): QueryMatchResult {
  if (left === right) {
    return { kind: 'exact', matched: right }
  }

  const leftTokens = queryTokenSet(left)
  const rightTokens = queryTokenSet(right)
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return { kind: 'unique' }
  }

  const similarity = jaccardSimilarity(leftTokens, rightTokens)
  if (similarity >= threshold) {
    return { kind: 'similar', matched: right, similarity }
  }
  return { kind: 'unique' }
}

/**
 * Check a raw candidate against a list of seen raw queries. First match wins in
 * stable seen order; an empty seen list always yields unique.
 */
export function isDuplicateQuery(
  candidate: string,
  seen: readonly string[],
  threshold = DEFAULT_QUERY_SIMILARITY_THRESHOLD,
): QueryMatchResult {
  const normalizedCandidate = normalizeQuery(candidate)
  for (const prior of seen) {
    const result = compareQueries(normalizedCandidate, normalizeQuery(prior), threshold)
    if (result.kind !== 'unique') {
      return result
    }
  }
  return { kind: 'unique' }
}
