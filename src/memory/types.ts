/**
 * Memory System Types
 *
 * Types for WorkingSummary, SessionMemory, and related memory management.
 */

import type { SummaryRecord, SummaryType, SummaryStatus, SourceRefs, RelatedRefs, RetrievalMetadata } from '../storage/summary-store.js';

// ============================================================================
// Working Summary Types
// ============================================================================

/**
 * Request to generate a working summary from transcript references
 */
export type WorkingSummaryRequest = {
  /** Unique identifier for the summary */
  summaryId: string;
  /** User identifier */
  userId: string;
  /** Run identifier this summary belongs to */
  runId: string;
  /** Session identifier (optional) */
  sessionId?: string;
  /** References to source transcripts/events */
  sourceRefs: SourceRefs;
  /** Related references for linking */
  relatedRefs?: RelatedRefs;
  /** Current turn count for rolling policy evaluation */
  currentTurnCount: number;
  /** Optional structured state to include */
  structuredState?: Record<string, unknown>;
};

/**
 * Generated working summary with metadata
 */
export type WorkingSummary = {
  /** Unique identifier */
  summaryId: string;
  /** Type is always working_summary */
  summaryType: 'working_summary';
  /** User identifier */
  userId: string;
  /** Run identifier */
  runId: string;
  /** Session identifier (if applicable) */
  sessionId?: string;
  /** Related references */
  relatedRefs?: RelatedRefs;
  /** References to source transcripts/events */
  sourceRefs: SourceRefs;
  /** The generated summary text */
  summary: string;
  /** Structured state extracted from the summary */
  structuredState?: Record<string, unknown>;
  /** Current status */
  status: SummaryStatus;
  /** Retrieval metadata for search */
  retrieval?: RetrievalMetadata;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt?: string;
};

// ============================================================================
// Session Memory Types
// ============================================================================

/**
 * Session memory patch - only fields that can be modified
 *
 * System-owned deterministic fields are excluded from patching:
 * - sessionId, userId, summaryId (identity)
 * - createdAt, sourceRefs (provenance)
 */
export type SessionMemoryPatch = {
  /** Updated summary text (user/llm provided) */
  summary?: string;
  /** Updated structured state (user/llm provided) */
  structuredState?: Record<string, unknown>;
  /** Updated retrieval metadata */
  retrieval?: RetrievalMetadata;
  /** Status transition */
  status?: SummaryStatus;
  /** Related references update */
  relatedRefs?: RelatedRefs;
};

/**
 * Session memory record
 */
export type SessionMemory = {
  /** Unique identifier */
  summaryId: string;
  /** Type is always session_memory */
  summaryType: 'session_memory';
  /** User identifier (system-owned, immutable) */
  userId: string;
  /** Session identifier (system-owned, immutable) */
  sessionId: string;
  /** Related references */
  relatedRefs?: RelatedRefs;
  /** References to source transcripts/events (system-owned, immutable) */
  sourceRefs: SourceRefs;
  /** The session summary text */
  summary: string;
  /** Structured state for the session */
  structuredState?: Record<string, unknown>;
  /** Current status */
  status: SummaryStatus;
  /** Retrieval metadata for search */
  retrieval?: RetrievalMetadata;
  /** Creation timestamp (system-owned, immutable) */
  createdAt: string;
  /** Last update timestamp */
  updatedAt?: string;
};

// ============================================================================
// Rolling Summary Policy Types
// ============================================================================

/**
 * Configuration for rolling summary triggers
 */
export type RollingSummaryConfig = {
  /** Maximum turns before triggering a rolling summary */
  maxTurns: number;
  /** Whether to trigger on topic shifts */
  enableTopicShiftTrigger: boolean;
  /** Minimum confidence threshold for topic shift detection (0-1) */
  topicShiftThreshold: number;
};

/**
 * Context for evaluating rolling summary triggers
 */
export type RollingSummaryContext = {
  /** Current turn count in the session */
  currentTurnCount: number;
  /** Previous turn count when last summary was generated */
  lastSummaryTurnCount: number;
  /** Recent transcript content for topic analysis */
  recentTranscriptSegments: string[];
  /** Current topic keywords */
  currentTopicKeywords: string[];
  /** Previous topic keywords */
  previousTopicKeywords: string[];
};

/**
 * Result of rolling summary policy evaluation
 */
export type RollingSummaryDecision = {
  /** Whether a rolling summary should be triggered */
  shouldTrigger: boolean;
  /** Reason for the decision */
  reason: 'max_turns_reached' | 'topic_shift_detected' | 'no_trigger';
  /** Confidence score for topic shift (if applicable) */
  topicShiftConfidence?: number;
  /** Recommended summary type based on trigger */
  recommendedType: SummaryType | null;
};

// ============================================================================
// Memory Search Types
// ============================================================================

/**
 * Search options for memory retrieval
 */
export type MemorySearchOptions = {
  /** Keywords to search for */
  keywords?: string[];
  /** Session ID to limit search */
  sessionId?: string;
  /** User ID to limit search */
  userId?: string;
  /** Summary types to include */
  summaryTypes?: SummaryType[];
  /** Status values to include */
  statuses?: SummaryStatus[];
  /** Maximum results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Importance filter */
  importance?: 'low' | 'medium' | 'high';
};

/**
 * Search result containing the summary and its source references
 */
export type MemorySearchResult = {
  /** The matching summary record */
  summary: SummaryRecord;
  /** Source references for provenance */
  sourceRefs: SourceRefs;
  /** Relevance score (higher is better) */
  relevanceScore: number;
  /** Which keywords matched */
  matchedKeywords: string[];
};

// ============================================================================
// Manager Interface Types
// ============================================================================

/**
 * Summary manager interface for working summary operations
 */
export interface SummaryManager {
  /**
   * Generate a working summary from transcript references
   */
  generateWorkingSummary(request: WorkingSummaryRequest): WorkingSummary;

  /**
   * Check if source references are valid
   */
  validateSourceRefs(sourceRefs: SourceRefs): boolean;
}

/**
 * Session memory manager interface
 */
export interface SessionMemoryManager {
  /**
   * Patch session memory while preserving system-owned fields
   */
  patchSessionMemory(
    sessionId: string,
    patch: SessionMemoryPatch
  ): SessionMemory;

  /**
   * Get current session memory
   */
  getSessionMemory(sessionId: string): SessionMemory | null;

  /**
   * Create initial session memory
   */
  createSessionMemory(
    sessionId: string,
    userId: string,
    sourceRefs: SourceRefs
  ): SessionMemory;
}

/**
 * Rolling summary policy evaluator
 */
export interface RollingSummaryPolicy {
  /**
   * Evaluate whether a rolling summary should be triggered
   */
  shouldTrigger(
    context: RollingSummaryContext,
    config: RollingSummaryConfig
  ): RollingSummaryDecision;

  /**
   * Get default configuration
   */
  getDefaultConfig(): RollingSummaryConfig;
}

/**
 * Memory search interface
 */
export interface MemorySearch {
  /**
   * Search for memories using keyword and metadata filters
   */
  search(options: MemorySearchOptions): MemorySearchResult[];

  /**
   * Search by keywords only
   */
  searchByKeywords(keywords: string[], limit?: number): MemorySearchResult[];

  /**
   * Get memories by source references
   */
  getBySourceRefs(sourceRefs: SourceRefs): MemorySearchResult[];
}
