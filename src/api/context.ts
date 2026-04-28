import { createConnectionManager, type ConnectionManager } from '../storage/connection.js';
import { createMigrationRunner } from '../storage/migrations.js';
import { allStoreMigrations } from '../storage/all-stores-migrations.js';
import { createEventStore, type EventStore } from '../storage/event-store.js';
import { createRuntimeActionStore, type RuntimeActionStore } from '../storage/runtime-action-store.js';
import { createTranscriptStore, type TranscriptStore } from '../storage/transcript-store.js';
import { createSummaryStore, type SummaryStore } from '../storage/summary-store.js';
import { createApprovalStore, type ApprovalStore } from '../storage/approval-store.js';
import { createPermissionGrantStore, type PermissionGrantStore } from '../storage/permission-grant-store.js';
import { createToolExecutionStore, type ToolExecutionStore } from '../storage/tool-execution-store.js';
import { createPlannerRunStore, type PlannerRunStore } from '../storage/planner-run-store.js';
import { createBackgroundRunStore, type BackgroundRunStore } from '../storage/background-run-store.js';
import { createKernelRunStore, type KernelRunStore } from '../storage/kernel-run-store.js';
import { createGateway, type Gateway } from '../gateway/gateway.js';
import type { Stores } from '../gateway/types.js';

export interface ApiContext {
  gateway: Gateway;
  stores: {
    eventStore: EventStore;
    runtimeActionStore: RuntimeActionStore;
    transcriptStore: TranscriptStore;
    summaryStore: SummaryStore;
    approvalStore: ApprovalStore;
    permissionGrantStore: PermissionGrantStore;
    toolExecutionStore: ToolExecutionStore;
    plannerRunStore: PlannerRunStore;
    backgroundRunStore: BackgroundRunStore;
    kernelRunStore: KernelRunStore;
  };
  connection: ConnectionManager;
}

export interface ApiContextOptions {
  dbPath?: string;
  existingConnection?: ConnectionManager;
  existingStores?: Partial<ApiContext['stores']>;
}

export interface ApiContextError {
  code: 'CONNECTION_CLOSED' | 'CONNECTION_FAILED' | 'MIGRATION_FAILED' | 'STORE_INIT_FAILED';
  message: string;
  details?: unknown;
}

function isConnectionOpen(connection: ConnectionManager): boolean {
  try {
    return connection.isOpen();
  } catch {
    return false;
  }
}

export function createApiContext(options: ApiContextOptions = {}): ApiContext | ApiContextError {
  const { dbPath = ':memory:', existingConnection, existingStores } = options;

  const connection = existingConnection ?? createConnectionManager(dbPath);

  if (!isConnectionOpen(connection)) {
    try {
      connection.open();
    } catch (error) {
      return {
        code: 'CONNECTION_FAILED',
        message: 'Failed to open database connection',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  let migrationRunner;
  try {
    migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(allStoreMigrations);
  } catch (error) {
    return {
      code: 'MIGRATION_FAILED',
      message: 'Failed to apply database migrations',
      details: error instanceof Error ? error.message : String(error),
    };
  }

  let eventStore: EventStore;
  let runtimeActionStore: RuntimeActionStore;
  let transcriptStore: TranscriptStore;
  let summaryStore: SummaryStore;
  let approvalStore: ApprovalStore;
  let permissionGrantStore: PermissionGrantStore;
  let toolExecutionStore: ToolExecutionStore;
  let plannerRunStore: PlannerRunStore;
  let backgroundRunStore: BackgroundRunStore;
  let kernelRunStore: KernelRunStore;

  try {
    eventStore = existingStores?.eventStore ?? createEventStore(connection);
    runtimeActionStore = existingStores?.runtimeActionStore ?? createRuntimeActionStore(connection);
    transcriptStore = existingStores?.transcriptStore ?? createTranscriptStore(connection);
    summaryStore = existingStores?.summaryStore ?? createSummaryStore(connection);
    approvalStore = existingStores?.approvalStore ?? createApprovalStore(connection);
    permissionGrantStore = existingStores?.permissionGrantStore ?? createPermissionGrantStore(connection);
    toolExecutionStore = existingStores?.toolExecutionStore ?? createToolExecutionStore(connection);
    plannerRunStore = existingStores?.plannerRunStore ?? createPlannerRunStore(connection);
    backgroundRunStore = existingStores?.backgroundRunStore ?? createBackgroundRunStore(connection);
    kernelRunStore = existingStores?.kernelRunStore ?? createKernelRunStore(connection);
  } catch (error) {
    return {
      code: 'STORE_INIT_FAILED',
      message: 'Failed to initialize stores',
      details: error instanceof Error ? error.message : String(error),
    };
  }

  const stores: Stores = {
    eventStore: {
      append: (event: unknown) => eventStore.append(event as Parameters<typeof eventStore.append>[0]),
      query: (filters: { sessionId?: string; eventType?: string }) => eventStore.query(filters) as unknown[],
    },
    summaryStore: {
      getSessionMemory: (sessionId: string) => summaryStore.getSessionMemory(sessionId),
    },
    transcriptStore: {
      findBySession: (sessionId: string) => transcriptStore.findBySession(sessionId),
    },
    runtimeActionStore: {
      findBySessionId: (sessionId: string) => runtimeActionStore.query({ sessionId }) as unknown as Array<{ actionId: string; status: string; targetRef?: Record<string, unknown> }>,
    },
  };

  const gateway = createGateway({ stores });

  return {
    gateway,
    stores: {
      eventStore,
      runtimeActionStore,
      transcriptStore,
      summaryStore,
      approvalStore,
      permissionGrantStore,
      toolExecutionStore,
      plannerRunStore,
      backgroundRunStore,
      kernelRunStore,
    },
    connection,
  };
}

export function isApiContextError(value: ApiContext | ApiContextError): value is ApiContextError {
  return 'code' in value && 'message' in value;
}