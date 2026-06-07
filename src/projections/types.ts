import type { PlannerRunRecord } from '../storage/planner-run-store.js'
import type { ApprovalRequest } from '../storage/approval-store.js'

/**
 * Represents a background run entry in the active work projection.
 */
export interface BackgroundRunEntry {
  runId: string
  status: string
  startedAt: string
  objective?: string
}

/**
 * Represents a workflow run entry in the active work projection.
 */
export interface WorkflowRunEntry {
  runId: string
  status: string
  startedAt: string
  objective?: string
}

/**
 * Aggregated view of all active work for a user.
 * This is a read-only projection, NOT the authority for runtime state.
 */
export interface ActiveWorkProjection {
  /** Active planner runs (non-terminal states) */
  activePlannerRuns: PlannerRunRecord[]
  /** Pending approval requests */
  pendingApprovals: ApprovalRequest[]
  /** Active background runs */
  activeBackgroundRuns: BackgroundRunEntry[]
  /** Active workflow runs */
  activeWorkflowRuns: WorkflowRunEntry[]
  /** ISO timestamp when projection was built */
  lastUpdated: string
}

/**
 * Partial active work data returned by a single source.
 */
export type PartialActiveWorkProjection = Partial<ActiveWorkProjection>

/**
 * Interface for sources that can contribute to the active work projection.
 */
export interface ProjectionSource {
  /** Unique name identifying this source */
  name: string
  /**
   * Get active work data for a specific user.
   * @param userId The user ID to query
   * @returns Promise resolving to partial projection data
   */
  getActiveWork(userId: string): Promise<PartialActiveWorkProjection>
}

/**
 * Cache entry for a projection.
 */
export interface ProjectionCache {
  /** The cached projection */
  projection: ActiveWorkProjection
  /** ISO timestamp when cache was created */
  timestamp: string
  /** TTL in milliseconds */
  ttlMs: number
}

/**
 * Stub interface for background run source (Task 30).
 * To be fully implemented in Task 30.
 */
export interface BackgroundRunSource extends ProjectionSource {
  name: 'background_run_source'
}

/**
 * Stub interface for workflow run source (Task 35).
 * To be fully implemented in Task 35.
 */
export interface WorkflowRunSource extends ProjectionSource {
  name: 'workflow_run_source'
}

/**
 * Options for building projections.
 */
export interface ProjectionBuildOptions {
  /** Whether to include terminal (completed/cancelled) runs */
  includeTerminal?: boolean
  /** Custom TTL for this projection (overrides default) */
  ttlMs?: number
}
