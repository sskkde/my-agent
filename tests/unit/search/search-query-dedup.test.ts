import { describe, expect, it } from 'vitest'
import {
  cjkBigramTokens,
  compareQueries,
  exactQueryEqual,
  isDuplicateQuery,
  jaccardSimilarity,
  latinWordTokens,
  normalizeQuery,
  queryTokenSet,
} from '../../../src/search/search-query-dedup.js'

describe('normalizeQuery', () => {
  it('applies NFKC normalization so full-width characters become half-width', () => {
    // Given: full-width Latin, digits, and punctuation
    const input = 'ＡＢＣ１２３！？'

    // When: the query is normalized
    const normalized = normalizeQuery(input)

    // Then: NFKC maps full-width forms onto their ASCII equivalents
    // (trailing punctuation collapses into the trimmed canonical form)
    expect(normalized).toBe('abc123')
  })

  it('lowercases, collapses whitespace, and trims the canonical form', () => {
    // Given: mixed-case input with irregular whitespace
    const input = '  Latest   AI  Regulation   '

    // When: the query is normalized
    const normalized = normalizeQuery(input)

    // Then: case, whitespace, and edges are canonicalized
    expect(normalized).toBe('latest ai regulation')
  })

  it('replaces punctuation with spaces in the canonical comparison form', () => {
    // Given: punctuation-separated words
    const input = 'hello, world! how-are you?'

    // When: the query is normalized
    const normalized = normalizeQuery(input)

    // Then: punctuation no longer affects exact comparison
    expect(normalized).toBe('hello world how are you')
  })
})

describe('exactQueryEqual', () => {
  it('returns true for canonically identical queries', () => {
    // Given: two raw queries that differ in full-width, case, and punctuation
    const left = normalizeQuery('ＡＢＣ 测试！')
    const right = normalizeQuery('abc 测试')

    // When: they are compared exactly
    const equal = exactQueryEqual(left, right)

    // Then: both reduce to the same canonical form
    expect(equal).toBe(true)
  })

  it('returns false for canonically different queries', () => {
    // Given: distinct canonical forms
    const left = normalizeQuery('test')
    const right = normalizeQuery('other')

    // When: they are compared exactly
    const equal = exactQueryEqual(left, right)

    // Then: they are not equal
    expect(equal).toBe(false)
  })
})

describe('latinWordTokens', () => {
  it('extracts Unicode word tokens including accented Latin', () => {
    // Given: a canonical form with accented Latin words
    const canonical = normalizeQuery('café crème brûlée')

    // When: Latin tokens are extracted
    const tokens = latinWordTokens(canonical)

    // Then: accented words survive as single tokens
    expect(tokens).toEqual(['café', 'crème', 'brûlée'])
  })

  it('excludes CJK characters from Latin word tokens', () => {
    // Given: a mixed canonical form
    const canonical = normalizeQuery('ChatGPT 使用教程')

    // When: Latin tokens are extracted
    const tokens = latinWordTokens(canonical)

    // Then: only the Latin word is returned
    expect(tokens).toEqual(['chatgpt'])
  })

  it('returns an empty array when no Latin words exist', () => {
    // Given: a CJK-only canonical form
    const canonical = normalizeQuery('测试')

    // When: Latin tokens are extracted
    const tokens = latinWordTokens(canonical)

    // Then: there are no Latin words
    expect(tokens).toEqual([])
  })
})

describe('cjkBigramTokens', () => {
  it('produces adjacent code-point bigrams for CJK input', () => {
    // Given: a multi-character CJK canonical form
    const canonical = normalizeQuery('测试一下')

    // When: CJK bigrams are extracted
    const tokens = cjkBigramTokens(canonical)

    // Then: each adjacent code-point pair is a token
    expect(tokens).toEqual(['测试', '试一', '一下'])
  })

  it('does not pair a CJK character with a non-CJK neighbor', () => {
    // Given: CJK separated by a Latin word
    const canonical = normalizeQuery('a测试b')

    // When: CJK bigrams are extracted
    const tokens = cjkBigramTokens(canonical)

    // Then: only the adjacent CJK pair is produced
    expect(tokens).toEqual(['测试'])
  })

  it('returns an empty array for a single CJK character', () => {
    // Given: a lone CJK character with no adjacent pair
    const canonical = normalizeQuery('测')

    // When: CJK bigrams are extracted
    const tokens = cjkBigramTokens(canonical)

    // Then: no bigram exists
    expect(tokens).toEqual([])
  })
})

describe('queryTokenSet', () => {
  it('combines Latin words and CJK bigrams for mixed input', () => {
    // Given: a mixed CJK/Latin canonical form
    const canonical = normalizeQuery('iPhone 15 评测')

    // When: the combined token set is built
    const tokens = queryTokenSet(canonical)

    // Then: both token kinds are present
    expect(tokens).toEqual(new Set(['iphone', '15', '评测']))
  })

  it('returns an empty set when no tokens can be formed', () => {
    // Given: a punctuation-only canonical form
    const canonical = normalizeQuery('?!')

    // When: the combined token set is built
    const tokens = queryTokenSet(canonical)

    // Then: the set is empty and triggers the exact-comparison fallback
    expect(tokens.size).toBe(0)
  })
})

describe('jaccardSimilarity', () => {
  it('returns the |A∩B|/|A∪B| ratio for overlapping token sets', () => {
    // Given: two overlapping token sets
    const left = new Set(['a', 'b', 'c'])
    const right = new Set(['b', 'c', 'd'])

    // When: Jaccard similarity is computed
    const similarity = jaccardSimilarity(left, right)

    // Then: the ratio is |{b,c}| / |{a,b,c,d}| = 0.5
    expect(similarity).toBe(0.5)
  })

  it('returns 1 for identical token sets', () => {
    // Given: identical token sets
    const left = new Set(['a', 'b'])
    const right = new Set(['a', 'b'])

    // When: Jaccard similarity is computed
    const similarity = jaccardSimilarity(left, right)

    // Then: the sets fully overlap
    expect(similarity).toBe(1)
  })

  it('returns 0 (never NaN) for two empty token sets', () => {
    // Given: two empty token sets
    const empty: ReadonlySet<string> = new Set()

    // When: Jaccard similarity is computed
    const similarity = jaccardSimilarity(empty, empty)

    // Then: the result is finite and not NaN
    expect(Number.isFinite(similarity)).toBe(true)
    expect(similarity).toBe(0)
  })
})

describe('compareQueries', () => {
  it('returns an exact match for canonically identical queries', () => {
    // Given: two queries that differ only in full-width/case/punctuation
    const left = normalizeQuery('ＡＢＣ 测试！')
    const right = normalizeQuery('abc 测试')

    // When: the pair is compared
    const result = compareQueries(left, right)

    // Then: the result is an exact match carrying the seen query
    expect(result).toEqual({ kind: 'exact', matched: 'abc 测试' })
  })

  it('returns a similar match above the threshold with a finite similarity', () => {
    // Given: a near-duplicate Latin pair sharing most tokens
    const left = normalizeQuery('best laptops for programming')
    const right = normalizeQuery('best laptops for programming 2026')

    // When: the pair is compared
    const result = compareQueries(left, right)

    // Then: similarity is finite and at least the default threshold
    if (result.kind === 'similar') {
      expect(result.matched).toBe('best laptops for programming 2026')
      expect(Number.isFinite(result.similarity)).toBe(true)
      expect(result.similarity).toBeGreaterThanOrEqual(0.8)
    } else {
      expect(result.kind).toBe('similar')
    }
  })

  it('respects a caller-supplied threshold', () => {
    // Given: a pair whose overlap passes 0.8 but not 0.9
    const left = normalizeQuery('a b c d e')
    const right = normalizeQuery('a b c d e f')

    // When: compared under both thresholds
    const lenient = compareQueries(left, right, 0.8)
    const strict = compareQueries(left, right, 0.9)

    // Then: only the lenient comparison reports similarity
    expect(lenient.kind).toBe('similar')
    expect(strict.kind).toBe('unique')
  })

  it('falls back to exact comparison and never returns NaN for empty token sets', () => {
    // Given: a lone CJK query (no bigrams) and an empty canonical form
    const lone = normalizeQuery('测')
    const blank = normalizeQuery('')

    // When: empty-token-set pairs are compared
    const loneVsLonger = compareQueries(lone, normalizeQuery('测试'))
    const blankVsWord = compareQueries(blank, normalizeQuery('abc'))

    // Then: they resolve to unique without throwing or yielding NaN
    expect(loneVsLonger.kind).toBe('unique')
    expect(blankVsWord.kind).toBe('unique')
  })

  it('matches identical empty queries exactly', () => {
    // Given: two queries that normalize to the empty string
    const left = normalizeQuery('')
    const right = normalizeQuery('???')

    // When: the pair is compared
    const result = compareQueries(left, right)

    // Then: the empty canonical forms are exactly equal
    expect(result).toEqual({ kind: 'exact', matched: '' })
  })
})

describe('isDuplicateQuery', () => {
  it('identifies an NFKC/full-width/case/punctuation variant of a seen query', () => {
    // Given: a seen query and a heavily restyled candidate
    const seen = ['abc 测试']

    // When: the candidate is checked against the seen list
    const result = isDuplicateQuery('ＡＢＣ 测试！', seen)

    // Then: the candidate resolves to an exact match
    expect(result.kind).toBe('exact')
    if (result.kind === 'exact') {
      expect(result.matched).toBe('abc 测试')
    }
  })

  it('treats punctuation and whitespace variants as duplicates', () => {
    // Given: a seen query and a candidate with extra punctuation/whitespace
    const seen = ['hello world']

    // When: the candidate is checked
    const result = isDuplicateQuery('hello,   world!', seen)

    // Then: the candidate matches exactly
    expect(result.kind).toBe('exact')
  })

  it('reports similar Latin near-duplicates above the threshold', () => {
    // Given: a seen query that is a near-duplicate of the candidate
    const seen = ['best laptops for programming 2026']

    // When: the candidate is checked
    const result = isDuplicateQuery('best laptops for programming', seen)

    // Then: the candidate is reported similar with a finite similarity
    expect(result.kind).toBe('similar')
    if (result.kind === 'similar') {
      expect(Number.isFinite(result.similarity)).toBe(true)
      expect(result.similarity).toBeGreaterThanOrEqual(0.8)
    }
  })

  it('matches CJK queries whose characters are identical after normalization', () => {
    // Given: a seen CJK query and a candidate with a space inserted
    const seen = ['北京天气']

    // When: the candidate is checked
    const result = isDuplicateQuery('北京 天气', seen)

    // Then: the CJK characters are recognized as the same query
    expect(result.kind).not.toBe('unique')
  })

  it('keeps CJK queries with reordered characters unique', () => {
    // Given: a seen query and a reordered CJK candidate
    const seen = ['测试软件']

    // When: the candidate is checked
    const result = isDuplicateQuery('软件测试', seen)

    // Then: bigram overlap is too low to be a duplicate
    expect(result.kind).toBe('unique')
  })

  it('matches mixed CJK/Latin queries that differ only in case and punctuation', () => {
    // Given: a seen mixed query and a full-width/case variant candidate
    const seen = ['ChatGPT 使用教程']

    // When: the candidate is checked
    const result = isDuplicateQuery('ＣＨＡＴＧＰＴ 使用教程！', seen)

    // Then: the mixed query is a duplicate
    expect(result.kind).not.toBe('unique')
  })

  it('returns unique for dissimilar queries', () => {
    // Given: unrelated seen and candidate queries
    const seen = ['foo']

    // When: a dissimilar candidate is checked
    const result = isDuplicateQuery('something completely different', seen)

    // Then: the candidate is unique
    expect(result.kind).toBe('unique')
  })

  it('returns unique (never NaN) for a CJK candidate against Latin seen queries', () => {
    // Given: a Latin-only seen list
    const seen = ['abc']

    // When: a CJK candidate is checked
    const result = isDuplicateQuery('测试', seen)

    // Then: the candidate is unique with no similarity to leak
    expect(result.kind).toBe('unique')
    if (result.kind === 'similar') {
      expect(Number.isFinite(result.similarity)).toBe(true)
    }
  })

  it('returns unique when the seen list is empty', () => {
    // Given: no seen queries
    const seen: readonly string[] = []

    // When: any candidate is checked
    const result = isDuplicateQuery('anything', seen)

    // Then: the candidate is unique
    expect(result.kind).toBe('unique')
  })

  it('never yields NaN for CJK-only and punctuation-only inputs', () => {
    // Given: token-sparse seen and candidate queries
    const seen = ['abc', '测试']

    // When: a lone CJK character is checked
    const result = isDuplicateQuery('测', seen)

    // Then: the result is unique with no similarity to leak
    expect(result.kind).toBe('unique')
    if (result.kind === 'similar') {
      expect(Number.isFinite(result.similarity)).toBe(true)
    }
  })

  it('prefers the first match in stable seen order', () => {
    // Given: a seen list where the candidate matches multiple entries
    const seen = ['abc def', 'ABC DEF']

    // When: the candidate is checked
    const result = isDuplicateQuery('abc def', seen)

    // Then: the earliest matching seen query wins
    expect(result.kind).toBe('exact')
    if (result.kind === 'exact') {
      expect(result.matched).toBe('abc def')
    }
  })

  it('keeps the first similar match when several seen queries match', () => {
    // Given: a seen list with two similar-but-distinct candidates
    const seen = ['a b c d e f', 'a b c d e g']

    // When: the candidate is checked
    const result = isDuplicateQuery('a b c d e', seen)

    // Then: the first seen query is reported
    expect(result.kind).toBe('similar')
    if (result.kind === 'similar') {
      expect(result.matched).toBe('a b c d e f')
    }
  })

  it('honors the threshold passed to the candidate check', () => {
    // Given: a near-duplicate pair below a strict threshold
    const seen = ['a b c d e f']

    // When: checked with a strict threshold
    const result = isDuplicateQuery('a b c d e', seen, 0.9)

    // Then: the candidate is not a duplicate under the strict threshold
    expect(result.kind).toBe('unique')
  })
})
