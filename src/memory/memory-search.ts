import type { SummaryStore, SourceRefs, SummaryType, SummaryStatus } from '../storage/summary-store.js'
import type { MemorySearchOptions, MemorySearchResult } from './types.js'

export type { MemorySearch } from './types.js'

type MemorySearchType = {
  search(options: MemorySearchOptions): MemorySearchResult[]
  searchByKeywords(keywords: string[], limit?: number): MemorySearchResult[]
  getBySourceRefs(sourceRefs: SourceRefs): MemorySearchResult[]
}

export function createMemorySearch(summaryStore: SummaryStore): MemorySearchType {
  return {
    search,
    searchByKeywords,
    getBySourceRefs,
  }

  function search(options: MemorySearchOptions): MemorySearchResult[] {
    const allSummaries = summaryStore
      .getByType('working_summary')
      .concat(summaryStore.getByType('session_memory'))
      .concat(summaryStore.getByType('rolling_5_turns'))
      .concat(summaryStore.getByType('rolling_10_turns'))

    let results = allSummaries.map((record) => ({
      record,
      score: 0,
      matchedKeywords: [] as string[],
    }))

    if (options.userId) {
      results = results.filter((r) => r.record.userId === options.userId)
    }

    if (options.sessionId) {
      results = results.filter((r) => r.record.sessionId === options.sessionId)
    }

    if (options.summaryTypes && options.summaryTypes.length > 0) {
      results = results.filter((r) => options.summaryTypes!.includes(r.record.summaryType as SummaryType))
    }

    if (options.statuses && options.statuses.length > 0) {
      results = results.filter((r) => options.statuses!.includes(r.record.status as SummaryStatus))
    }

    if (options.importance) {
      results = results.filter((r) => r.record.retrieval?.importance === options.importance)
    }

    if (options.keywords && options.keywords.length > 0) {
      results = results.map((r) => {
        const searchText = [
          r.record.summary,
          ...(r.record.retrieval?.keywords || []),
          JSON.stringify(r.record.structuredState || {}),
        ]
          .join(' ')
          .toLowerCase()

        let score = 0
        const matched: string[] = []

        for (const keyword of options.keywords!) {
          const lowerKeyword = keyword.toLowerCase()
          const count = (searchText.match(new RegExp(lowerKeyword, 'g')) || []).length

          if (count > 0) {
            score += count
            matched.push(keyword)
          }
        }

        return {
          ...r,
          score,
          matchedKeywords: matched,
        }
      })

      results = results.filter((r) => r.score > 0)
    }

    results.sort((a, b) => b.score - a.score)

    const offset = options.offset || 0
    const limit = options.limit || 100
    const paginatedResults = results.slice(offset, offset + limit)

    return paginatedResults.map((r) => ({
      summary: r.record,
      sourceRefs: r.record.sourceRefs,
      relevanceScore: r.score,
      matchedKeywords: r.matchedKeywords,
    }))
  }

  function searchByKeywords(keywords: string[], limit: number = 100): MemorySearchResult[] {
    return search({
      keywords,
      limit,
    })
  }

  function getBySourceRefs(sourceRefs: SourceRefs): MemorySearchResult[] {
    const allSummaries = summaryStore
      .getByType('working_summary')
      .concat(summaryStore.getByType('session_memory'))
      .concat(summaryStore.getByType('rolling_5_turns'))
      .concat(summaryStore.getByType('rolling_10_turns'))

    const results: MemorySearchResult[] = []

    for (const record of allSummaries) {
      if (matchesSourceRefs(record.sourceRefs, sourceRefs)) {
        results.push({
          summary: record,
          sourceRefs: record.sourceRefs,
          relevanceScore: 1,
          matchedKeywords: [],
        })
      }
    }

    return results
  }

  function matchesSourceRefs(recordSourceRefs: SourceRefs, searchSourceRefs: SourceRefs): boolean {
    if (searchSourceRefs.transcriptRefs && searchSourceRefs.transcriptRefs.length > 0) {
      const recordRefs = recordSourceRefs.transcriptRefs || []
      const hasMatch = searchSourceRefs.transcriptRefs.some((ref) => recordRefs.includes(ref))
      if (hasMatch) return true
    }

    if (searchSourceRefs.eventRange) {
      const recordRange = recordSourceRefs.eventRange
      if (recordRange) {
        const searchStart = searchSourceRefs.eventRange.startEventId
        const searchEnd = searchSourceRefs.eventRange.endEventId

        if (recordRange.startEventId === searchStart && recordRange.endEventId === searchEnd) {
          return true
        }
      }
    }

    if (searchSourceRefs.previousSummaryRefs && searchSourceRefs.previousSummaryRefs.length > 0) {
      const recordRefs = recordSourceRefs.previousSummaryRefs || []
      const hasMatch = searchSourceRefs.previousSummaryRefs.some((ref) => recordRefs.includes(ref))
      if (hasMatch) return true
    }

    return false
  }
}
