import { describe, expect, it } from 'vitest'
import { DefaultSearchQueryPlanner } from '../../../src/search/search-subagent-tool.js'

describe('DefaultSearchQueryPlanner', () => {
  it('sets news queries to require freshness when freshness is not specified', () => {
    // Given: a news query without an explicit freshness flag
    const planner = new DefaultSearchQueryPlanner()

    // When: the planner builds the query plan
    const plan = planner.plan({ originalQuestion: 'latest AI regulation updates', intent: 'news' })

    // Then: the query is freshness-aware and keeps news intent terms
    expect(plan.requiresFreshness).toBe(true)
    expect(plan.searchQuery.toLowerCase()).toContain('latest')
    expect(plan.searchQuery.toLowerCase()).toContain('news')
  })

  it('flags missing location when weather intent lacks a location', () => {
    // Given: a weather query without a city, region, or locale
    const planner = new DefaultSearchQueryPlanner()

    // When: the planner builds the query plan
    const plan = planner.plan({ originalQuestion: 'what is the weather today', intent: 'weather' })

    // Then: the query remains single-search but records missing critical context
    expect(plan.requiresFreshness).toBe(true)
    expect(plan.missingCriticalContext).toContain('location')
  })

  it('adds product comparison terms for product intent', () => {
    // Given: a product-search query
    const planner = new DefaultSearchQueryPlanner()

    // When: the planner builds the query plan
    const plan = planner.plan({ originalQuestion: 'best laptops for programming', intent: 'product' })

    // Then: the single query includes comparison-oriented product terms
    expect(plan.searchQuery.toLowerCase()).toContain('review')
    expect(plan.searchQuery.toLowerCase()).toContain('comparison')
  })

  it('does not duplicate documentation terms for technical queries', () => {
    // Given: a technical query that already asks for documentation
    const planner = new DefaultSearchQueryPlanner()

    // When: the planner builds the query plan
    const plan = planner.plan({ originalQuestion: 'React useEffect documentation', intent: 'technical' })

    // Then: documentation appears once while official-source intent is retained
    const documentationMatches = plan.searchQuery.toLowerCase().match(/documentation/g) ?? []
    expect(documentationMatches).toHaveLength(1)
    expect(plan.searchQuery.toLowerCase()).toContain('official')
  })

  it('flags missing location for local searches without local context', () => {
    // Given: a local query without location details
    const planner = new DefaultSearchQueryPlanner()

    // When: the planner builds the query plan
    const plan = planner.plan({ originalQuestion: 'restaurants open now', intent: 'local' })

    // Then: missing context is visible to downstream evidence consumers
    expect(plan.missingCriticalContext).toContain('location')
  })
})
