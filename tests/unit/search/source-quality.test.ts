import { describe, expect, it } from 'vitest'
import type { SearchQueryPlan } from '../../../src/search/search-subagent-types.js'
import type { WebSearchResultItem } from '../../../src/search/types.js'
import { SOURCE_QUALITY_SCORING_VERSION, scoreSourceQuality } from '../../../src/search/source-quality.js'

function createPlan(overrides: Partial<SearchQueryPlan> = {}): SearchQueryPlan {
  return {
    originalQuestion: 'React useEffect documentation',
    searchQuery: 'React useEffect documentation official',
    intent: 'technical',
    requiresFreshness: false,
    missingCriticalContext: [],
    ...overrides,
  }
}

function createResult(url: string, title = 'React docs', snippet = 'React documentation explains useEffect.'): WebSearchResultItem {
  return { title, url, snippet }
}

describe('source quality scoring', () => {
  it('exposes a stable scoring version', () => {
    // Given/When/Then: source-quality scoring is versioned for evidence metadata
    expect(SOURCE_QUALITY_SCORING_VERSION).toBe('source-quality-v1')
  })

  it('scores official documentation above generic blogs for comparable relevance', () => {
    // Given: two comparable technical results from different source types
    const plan = createPlan()
    const official = createResult('https://react.dev/reference/react/useEffect')
    const blog = createResult('https://random-example-blog.test/react-useeffect')

    // When: source quality is scored
    const officialScore = scoreSourceQuality(official, plan)
    const blogScore = scoreSourceQuality(blog, plan)

    // Then: official documentation wins
    expect(officialScore).toBeGreaterThan(blogScore)
  })

  it('scores GitHub above forums for technical queries', () => {
    // Given: technical results from source code and forum sources
    const plan = createPlan()
    const github = createResult('https://github.com/facebook/react/blob/main/packages/react/index.js')
    const forum = createResult('https://stackoverflow.com/questions/123/react-useeffect')

    // When: source quality is scored
    const githubScore = scoreSourceQuality(github, plan)
    const forumScore = scoreSourceQuality(forum, plan)

    // Then: source-code provenance wins over forum discussion
    expect(githubScore).toBeGreaterThan(forumScore)
  })

  it('boosts dated results for freshness-sensitive plans', () => {
    // Given: two news results where one has an explicit date
    const plan = createPlan({ intent: 'news', requiresFreshness: true })
    const dated = createResult('https://reuters.com/world/ai-news', 'AI News', 'Published on 2026-06-20 with new details.')
    const undated = createResult('https://reuters.com/world/ai-news-older', 'AI News', 'New details were announced.')

    // When: source quality is scored
    const datedScore = scoreSourceQuality(dated, plan)
    const undatedScore = scoreSourceQuality(undated, plan)

    // Then: dated evidence receives a freshness boost
    expect(datedScore).toBeGreaterThan(undatedScore)
  })

  it('handles invalid URLs without throwing', () => {
    // Given: a malformed source URL
    const plan = createPlan()
    const malformed = createResult('not a url', '', '')

    // When/Then: scoring remains deterministic and safe
    expect(() => scoreSourceQuality(malformed, plan)).not.toThrow()
    expect(scoreSourceQuality(malformed, plan)).toBeLessThan(scoreSourceQuality(createResult('https://react.dev'), plan))
  })
})
