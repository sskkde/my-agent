import type {
  LongTermMemoryStore,
  LongTermMemoryRecord,
  MemoryEntity,
  MemoryScope,
  MemoryType,
  Sensitivity,
} from '../storage/long-term-memory-store.js'

export type RecallQuery = {
  userId: string
  query?: string
  limit?: number
  memoryTypes?: MemoryType[]
  filters?: MetadataFilters
  vector?: VectorRecallPlaceholder
}

export type MetadataFilters = {
  memoryTypes?: MemoryType[]
  sensitivity?: Sensitivity[]
  entityNames?: string[]
  entityTypes?: MemoryEntity['entityType'][]
  scope?: Partial<MemoryScope>
  keywords?: string[]
  minConfidence?: number
}

export type VectorRecallPlaceholder = {
  enabled: boolean
  embeddingRef?: string
}

export type RecallMemoryResult = LongTermMemoryRecord & {
  source: 'long_term'
}

export type RecallResult = {
  memories: RecallMemoryResult[]
  total: number
}

const IMPORTANCE_ORDER: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

export interface LongTermMemoryRecallService {
  recall(query: RecallQuery): Promise<RecallResult>
  recall(userId: string, query?: string, options?: Omit<RecallQuery, 'userId' | 'query'>): Promise<RecallMemoryResult[]>
  recallByMetadata(
    userId: string,
    filters: MetadataFilters,
    options?: { limit?: number },
  ): Promise<RecallMemoryResult[]>
}

class LongTermMemoryRecallServiceImpl implements LongTermMemoryRecallService {
  private store: LongTermMemoryStore

  constructor(store: LongTermMemoryStore) {
    this.store = store
  }

  async recall(query: RecallQuery): Promise<RecallResult>
  async recall(
    userId: string,
    query?: string,
    options?: Omit<RecallQuery, 'userId' | 'query'>,
  ): Promise<RecallMemoryResult[]>
  async recall(
    queryOrUserId: RecallQuery | string,
    searchText?: string,
    options: Omit<RecallQuery, 'userId' | 'query'> = {},
  ): Promise<RecallResult | RecallMemoryResult[]> {
    const query =
      typeof queryOrUserId === 'string' ? { ...options, userId: queryOrUserId, query: searchText } : queryOrUserId
    const result = this.recallInternal(query)

    if (typeof queryOrUserId === 'string') {
      return result.memories
    }

    return result
  }

  async recallByMetadata(
    userId: string,
    filters: MetadataFilters,
    options: { limit?: number } = {},
  ): Promise<RecallMemoryResult[]> {
    return this.recallInternal({ userId, filters, limit: options.limit }).memories
  }

  private recallInternal(query: RecallQuery): RecallResult {
    const { userId, query: searchQuery, limit = 10, memoryTypes, filters } = query

    const allMemories = this.store.getByUserId(userId)

    const filtered = allMemories.filter((mem) => {
      if (mem.lifecycle.status !== 'active' && mem.lifecycle.status !== 'low_priority') {
        return false
      }

      if (mem.scope.visibility !== 'private_user') {
        return false
      }

      const typeFilters = memoryTypes ?? filters?.memoryTypes
      if (typeFilters && typeFilters.length > 0 && !typeFilters.includes(mem.memoryType)) {
        return false
      }

      return matchesMetadataFilters(mem, filters)
    })

    const withLexicalMatch = filtered.map((mem) => {
      let hasLexicalMatch = true
      let relevanceScore = 0

      if (searchQuery) {
        relevanceScore = scoreKeywordAndMetadataMatch(mem, searchQuery)
        hasLexicalMatch = relevanceScore > 0
      }

      return { ...mem, hasLexicalMatch, relevanceScore }
    })

    const matchingOnly = withLexicalMatch.filter((mem) => mem.hasLexicalMatch)

    const sorted = rerankMemories(matchingOnly).sort((a, b) => {
      if (searchQuery && a.hasLexicalMatch !== b.hasLexicalMatch) {
        return b.hasLexicalMatch ? 1 : -1
      }

      if (a.relevanceScore !== b.relevanceScore) {
        return b.relevanceScore - a.relevanceScore
      }

      const importanceA = IMPORTANCE_ORDER[a.importance] ?? 0
      const importanceB = IMPORTANCE_ORDER[b.importance] ?? 0
      if (importanceA !== importanceB) {
        return importanceB - importanceA
      }

      if (a.confidence !== b.confidence) {
        return b.confidence - a.confidence
      }

      const dateA = new Date(a.lifecycle.updatedAt).getTime()
      const dateB = new Date(b.lifecycle.updatedAt).getTime()
      return dateB - dateA
    })

    const limited = sorted.slice(0, limit)

    for (const mem of limited) {
      const current = this.store.getByMemoryId(mem.memoryId)
      if (current) {
        this.store.applyPatch(mem.memoryId, {
          retrieval: {
            ...current.retrieval,
            recallCount: current.retrieval.recallCount + 1,
            lastRecalledAt: new Date().toISOString(),
          },
        })
      }
    }

    const resultMemories: RecallMemoryResult[] = limited.map((mem) => ({
      ...mem,
      source: 'long_term' as const,
    }))

    return {
      memories: resultMemories,
      total: matchingOnly.length,
    }
  }
}

function matchesMetadataFilters(mem: LongTermMemoryRecord, filters?: MetadataFilters): boolean {
  if (!filters) return true

  if (filters.sensitivity && !filters.sensitivity.includes(mem.sensitivity)) return false
  if (filters.minConfidence !== undefined && mem.confidence < filters.minConfidence) return false

  if (filters.scope) {
    if (filters.scope.visibility && mem.scope.visibility !== filters.scope.visibility) return false
    if (filters.scope.projectId && mem.scope.projectId !== filters.scope.projectId) return false
    if (filters.scope.workflowId && mem.scope.workflowId !== filters.scope.workflowId) return false
    if (filters.scope.connector && mem.scope.connector !== filters.scope.connector) return false
  }

  if (filters.keywords && filters.keywords.length > 0) {
    const memoryKeywords = mem.retrieval.keywords.map((kw) => kw.toLowerCase())
    const hasKeyword = filters.keywords.some((keyword) => memoryKeywords.includes(keyword.toLowerCase()))
    if (!hasKeyword) return false
  }

  if (filters.entityNames && filters.entityNames.length > 0) {
    const names = (mem.entities ?? []).map((entity) => entity.displayName.toLowerCase())
    const hasName = filters.entityNames.some((name) => names.includes(name.toLowerCase()))
    if (!hasName) return false
  }

  if (filters.entityTypes && filters.entityTypes.length > 0) {
    const hasType = (mem.entities ?? []).some((entity) => filters.entityTypes?.includes(entity.entityType))
    if (!hasType) return false
  }

  return true
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter(Boolean)
}

function scoreKeywordAndMetadataMatch(mem: LongTermMemoryRecord, query: string): number {
  const queryLower = query.toLowerCase()
  const tokens = tokenize(query)
  const content = mem.content.text.toLowerCase()
  const keywords = mem.retrieval.keywords.map((keyword) => keyword.toLowerCase())
  const entityNames = (mem.entities ?? []).map((entity) => entity.displayName.toLowerCase())

  let score = 0
  if (content.includes(queryLower)) score += 4
  if (keywords.some((keyword) => keyword.includes(queryLower) || queryLower.includes(keyword))) score += 5
  if (entityNames.some((name) => name.includes(queryLower) || queryLower.includes(name))) score += 3

  for (const token of tokens) {
    if (content.includes(token)) score += 1
    if (keywords.some((keyword) => keyword.includes(token))) score += 2
    if (entityNames.some((name) => name.includes(token))) score += 1
  }

  return score
}

function rerankMemories<T extends LongTermMemoryRecord & { relevanceScore: number; hasLexicalMatch: boolean }>(
  memories: T[],
): T[] {
  return [...memories].sort((a, b) => {
    const relevance = b.relevanceScore - a.relevanceScore
    if (relevance !== 0) return relevance
    const confidence = b.confidence - a.confidence
    if (confidence !== 0) return confidence
    return IMPORTANCE_ORDER[b.importance] - IMPORTANCE_ORDER[a.importance]
  })
}

export function createLongTermMemoryRecallService(store: LongTermMemoryStore): LongTermMemoryRecallService {
  return new LongTermMemoryRecallServiceImpl(store)
}
