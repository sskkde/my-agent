/**
 * Memory System Types
 *
 * Types for WorkingSummary, SessionMemory, and related memory management.
 */

import type {
  SummaryRecord,
  SummaryType,
  SummaryStatus,
  SourceRefs,
  RelatedRefs,
  RetrievalMetadata,
} from '../storage/summary-store.js'
import type { PlannerStatePatch } from '../planner/types.js'

// ============================================================================
// Working Summary Types
// ============================================================================

/**
 * Request to generate a working summary from transcript references
 */
export type WorkingSummaryRequest = {
  /** Unique identifier for the summary */
  summaryId: string
  /** User identifier */
  userId: string
  /** Run identifier this summary belongs to */
  runId: string
  /** Session identifier (optional) */
  sessionId?: string
  /** References to source transcripts/events */
  sourceRefs: SourceRefs
  /** Related references for linking */
  relatedRefs?: RelatedRefs
  /** Current turn count for rolling policy evaluation */
  currentTurnCount: number
  /** Optional structured state to include */
  structuredState?: Record<string, unknown>
}

/**
 * Generated working summary with metadata
 */
export type WorkingSummary = {
  /** Unique identifier */
  summaryId: string
  /** Type is always working_summary */
  summaryType: 'working_summary'
  /** User identifier */
  userId: string
  /** Run identifier */
  runId: string
  /** Session identifier (if applicable) */
  sessionId?: string
  /** Related references */
  relatedRefs?: RelatedRefs
  /** References to source transcripts/events */
  sourceRefs: SourceRefs
  /** The generated summary text */
  summary: string
  /** Structured state extracted from the summary */
  structuredState?: Record<string, unknown>
  /** Current status */
  status: SummaryStatus
  /** Retrieval metadata for search */
  retrieval?: RetrievalMetadata
  /** Creation timestamp */
  createdAt: string
  /** Last update timestamp */
  updatedAt?: string
}

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
  summary?: string
  /** Updated structured state (user/llm provided) */
  structuredState?: Record<string, unknown>
  /** Updated retrieval metadata */
  retrieval?: RetrievalMetadata
  /** Status transition */
  status?: SummaryStatus
  /** Related references update */
  relatedRefs?: RelatedRefs
}

/**
 * Session memory record
 */
export type SessionMemory = {
  /** Unique identifier */
  summaryId: string
  /** Type is always session_memory */
  summaryType: 'session_memory'
  /** User identifier (system-owned, immutable) */
  userId: string
  /** Session identifier (system-owned, immutable) */
  sessionId: string
  /** Related references */
  relatedRefs?: RelatedRefs
  /** References to source transcripts/events (system-owned, immutable) */
  sourceRefs: SourceRefs
  /** The session summary text */
  summary: string
  /** Structured state for the session */
  structuredState?: Record<string, unknown>
  /** Current status */
  status: SummaryStatus
  /** Retrieval metadata for search */
  retrieval?: RetrievalMetadata
  /** Creation timestamp (system-owned, immutable) */
  createdAt: string
  /** Last update timestamp */
  updatedAt?: string
}

// ============================================================================
// Rolling Summary Policy Types
// ============================================================================

/**
 * Configuration for rolling summary triggers
 */
export type RollingSummaryConfig = {
  /** Maximum turns before triggering a rolling summary */
  maxTurns: number
  /** Whether to trigger on topic shifts */
  enableTopicShiftTrigger: boolean
  /** Minimum confidence threshold for topic shift detection (0-1) */
  topicShiftThreshold: number
  /** Minimum turns between summaries to prevent too-frequent triggers (default: 3) */
  minTurnsBetweenSummaries?: number
  /** Token pressure threshold (0-1) for triggering summary */
  maxTokenPressure?: number
}

/**
 * Context for evaluating rolling summary triggers
 */
export type RollingSummaryContext = {
  /** Current turn count in the session */
  currentTurnCount: number
  /** Previous turn count when last summary was generated */
  lastSummaryTurnCount: number
  /** Recent transcript content for topic analysis */
  recentTranscriptSegments: string[]
  /** Current topic keywords */
  currentTopicKeywords: string[]
  /** Previous topic keywords */
  previousTopicKeywords: string[]
  /** The turn number of the last summary */
  lastSummaryTurn?: number
  /** Current token pressure (0-1) */
  currentTokenPressure?: number
}

/**
 * Result of rolling summary policy evaluation
 */
export type RollingSummaryDecision = {
  /** Whether a rolling summary should be triggered */
  shouldTrigger: boolean
  /** Reason for the decision */
  reason:
    | 'max_turns_reached'
    | 'topic_shift_detected'
    | 'plan_update_detected'
    | 'token_pressure_triggered'
    | 'no_trigger'
  /** Confidence score for topic shift (if applicable) */
  topicShiftConfidence?: number
  /** Recommended summary type based on trigger */
  recommendedType: SummaryType | null
}

// ============================================================================
// Memory Search Types
// ============================================================================

/**
 * Search options for memory retrieval
 */
export type MemorySearchOptions = {
  /** Keywords to search for */
  keywords?: string[]
  /** Session ID to limit search */
  sessionId?: string
  /** User ID to limit search */
  userId?: string
  /** Summary types to include */
  summaryTypes?: SummaryType[]
  /** Status values to include */
  statuses?: SummaryStatus[]
  /** Maximum results to return */
  limit?: number
  /** Offset for pagination */
  offset?: number
  /** Importance filter */
  importance?: 'low' | 'medium' | 'high'
}

/**
 * Search result containing the summary and its source references
 */
export type MemorySearchResult = {
  /** The matching summary record */
  summary: SummaryRecord
  /** Source references for provenance */
  sourceRefs: SourceRefs
  /** Relevance score (higher is better) */
  relevanceScore: number
  /** Which keywords matched */
  matchedKeywords: string[]
}

// ============================================================================
// Write Control Types
// ============================================================================

/**
 * Error codes for summary write operations
 */
export type SummaryWriteErrorCode =
  | 'MISSING_SOURCE_REFS'
  | 'INVALID_SCHEMA'
  | 'DETERMINISTIC_FIELD_VIOLATION'
  | 'NOT_FOUND'

/**
 * Result of a summary write operation
 */
export type SummaryWriteResult<T> =
  | { success: true; data: T; version: number }
  | { success: false; code: SummaryWriteErrorCode; message: string }

/**
 * Summary version history entry
 */
export type SummaryVersionEntry = {
  version: number
  summaryId: string
  summaryType: SummaryType
  changedFields: string[]
  previousValues: Record<string, unknown>
  sourceRefs: SourceRefs
  createdAt: string
  createdBy: 'llm' | 'system'
}

/**
 * Write options for summary operations
 */
export type SummaryWriteOptions = {
  /** Source references - REQUIRED for all writes */
  sourceRefs: SourceRefs
  /** Whether this is an LLM-generated write (triggers deterministic field protection) */
  isLlmGenerated?: boolean
  /** Confidence level for the write */
  confidence?: 'low' | 'medium' | 'high'
}

/**
 * Summary content that can be written (LLM-provided fields only)
 */
export type SummaryContent = {
  /** The summary text */
  summary: string
  /** Structured state extracted from the summary */
  structuredState?: Record<string, unknown>
  /** Retrieval metadata for search */
  retrieval?: RetrievalMetadata
}

/**
 * Rolling summary content
 */
export type RollingSummaryContent = SummaryContent & {
  /** Turn range covered by this summary */
  turnRange: {
    startTurn: number
    endTurn: number
  }
}

/**
 * Workflow run summary content
 */
export type WorkflowRunSummaryContent = SummaryContent & {
  /** Workflow run status */
  workflowStatus: string
  /** Step completion summary */
  stepSummary?: Record<string, unknown>
}

/**
 * Background subagent summary content
 */
export type BackgroundSubagentSummaryContent = SummaryContent & {
  /** @deprecated Use agentProfile instead. Kept for backward compatibility. */
  subagentType?: string
  /** Agent profile identifier (e.g., 'memory', 'search', 'document_processor') */
  agentProfile: string
  /** Output contract schema identifier (e.g., 'output:memory-candidate.schema') */
  outputContract?: string
  /** Task description */
  taskDescription?: string
}

/**
 * Compact summary content
 */
export type CompactSummaryContent = SummaryContent & {
  /** Original summary IDs that were compacted */
  compactedSummaryIds: string[]
  /** Compression ratio */
  compressionRatio: number
}

/**
 * Weekly summary content
 */
export type WeeklySummaryContent = SummaryContent & {
  /** Week range covered by this summary */
  weekRange: {
    startDate: string
    endDate: string
  }
}

/**
 * Planner run summary content
 */
export type PlannerRunSummaryContent = SummaryContent & {
  /** Planner run ID */
  plannerRunId: string
  /** Planner run status */
  planStatus: string
  /** Step completion summary */
  stepSummary?: Record<string, unknown>
}

// ============================================================================
// Manager Interface Types
// ============================================================================

/**
 * Summary manager interface for all summary write operations
 *
 * All write methods enforce source-bound controls:
 * - sourceRefs is REQUIRED (non-empty)
 * - Deterministic fields are protected from LLM overwrites
 * - Invalid schemas trigger low-confidence fallback
 * - Versioning tracks all changes
 */
export interface SummaryManager {
  /**
   * Generate a working summary from transcript references
   */
  generateWorkingSummary(request: WorkingSummaryRequest): WorkingSummary

  /**
   * Check if source references are valid
   */
  validateSourceRefs(sourceRefs: SourceRefs): boolean

  // =========================================================================
  // Source-bound Write Methods
  // =========================================================================

  /**
   * Write working summary with source-bound controls
   * @throws Error with code MISSING_SOURCE_REFS if sourceRefs is empty
   */
  writeWorkingSummary(
    sessionId: string,
    runId: string,
    userId: string,
    content: SummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<WorkingSummary>>

  /**
   * Write session memory with source-bound controls
   */
  writeSessionMemory(
    sessionId: string,
    userId: string,
    content: SummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SessionMemory>>

  /**
   * Write rolling summary with source-bound controls
   */
  writeRollingSummary(
    sessionId: string,
    userId: string,
    summaryType: 'rolling_5_turns' | 'rolling_10_turns',
    content: RollingSummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SummaryRecord>>

  /**
   * Write daily summary with source-bound controls
   */
  writeDailySummary(
    userId: string,
    content: SummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SummaryRecord>>

  /**
   * Write weekly summary with source-bound controls
   */
  writeWeeklySummary(
    userId: string,
    content: WeeklySummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SummaryRecord>>

  /**
   * Write workflow run summary with source-bound controls
   */
  writeWorkflowRunSummary(
    workflowRunId: string,
    userId: string,
    content: WorkflowRunSummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SummaryRecord>>

  /**
   * Write background subagent summary with source-bound controls
   */
  writeBackgroundSubagentSummary(
    backgroundRunId: string,
    userId: string,
    content: BackgroundSubagentSummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SummaryRecord>>

  /**
   * Write compact summary with source-bound controls
   */
  writeCompactSummary(
    sessionId: string,
    userId: string,
    content: CompactSummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SummaryRecord>>

  /**
   * Write planner run summary with source-bound controls
   */
  writePlannerRunSummary(
    userId: string,
    content: PlannerRunSummaryContent,
    options: SummaryWriteOptions,
  ): Promise<SummaryWriteResult<SummaryRecord>>

  // =========================================================================
  // Versioning and History
  // =========================================================================

  /**
   * Get version history for a summary
   */
  getVersionHistory(summaryId: string, limit?: number): SummaryVersionEntry[]

  /**
   * Get current version number for a summary
   */
  getCurrentVersion(summaryId: string): number

  // =========================================================================
  // Low-confidence Fallback
  // =========================================================================

  /**
   * Store a low-confidence fallback summary (for invalid schemas)
   */
  storeLowConfidenceFallback(
    summaryType: SummaryType,
    userId: string,
    rawContent: unknown,
    validationErrors: string[],
    options: SummaryWriteOptions,
  ): SummaryRecord
}

/**
 * Session memory manager interface
 */
export interface SessionMemoryManager {
  /**
   * Patch session memory while preserving system-owned fields
   */
  patchSessionMemory(sessionId: string, patch: SessionMemoryPatch): SessionMemory

  /**
   * Get current session memory
   */
  getSessionMemory(sessionId: string): SessionMemory | null

  /**
   * Create initial session memory
   */
  createSessionMemory(sessionId: string, userId: string, sourceRefs: SourceRefs): SessionMemory

  /**
   * Apply a planner state patch to session memory
   */
  applyPlannerStatePatch(sessionId: string, patch: PlannerStatePatch): SessionMemory
}

/**
 * Rolling summary policy evaluator
 */
export interface RollingSummaryPolicy {
  /**
   * Evaluate whether a rolling summary should be triggered
   */
  shouldTrigger(context: RollingSummaryContext, config: RollingSummaryConfig): RollingSummaryDecision

  /**
   * Get default configuration
   */
  getDefaultConfig(): RollingSummaryConfig
}

/**
 * Memory search interface
 */
export interface MemorySearch {
  /**
   * Search for memories using keyword and metadata filters
   */
  search(options: MemorySearchOptions): MemorySearchResult[]

  /**
   * Search by keywords only
   */
  searchByKeywords(keywords: string[], limit?: number): MemorySearchResult[]

  /**
   * Get memories by source references
   */
  getBySourceRefs(sourceRefs: SourceRefs): MemorySearchResult[]
}
