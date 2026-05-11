import type { PlannerRunStore } from '../storage/planner-run-store.js';
import type { ApprovalStore } from '../storage/approval-store.js';
import type { PlanStore } from '../storage/plan-store.js';
import type { EventStore } from '../storage/event-store.js';
import type { SummaryStore } from '../storage/summary-store.js';
import type { BackgroundRunStore, BackgroundRun } from '../storage/background-run-store.js';
import type { WorkflowRunStore, WorkflowRun } from '../storage/workflow-run-store.js';
import type { PlannerState, BackgroundSubagentState, WorkflowRunState } from '../shared/states.js';
import {
  PLANNER_STATES,
  BACKGROUND_SUBAGENT_STATES,
  WORKFLOW_RUN_STATES,
} from '../shared/states.js';
import type {
  ActiveWorkProjection,
  ProjectionSource,
  ProjectionCache,
  PartialActiveWorkProjection,
} from './types.js';

const DEFAULT_CACHE_TTL_MS = 5000;

const TERMINAL_PLANNER_STATES: PlannerState[] = [
  PLANNER_STATES.COMPLETED,
  PLANNER_STATES.FAILED,
  PLANNER_STATES.CANCELLED,
  PLANNER_STATES.ARCHIVED,
];

const TERMINAL_BACKGROUND_STATES: BackgroundSubagentState[] = [
  BACKGROUND_SUBAGENT_STATES.COMPLETED,
  BACKGROUND_SUBAGENT_STATES.FAILED,
  BACKGROUND_SUBAGENT_STATES.CANCELLED,
  BACKGROUND_SUBAGENT_STATES.EXPIRED,
];

const TERMINAL_WORKFLOW_STATES: WorkflowRunState[] = [
  WORKFLOW_RUN_STATES.COMPLETED,
  WORKFLOW_RUN_STATES.FAILED,
  WORKFLOW_RUN_STATES.CANCELLED,
  WORKFLOW_RUN_STATES.TIMEOUT,
];

export interface ActiveWorkProjectionBuilderOptions {
  defaultTtlMs?: number;
}

export interface BuildProjectionOptions {
  includeTerminal?: boolean;
  ttlMs?: number;
}

export interface StoreDependencies {
  plannerRunStore: PlannerRunStore;
  approvalStore: ApprovalStore;
  planStore: PlanStore;
  eventStore: EventStore;
  summaryStore: SummaryStore;
  backgroundRunStore: BackgroundRunStore;
  workflowRunStore: WorkflowRunStore;
}

export interface ActiveWorkProjectionBuilder {
  buildProjection(userId: string, options?: BuildProjectionOptions): Promise<ActiveWorkProjection>;
  getCachedProjection(userId: string): ProjectionCache | null;
  invalidateCache(userId: string): void;
  registerSource(source: ProjectionSource): void;
  unregisterSource(sourceName: string): void;
}

class ActiveWorkProjectionBuilderImpl implements ActiveWorkProjectionBuilder {
  private stores: StoreDependencies;
  private cache: Map<string, ProjectionCache> = new Map();
  private sources: Map<string, ProjectionSource> = new Map();
  private defaultTtlMs: number;

  constructor(stores: StoreDependencies, options: ActiveWorkProjectionBuilderOptions = {}) {
    this.stores = stores;
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_CACHE_TTL_MS;

    this.registerBuiltInSources();
  }

  private registerBuiltInSources(): void {
    // Register PlannerRun source
    this.registerSource({
      name: 'planner_run_source',
      getActiveWork: async (userId: string): Promise<PartialActiveWorkProjection> => {
        const runs = this.stores.plannerRunStore.findByUser(userId);
        return { activePlannerRuns: runs };
      },
    });

    // Register Approval source
    this.registerSource({
      name: 'approval_source',
      getActiveWork: async (userId: string): Promise<PartialActiveWorkProjection> => {
        const approvals = this.stores.approvalStore.findPendingByUser(userId);
        return { pendingApprovals: approvals };
      },
    });

    // Register BackgroundRun source - queries all active (non-terminal) background runs
    this.registerSource({
      name: 'background_run_source',
      getActiveWork: async (userId: string): Promise<PartialActiveWorkProjection> => {
        const activeRuns = this.getActiveBackgroundRuns(userId);
        return { activeBackgroundRuns: activeRuns };
      },
    });

    // Register WorkflowRun source - queries all active (non-terminal) workflow runs
    this.registerSource({
      name: 'workflow_run_source',
      getActiveWork: async (userId: string): Promise<PartialActiveWorkProjection> => {
        const activeRuns = this.getActiveWorkflowRuns(userId);
        return { activeWorkflowRuns: activeRuns };
      },
    });

    // Register Plan source (for additional plan context)
    this.registerSource({
      name: 'plan_source',
      getActiveWork: async (): Promise<PartialActiveWorkProjection> => {
        return {};
      },
    });

    // Register Event source (for event context)
    this.registerSource({
      name: 'event_source',
      getActiveWork: async (): Promise<PartialActiveWorkProjection> => {
        return {};
      },
    });

    // Register SessionMemory source (for memory context)
    this.registerSource({
      name: 'session_memory_source',
      getActiveWork: async (): Promise<PartialActiveWorkProjection> => {
        return {};
      },
    });
  }

  /**
   * Get all active (non-terminal) background runs for a user.
   * Queries each non-terminal status individually and combines results.
   */
  private getActiveBackgroundRuns(userId: string): Array<{ runId: string; status: string; startedAt: string; objective?: string }> {
    const allStatuses = Object.values(BACKGROUND_SUBAGENT_STATES) as BackgroundSubagentState[];
    const activeStatuses = allStatuses.filter(
      status => !TERMINAL_BACKGROUND_STATES.includes(status)
    );

    const runs: BackgroundRun[] = [];
    for (const status of activeStatuses) {
      const statusRuns = this.stores.backgroundRunStore.getByUserAndStatus(userId, status);
      runs.push(...statusRuns);
    }

    // Deduplicate by backgroundRunId (in case same run appears in multiple queries)
    const seen = new Set<string>();
    const uniqueRuns = runs.filter(run => {
      if (seen.has(run.backgroundRunId)) {
        return false;
      }
      seen.add(run.backgroundRunId);
      return true;
    });

    return uniqueRuns.map(run => ({
      runId: run.backgroundRunId,
      status: run.status,
      startedAt: run.startedAt ?? run.createdAt ?? new Date().toISOString(),
      objective: run.agentType,
    }));
  }

  /**
   * Get all active (non-terminal) workflow runs for a user.
   * Queries each non-terminal status individually and combines results.
   */
  private getActiveWorkflowRuns(userId: string): Array<{ runId: string; status: string; startedAt: string; objective?: string }> {
    const allStatuses = Object.values(WORKFLOW_RUN_STATES) as WorkflowRunState[];
    const activeStatuses = allStatuses.filter(
      status => !TERMINAL_WORKFLOW_STATES.includes(status)
    );

    const runs: WorkflowRun[] = [];
    for (const status of activeStatuses) {
      const statusRuns = this.stores.workflowRunStore.getWorkflowRunsByOwnerAndStatus(userId, status);
      runs.push(...statusRuns);
    }

    // Deduplicate by workflowRunId (in case same run appears in multiple queries)
    const seen = new Set<string>();
    const uniqueRuns = runs.filter(run => {
      if (seen.has(run.workflowRunId)) {
        return false;
      }
      seen.add(run.workflowRunId);
      return true;
    });

    return uniqueRuns.map(run => ({
      runId: run.workflowRunId,
      status: run.status,
      startedAt: run.startedAt ?? run.createdAt ?? new Date().toISOString(),
      objective: run.workflowId,
    }));
  }

  async buildProjection(
    userId: string,
    options: BuildProjectionOptions = {}
  ): Promise<ActiveWorkProjection> {
    const includeTerminal = options.includeTerminal ?? false;

    const partialResults = await Promise.all(
      Array.from(this.sources.values()).map(source =>
        source.getActiveWork(userId).catch(error => {
          console.error(`Source ${source.name} failed:`, error);
          return {} as PartialActiveWorkProjection;
        })
      )
    );

    const merged = this.mergePartialResults(partialResults);

    const activePlannerRuns = includeTerminal
      ? merged.activePlannerRuns ?? []
      : (merged.activePlannerRuns ?? []).filter(
          run => !TERMINAL_PLANNER_STATES.includes(run.status)
        );

    const projection: ActiveWorkProjection = {
      activePlannerRuns,
      pendingApprovals: merged.pendingApprovals ?? [],
      activeBackgroundRuns: merged.activeBackgroundRuns ?? [],
      activeWorkflowRuns: merged.activeWorkflowRuns ?? [],
      lastUpdated: new Date().toISOString(),
    };

    const cacheTtl = options.ttlMs ?? this.defaultTtlMs;
    this.cache.set(userId, {
      projection,
      timestamp: projection.lastUpdated,
      ttlMs: cacheTtl,
    });

    return projection;
  }

  private mergePartialResults(
    partials: PartialActiveWorkProjection[]
  ): PartialActiveWorkProjection {
    return partials.reduce(
      (acc, partial) => ({
        activePlannerRuns: partial.activePlannerRuns
          ? [...(acc.activePlannerRuns ?? []), ...partial.activePlannerRuns]
          : acc.activePlannerRuns,
        pendingApprovals: partial.pendingApprovals
          ? [...(acc.pendingApprovals ?? []), ...partial.pendingApprovals]
          : acc.pendingApprovals,
        activeBackgroundRuns: partial.activeBackgroundRuns
          ? [...(acc.activeBackgroundRuns ?? []), ...partial.activeBackgroundRuns]
          : acc.activeBackgroundRuns,
        activeWorkflowRuns: partial.activeWorkflowRuns
          ? [...(acc.activeWorkflowRuns ?? []), ...partial.activeWorkflowRuns]
          : acc.activeWorkflowRuns,
      }),
      {} as PartialActiveWorkProjection
    );
  }

  getCachedProjection(userId: string): ProjectionCache | null {
    const cached = this.cache.get(userId);

    if (!cached) {
      return null;
    }

    const now = Date.now();
    const cacheTime = new Date(cached.timestamp).getTime();

    if (now - cacheTime > cached.ttlMs) {
      this.cache.delete(userId);
      return null;
    }

    return cached;
  }

  invalidateCache(userId: string): void {
    this.cache.delete(userId);
  }

  registerSource(source: ProjectionSource): void {
    this.sources.set(source.name, source);
  }

  unregisterSource(sourceName: string): void {
    this.sources.delete(sourceName);
  }
}

export function createActiveWorkProjectionBuilder(
  stores: StoreDependencies,
  options?: ActiveWorkProjectionBuilderOptions
): ActiveWorkProjectionBuilder {
  return new ActiveWorkProjectionBuilderImpl(stores, options);
}
