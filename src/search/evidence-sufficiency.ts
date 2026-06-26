import type { EvidenceSufficiency, ExtractedFact, SearchQueryPlan, SearchWarning } from './search-subagent-types.js'
import type { WebSearchResultItem } from './types.js'

export function determineEvidenceSufficiency(
  results: readonly WebSearchResultItem[],
  facts: readonly ExtractedFact[],
  warnings: readonly SearchWarning[],
  plan: SearchQueryPlan,
): EvidenceSufficiency {
  if (results.length === 0) {
    return 'insufficient'
  }

  if (facts.length === 0 || plan.missingCriticalContext.length > 0) {
    return 'partial'
  }

  if (warnings.some((warning) => warning.code === 'FRESHNESS_UNVERIFIABLE')) {
    return 'partial'
  }

  return 'sufficient'
}
