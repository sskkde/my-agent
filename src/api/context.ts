import { createConnectionManager, type ConnectionManager } from '../storage/connection.js';
import { createMigrationRunner } from '../storage/migrations.js';
import { allStoreMigrations } from '../storage/all-stores-migrations.js';
import { createEventStore, type EventStore, type EventRecord } from '../storage/event-store.js';
import { createRuntimeActionStore, type RuntimeActionStore } from '../storage/runtime-action-store.js';
import { createTranscriptStore, type TranscriptStore } from '../storage/transcript-store.js';
import { createSummaryStore, type SummaryStore } from '../storage/summary-store.js';
import { createApprovalStore, type ApprovalStore } from '../storage/approval-store.js';
import { createPermissionGrantStore, type PermissionGrantStore } from '../storage/permission-grant-store.js';
import { createToolExecutionStore, type ToolExecutionStore } from '../storage/tool-execution-store.js';
import { createPlannerRunStore, type PlannerRunStore } from '../storage/planner-run-store.js';
import { createBackgroundRunStore, type BackgroundRunStore } from '../storage/background-run-store.js';
import { createKernelRunStore, type KernelRunStore } from '../storage/kernel-run-store.js';
import { createSessionStore, type SessionStore } from '../storage/session-store.js';
import { createUserStore, type UserStore } from '../storage/user-store.js';
import { createAuthTokenStore, type AuthTokenStore } from '../storage/auth-token-store.js';
import { createGateway, type Gateway } from '../gateway/gateway.js';
import { createChannelRegistry, createWebUIChannelHandler, type ChannelRegistry } from '../gateway/channel-registry.js';
import { createConsoleTimelineService, type ConsoleTimelineService } from './console-timeline.js';
import { createProviderConfigStore, type ProviderConfigStore } from '../storage/provider-config-store.js';
import { createAgentConfigStore, DEFAULT_REPAIR_ATTEMPTS, DEFAULT_ROUTING_TIMEOUT_MS, type AgentConfigStore } from '../storage/agent-config-store.js';
import { createTimelineBroadcaster, type TimelineBroadcaster } from './timeline-broadcaster.js';
import type { MessageProcessor } from '../processing/types.js';
import { createMessageProcessor as createMessageProcessorImpl } from '../processing/message-processor.js';
import { createOrchestrationProcessor, type ProcessorOrchestrationDeps } from '../processing/processor-orchestration.js';
import { createForegroundAgent, type ForegroundAgent } from '../foreground/foreground-agent.js';
import { createRuntimeDispatcher } from '../dispatcher/runtime-dispatcher.js';
import type { RuntimeDispatcher, RuntimeDispatcherConfig } from '../dispatcher/types.js';
import { createPlannerRuntime, type PlannerRuntime } from '../planner/planner-runtime.js';
import { AgentKernel } from '../kernel/agent-kernel.js';
import type { LLMAdapter } from '../llm/adapter.js';
import { createProviderScopedLLMAdapter, type ProviderScopedLLMAdapter } from '../llm/provider-runtime.js';
import type { Stores } from '../gateway/types.js';
import type { PlanStore } from '../storage/plan-store.js';
import type { AdapterRegistry, TargetRuntime, RuntimeAdapter } from '../dispatcher/types.js';
import { createLongTermMemoryStore, type LongTermMemoryStore } from '../storage/long-term-memory-store.js';
import { createMemoryExtractionRunStore, type MemoryExtractionRunStore } from '../storage/memory-extraction-run-store.js';
import { createLongTermMemoryScheduler, type LongTermMemoryScheduler } from '../memory/long-term-memory-scheduler.js';

export interface ApiContext {
  gateway: Gateway;
  channelRegistry: ChannelRegistry;
  messageProcessor: MessageProcessor;
  foregroundAgent: ForegroundAgent;
  runtimeDispatcher: RuntimeDispatcher;
  plannerRuntime: PlannerRuntime;
  agentKernel: AgentKernel;
  llmAdapter: LLMAdapter;
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
    sessionStore: SessionStore;
    userStore: UserStore;
    authTokenStore: AuthTokenStore;
    longTermMemoryStore: LongTermMemoryStore;
    memoryExtractionRunStore: MemoryExtractionRunStore;
  };
  providerConfigStore: ProviderConfigStore;
  agentConfigStore: AgentConfigStore;
  refreshProvidersForUser: (userId: string) => void;
  runWithProvidersForUser: <T>(userId: string, fn: () => Promise<T>, preferredProviderId?: string) => Promise<T>;
  connection: ConnectionManager;
  consoleTimelineService: ConsoleTimelineService;
  timelineBroadcaster: TimelineBroadcaster;
}

export interface ApiContextOptions {
  dbPath?: string;
  existingConnection?: ConnectionManager;
  existingStores?: Partial<ApiContext['stores']>;
  messageProcessor?: MessageProcessor;
  foregroundAgent?: ForegroundAgent;
  runtimeDispatcher?: RuntimeDispatcher;
  plannerRuntime?: PlannerRuntime;
  agentKernel?: AgentKernel;
  llmAdapter?: LLMAdapter;
  timelineBroadcaster?: TimelineBroadcaster;
  channelRegistry?: ChannelRegistry;
}

export interface ApiContextError {
  code: 'CONNECTION_CLOSED' | 'CONNECTION_FAILED' | 'MIGRATION_FAILED' | 'STORE_INIT_FAILED';
  message: string;
  details?: unknown;
}

/**
 * Simple adapter registry for the runtime dispatcher.
 * Provides a minimal implementation for test-friendly injection.
 */
class SimpleAdapterRegistry implements AdapterRegistry {
  private adapters = new Map<TargetRuntime, RuntimeAdapter>();

  register(runtimeType: TargetRuntime, adapter: RuntimeAdapter): void {
    this.adapters.set(runtimeType, adapter);
  }

  getAdapter(runtimeType: TargetRuntime): RuntimeAdapter | null {
    return this.adapters.get(runtimeType) ?? null;
  }

  unregister(runtimeType: TargetRuntime): void {
    this.adapters.delete(runtimeType);
  }

  listAdapters(): TargetRuntime[] {
    return Array.from(this.adapters.keys());
  }
}

function isProviderScopedLLMAdapter(adapter: LLMAdapter): adapter is ProviderScopedLLMAdapter {
  return 'runWithUserProviders' in adapter;
}

export const MESSAGE_PROCESSOR_TIMEOUT_HEADROOM_MS = 10000;
export const DEFAULT_MESSAGE_PROCESSOR_TIMEOUT_MS =
  DEFAULT_ROUTING_TIMEOUT_MS * (1 + DEFAULT_REPAIR_ATTEMPTS) + MESSAGE_PROCESSOR_TIMEOUT_HEADROOM_MS;

function createOrchestrationMessageProcessor(
  deps: ProcessorOrchestrationDeps
): MessageProcessor {
  const orchestrationFn = createOrchestrationProcessor({ deps });
  return createMessageProcessorImpl({
    timeoutMs: DEFAULT_MESSAGE_PROCESSOR_TIMEOUT_MS,
    processorFn: orchestrationFn,
  });
}

function isConnectionOpen(connection: ConnectionManager): boolean {
  try {
    return connection.isOpen();
  } catch {
    return false;
  }
}

export function createApiContext(options: ApiContextOptions = {}): ApiContext | ApiContextError {
  const {
    dbPath = ':memory:',
    existingConnection,
    existingStores,
    messageProcessor: injectedMessageProcessor,
    foregroundAgent: injectedForegroundAgent,
    runtimeDispatcher: injectedRuntimeDispatcher,
    plannerRuntime: injectedPlannerRuntime,
    agentKernel: injectedAgentKernel,
    llmAdapter: injectedLlmAdapter,
    timelineBroadcaster: injectedTimelineBroadcaster,
    channelRegistry: injectedChannelRegistry,
  } = options;

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
  let sessionStore: SessionStore;
  let userStore: UserStore;
  let authTokenStore: AuthTokenStore;
  let providerConfigStore: ProviderConfigStore;
  let agentConfigStore: AgentConfigStore;
  let longTermMemoryStore: LongTermMemoryStore;
  let memoryExtractionRunStore: MemoryExtractionRunStore;

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
    sessionStore = existingStores?.sessionStore ?? createSessionStore(connection);
    userStore = (existingStores as Record<string, unknown>)?.userStore as UserStore ?? createUserStore(connection);
    authTokenStore = (existingStores as Record<string, unknown>)?.authTokenStore as AuthTokenStore ?? createAuthTokenStore(connection);
    providerConfigStore = (existingStores as Record<string, unknown>)?.providerConfigStore as ProviderConfigStore ?? createProviderConfigStore(connection);
    agentConfigStore = (existingStores as Record<string, unknown>)?.agentConfigStore as AgentConfigStore ?? createAgentConfigStore(connection);
    longTermMemoryStore = (existingStores as Record<string, unknown>)?.longTermMemoryStore as LongTermMemoryStore ?? createLongTermMemoryStore(connection);
    memoryExtractionRunStore = (existingStores as Record<string, unknown>)?.memoryExtractionRunStore as MemoryExtractionRunStore ?? createMemoryExtractionRunStore(connection);
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

  // Create timeline services first (needed by channel handlers)
  const consoleTimelineService = createConsoleTimelineService({
    transcriptStore,
    eventStore,
  });

  // Use injected timeline broadcaster or create default
  const timelineBroadcaster = injectedTimelineBroadcaster ?? createTimelineBroadcaster({
    timelineService: consoleTimelineService,
  });

  // Use injected channel registry or create default
  const channelRegistry = injectedChannelRegistry ?? createChannelRegistry();
  // Only register webui if using default registry (not injected)
  if (!injectedChannelRegistry) {
    channelRegistry.register('webui', createWebUIChannelHandler({
      timelineBroadcaster,
      consoleTimelineService,
    }), {
      type: 'webui',
      status: 'active',
      configured: true,
    });
  }

  // Use injected LLM adapter or create a request-scoped adapter that resolves
  // providers per user without mutating shared server-wide provider state.
  const llmAdapter = injectedLlmAdapter ?? createProviderScopedLLMAdapter({ providerConfigStore });

  const foregroundAgent = injectedForegroundAgent ?? createForegroundAgent({
    llmAdapter,
    agentConfig: agentConfigStore.getByUser('default') ?? undefined,
  });
  const refreshProvidersForUser = (_userId: string): void => {
    // Request-scoped adapters read provider configs on each processing scope.
    // This hook remains for provider CRUD routes and injected adapters.
  };
  const runWithProvidersForUser = async <T>(userId: string, fn: () => Promise<T>, preferredProviderId?: string): Promise<T> => {
    if (!injectedLlmAdapter && isProviderScopedLLMAdapter(llmAdapter)) {
      return llmAdapter.runWithUserProviders(userId, fn, preferredProviderId);
    }

    return fn();
  };

  // Create adapter registry for dispatcher
  const adapterRegistry = new SimpleAdapterRegistry();

  // Use injected runtime dispatcher or create default
  const runtimeDispatcher = injectedRuntimeDispatcher ?? createRuntimeDispatcher({
    actionStore: runtimeActionStore,
    eventStore: {
      append: (event: unknown) => eventStore.append(event as EventRecord | EventRecord[]),
    } as unknown as RuntimeDispatcherConfig['eventStore'],
    adapterRegistry,
  });

  // Use injected planner runtime or create default
  const plannerRuntime = injectedPlannerRuntime ?? createPlannerRuntime({
    planStore: {
      createPlan: () => { throw new Error('PlanStore not implemented'); },
      getPlan: () => { throw new Error('PlanStore not implemented'); },
      applyPatch: () => { throw new Error('PlanStore not implemented'); },
    } as unknown as PlanStore,
    plannerRunStore,
    runtimeActionStore,
    eventStore: {
      append: (event: unknown) => eventStore.append(event as EventRecord | EventRecord[]),
      query: (filters: { sessionId?: string; eventType?: string }) => eventStore.query(filters),
      findByCorrelationId: (correlationId: string) => eventStore.findByCorrelationId?.(correlationId) ?? [],
      findByCausationId: (causationId: string) => eventStore.findByCausationId?.(causationId) ?? [],
      updateUserIdForSession: () => { /* no-op */ },
    } as unknown as EventStore,
  });

  // Use injected agent kernel or create default with safe LLM adapter
  const agentKernel = injectedAgentKernel ?? new AgentKernel({
    llmAdapter,
    toolExecutor: {
      execute: async () => ({
        success: false,
        error: {
          code: 'TOOL_EXECUTION_NOT_CONFIGURED',
          message: 'Tool execution not configured in this context',
          recoverable: false,
        },
      }),
    },
    contextManager: {
        assembleBundle: () => ({
          runId: 'default',
          bundleId: 'default-bundle',
          agentId: 'default-agent',
          agentType: 'main' as const,
          invocationSource: 'system' as const,
          orderedItems: [],
          pinnedItems: [],
          tokenEstimate: 1000,
        }),
      getItems: () => [],
      addItem: () => {},
      applyDelta: () => {},
    },
    dispatcher: runtimeDispatcher as unknown as import('../kernel/types.js').RuntimeDispatcher,
    maxIterations: 10,
    timeoutMs: 30000,
  });

  // Create processing observer that broadcasts status to SSE subscribers
  const processingObserver = {
    emitStatus: (status: import('./types.js').ProcessingStatusPayload) => {
      timelineBroadcaster.broadcastProcessingStatus(status.sessionId, status);
    },
  };

  const memoryExtractionScheduler: LongTermMemoryScheduler | undefined = createLongTermMemoryScheduler({
    transcriptStore,
    summaryStore,
    longTermMemoryStore,
    memoryExtractionRunStore,
    llmAdapter,
  });

  const messageProcessor = injectedMessageProcessor ?? createOrchestrationMessageProcessor({
    gateway,
    stores,
    foregroundAgent,
    runtimeDispatcher,
    plannerRuntime,
    agentKernel,
    llmAdapter,
    transcriptStore,
    eventStore,
    providerConfigStore,
    agentConfigStore,
    sessionStore,
    runWithProvidersForUser,
    processingObserver,
    memoryExtractionScheduler,
  });

  return {
    gateway,
    channelRegistry,
    messageProcessor,
    foregroundAgent,
    runtimeDispatcher,
    plannerRuntime,
    agentKernel,
    llmAdapter,
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
      sessionStore,
      userStore,
      authTokenStore,
      longTermMemoryStore,
      memoryExtractionRunStore,
    },
    providerConfigStore,
    agentConfigStore,
    refreshProvidersForUser,
    runWithProvidersForUser,
    connection,
    consoleTimelineService,
    timelineBroadcaster,
  };
}

export function isApiContextError(value: ApiContext | ApiContextError): value is ApiContextError {
  return 'code' in value && 'message' in value;
}
