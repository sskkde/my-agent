import type { PlannerRunStore } from '../storage/planner-run-store.js';
import type { ApprovalStore } from '../storage/approval-store.js';
import type { PlanStore } from '../storage/plan-store.js';
import type { EventStore } from '../storage/event-store.js';
import type { SummaryStore } from '../storage/summary-store.js';
import type { PlannerState } from '../shared/states.js';
import {
  PLANNER_STATES,
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

    // Register stub sources for BackgroundRun and WorkflowRun (Tasks 30/35)
    this.registerSource({
      name: 'background_run_source',
      getActiveWork: async (): Promise<PartialActiveWorkProjection> => {
        return { activeBackgroundRuns: [] };
      },
    });

    this.registerSource({
      name: 'workflow_run_source',
      getActiveWork: async (): Promise<PartialActiveWorkProjection> => {
        return { activeWorkflowRuns: [] };
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
