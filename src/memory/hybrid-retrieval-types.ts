import type { LongTermMemoryRecord, MemoryType } from '../storage/long-term-memory-store.js'
import type { MetadataFilters } from './long-term-memory-recall.js'

/**
 * Supported retrieval strategy types.
 * - lexical: keyword-based search via existing recall service
 * - vector: embedding-based semantic search (NoOp placeholder for now)
 * - hybrid: combines multiple strategies with dedup and fallback
 */
export type RetrievalStrategyType = 'lexical' | 'vector' | 'hybrid'

/**
 * Unified recall query for hybrid retrieval.
 * Extends the concept of RecallQuery with strategy-specific fields.
 */
export interface HybridRecallQuery {
  userId: string
  query?: string
  limit?: number
  memoryTypes?: MemoryType[]
  filters?: MetadataFilters
  /** Which strategy to use; defaults to 'hybrid' when used via HybridRetrievalOrchestrator */
  strategyType?: RetrievalStrategyType
  /** If results < minResults, trigger fallback to next strategy */
  minResults?: number
  /** Filter by entity name — uses entity index when HYBRID_RETRIEVAL_ENABLED is true */
  entityNames?: string[]
  /** Filter by date range start (ISO 8601) — uses time index when HYBRID_RETRIEVAL_ENABLED is true */
  startDate?: string
  /** Filter by date range end (ISO 8601) — uses time index when HYBRID_RETRIEVAL_ENABLED is true */
  endDate?: string
}

/**
 * A single recalled memory item with unified metadata across strategies.
 */
export interface HybridRecallItem {
  memory: LongTermMemoryRecord
  source: RetrievalStrategyType
  /** Normalized relevance score 0–1 */
  relevanceScore: number
  /** Unique fingerprint for dedup (from record.fingerprint or record.memoryId) */
  fingerprint: string
}

/**
 * Unified recall result from any strategy or orchestrator.
 */
export interface HybridRecallResult {
  items: HybridRecallItem[]
  total: number
  sources: RetrievalStrategyType[]
}
