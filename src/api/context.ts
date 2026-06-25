import { createConnectionManager, type ConnectionManager } from '../storage/connection.js'
import { createMigrationRunner } from '../storage/migrations.js'
import { allStoreMigrations } from '../storage/all-stores-migrations.js'
import { createEventStore, type EventStore, type EventRecord } from '../storage/event-store.js'
import { createRuntimeActionStore, type RuntimeActionStore } from '../storage/runtime-action-store.js'
import { createTranscriptStore, type TranscriptStore } from '../storage/transcript-store.js'
import { createSummaryStore, type SummaryStore } from '../storage/summary-store.js'
import { createApprovalStore, type ApprovalStore } from '../storage/approval-store.js'
import { createPermissionGrantStore, type PermissionGrantStore } from '../storage/permission-grant-store.js'
import { createToolExecutionStore, type ToolExecutionStore } from '../storage/tool-execution-store.js'
import { createToolResultStore, type ToolResultStore } from '../storage/tool-result-store.js'
import { createPlannerRunStore, type PlannerRunStore } from '../storage/planner-run-store.js'
import { createBackgroundRunStore, type BackgroundRunStore } from '../storage/background-run-store.js'
import { createKernelRunStore, type KernelRunStore } from '../storage/kernel-run-store.js'
import { createSessionStore, type SessionStore } from '../storage/session-store.js'
import { createUserStore, type UserStore } from '../storage/user-store.js'
import { createAuthTokenStore, type AuthTokenStore } from '../storage/auth-token-store.js'
import { createGateway, type Gateway } from '../gateway/gateway.js'
import { createChannelRegistry, createWebUIChannelHandler, type ChannelRegistry } from '../gateway/channel-registry.js'
import { createConsoleTimelineService, type ConsoleTimelineService } from './console-timeline.js'
import { createProviderConfigStore, type ProviderConfigStore } from '../storage/provider-config-store.js'
import {
  createAgentConfigStore,
  DEFAULT_REPAIR_ATTEMPTS,
  DEFAULT_ROUTING_TIMEOUT_MS,
  type AgentConfigStore,
} from '../storage/agent-config-store.js'
import { createTimelineBroadcaster, type TimelineBroadcaster } from './timeline-broadcaster.js'
import type { MessageProcessor } from '../processing/types.js'
import { createMessageProcessor as createMessageProcessorImpl } from '../processing/message-processor.js'
import { createOrchestrationProcessor, type ProcessorOrchestrationDeps } from '../processing/processor-orchestration.js'
import { createForegroundAgent, type ForegroundAgent } from '../foreground/foreground-agent.js'
import { createRuntimeDispatcher } from '../dispatcher/runtime-dispatcher.js'
import type { RuntimeDispatcher, RuntimeDispatcherConfig } from '../dispatcher/types.js'
import { createKernelDispatcherAdapter } from '../kernel/kernel-dispatcher-adapter.js'
import { createPlannerRuntime, type PlannerRuntime } from '../planner/planner-runtime.js'
import { AgentKernel } from '../kernel/agent-kernel.js'
import type { LLMAdapter } from '../llm/adapter.js'
import { createProviderScopedLLMAdapter, type ProviderScopedLLMAdapter } from '../llm/provider-runtime.js'
import { createMockLLMAdapter } from '../llm/mock-adapter.js'
import type { Stores } from '../gateway/types.js'
import { createPlanStore, type PlanStore } from '../storage/plan-store.js'
import { createWaitConditionStore, type WaitConditionStore } from '../storage/wait-condition-store.js'
import { createArtifactStore, type ArtifactStore } from '../storage/artifact-store.js'
import type { AdapterRegistry, TargetRuntime, RuntimeAdapter } from '../dispatcher/types.js'
import { createLongTermMemoryStore, type LongTermMemoryStore } from '../storage/long-term-memory-store.js'
import {
  createMemoryExtractionRunStore,
  type MemoryExtractionRunStore,
} from '../storage/memory-extraction-run-store.js'
import { createLongTermMemoryScheduler, type LongTermMemoryScheduler } from '../memory/long-term-memory-scheduler.js'
import { createWorkflowDraftStore, type WorkflowDraftStore } from '../storage/workflow-draft-store.js'
import { createWorkflowDefinitionStore, type WorkflowDefinitionStore } from '../storage/workflow-definition-store.js'
import { createWorkflowRunStore, type WorkflowRunStore } from '../storage/workflow-run-store.js'
import { createWorkflowRuntime, type WorkflowRuntime } from '../workflows/workflow-runtime.js'
import { createWorkflowDispatcherAdapter } from '../workflows/workflow-dispatcher-adapter.js'
import { createTriggerStore, type TriggerStore } from '../storage/trigger-store.js'
import { createWebhookTriggerStore, type WebhookTriggerStore } from '../storage/webhook-trigger-store.js'
import { createWebhookDeliveryStore, type WebhookDeliveryStore } from '../storage/webhook-delivery-store.js'
import { createScheduleTriggerStore, type ScheduleTriggerStore } from '../storage/schedule-trigger-store.js'
import { createConnectorStore, type ConnectorStore } from '../storage/connector-store.js'
import { createSessionChannelMapStore, type SessionChannelMapStore } from '../storage/session-channel-map-store.js'
import { registerMessagingDefinitions } from '../connectors/messaging/definitions.js'
import { createEventTriggerRuntime, type EventTriggerRuntime } from '../triggers/event-trigger-runtime.js'
import { createPermissionEngine, type PermissionEngine } from '../permissions/permission-engine.js'
import { createAgentTypeToolEnvelopeRegistry } from '../permissions/agent-type-tool-envelope.js'
import { createToolRegistry } from '../tools/tool-registry.js'
import { createToolExecutor } from '../tools/tool-executor.js'
import type { ToolRegistry, ToolExecutor } from '../tools/types.js'
import { registerBuiltInTools } from '../tools/builtins/index.js'
import { registerDefaultRuntimeAdapters } from '../dispatcher/runtime-adapters.js'
import { createBackgroundRuntime } from '../subagents/background-runtime.js'
import { createSubagentRegistry, type SubagentRegistry } from '../subagents/registry.js'
import { registerBuiltInSubagents } from '../subagents/builtin-definitions.js'
import { createDefaultSubagentContextManager } from '../subagents/context-manager.js'
import { createSubagentKernelAdapter } from '../subagents/kernel-adapter.js'
import { createSubagentRuntime } from '../subagents/subagent-runtime.js'
import type { SubagentRuntime } from '../subagents/types.js'
import { createSubagentRunStore, type SubagentRunStore } from '../storage/subagent-run-store.js'
import { createSubagentTranscriptStore, type SubagentTranscriptStore } from '../storage/subagent-transcript-store.js'
import {
  createSubagentProviderPreferenceStore,
  type SubagentProviderPreferenceStore,
} from '../storage/subagent-provider-preference-store.js'
import { createAuditRecorder } from '../observability/audit-recorder.js'
import { createAuditStore } from '../observability/audit-store.js'
import type { AuditRecorder } from '../observability/audit-types.js'
import type { SkillRegistry } from '../skills/types.js'
import { createSkillRegistry } from '../skills/skill-registry.js'
import { registerBuiltinSkills } from '../skills/builtin/manifest.js'
import { createDeadLetterStore, type DeadLetterStore } from '../dead-letter/dead-letter-store.js'
import type { DatabaseAdapter } from '../storage/database-adapter.js'
import { createApiKeyStore, type ApiKeyStore } from '../storage/api-key-store.js'
import { createOrganizationStore, type OrganizationStore } from '../storage/organization-store.js'
import { createTodoStore, type TodoStore } from '../todo/store.js'
import { createFileUploadStore, type FileUploadStore } from '../storage/file-upload-store.js'
import { createUploadFileService, type UploadFileService } from '../storage/upload-file-service.js'
import { createUploadPreviewExtractor, type UploadPreviewExtractor } from '../storage/upload-preview.js'
import { resolveProviderAndModel } from '../llm/agent-provider-resolver.js'
import { ModelInputBuilder } from '../kernel/model-input/model-input-builder.js'
import { resolveProviderFamily } from '../kernel/model-input/model-input-types.js'
import { PromptTemplateRegistry } from '../prompt/prompt-template-registry.js'
import { TemplateLoader } from '../prompt/template-loader.js'
import { createPromptProjectionResolver } from '../prompt/prompt-projection-resolver.js'
import { createModelInputSnapshotStore } from '../kernel/model-input/model-input-snapshot-store.js'
import { createModelInputRedactor } from '../kernel/model-input/model-input-redactor.js'
import { createCloakBrowserProvider, type CloakBrowserProvider } from '../search/browser/cloakbrowser-launcher.js'
import { createSearchSubagent, type SearchSubagent } from '../search/search-subagent.js'
import { executeWebSearch } from '../tools/builtins/web-search.js'
import {
  registerAllForegroundTools,
  DefaultSearchQueryPlanner,
  DefaultSearchResultNormalizer,
} from '../foreground/tools/index.js'
import { assertSearchScope } from '../search/search-subagent-types.js'

export interface ApiContext {
  gateway: Gateway
  channelRegistry: ChannelRegistry
  messageProcessor: MessageProcessor
  foregroundAgent: ForegroundAgent
  runtimeDispatcher: RuntimeDispatcher
  plannerRuntime: PlannerRuntime
  agentKernel: AgentKernel
  llmAdapter: LLMAdapter
  permissionEngine: PermissionEngine
  toolRegistry: ToolRegistry
  toolExecutor: ToolExecutor
  skillRegistry: SkillRegistry
  stores: {
    eventStore: EventStore
    runtimeActionStore: RuntimeActionStore
    transcriptStore: TranscriptStore
    summaryStore: SummaryStore
    approvalStore: ApprovalStore
    permissionGrantStore: PermissionGrantStore
    toolExecutionStore: ToolExecutionStore
    toolResultStore: ToolResultStore
    plannerRunStore: PlannerRunStore
    backgroundRunStore: BackgroundRunStore
    kernelRunStore: KernelRunStore
    sessionStore: SessionStore
    userStore: UserStore
    authTokenStore: AuthTokenStore
    longTermMemoryStore: LongTermMemoryStore
    memoryExtractionRunStore: MemoryExtractionRunStore
    workflowDraftStore: WorkflowDraftStore
    workflowDefinitionStore: WorkflowDefinitionStore
    workflowRunStore: WorkflowRunStore
    triggerStore: TriggerStore
    webhookTriggerStore: WebhookTriggerStore
    webhookDeliveryStore: WebhookDeliveryStore
    scheduleTriggerStore: ScheduleTriggerStore
    planStore: PlanStore
    waitConditionStore: WaitConditionStore
    artifactStore: ArtifactStore
    connectorStore: ConnectorStore
    deadLetterStore: DeadLetterStore
    apiKeyStore: ApiKeyStore
    organizationStore: OrganizationStore
    todoStore: TodoStore
    fileUploadStore: FileUploadStore
  }
  providerConfigStore: ProviderConfigStore
  agentConfigStore: AgentConfigStore
  refreshProvidersForUser: (userId: string) => void
  runWithProvidersForUser: <T>(userId: string, fn: () => Promise<T>, preferredProviderId?: string) => Promise<T>
  connection: ConnectionManager
  /** Optional PostgreSQL adapter — only set when using PostgreSQL mode */
  postgresAdapter?: DatabaseAdapter
  consoleTimelineService: ConsoleTimelineService
  timelineBroadcaster: TimelineBroadcaster
  memoryExtractionScheduler?: LongTermMemoryScheduler
  workflowRuntime: WorkflowRuntime
  triggerRuntime: EventTriggerRuntime
  subagentRuntime: SubagentRuntime
  subagentRegistry: SubagentRegistry
  subagentRunStore: SubagentRunStore
  subagentTranscriptStore: SubagentTranscriptStore
  subagentProviderPreferenceStore: SubagentProviderPreferenceStore
  auditRecorder: AuditRecorder
  uploadFileService: UploadFileService
  uploadPreviewExtractor: UploadPreviewExtractor
  sessionChannelMapStore: SessionChannelMapStore
  webSearchBrowserProvider?: CloakBrowserProvider
}

export interface ApiContextOptions {
  dbPath?: string
  existingConnection?: ConnectionManager
  existingStores?: Partial<ApiContext['stores']>
  messageProcessor?: MessageProcessor
  foregroundAgent?: ForegroundAgent
  runtimeDispatcher?: RuntimeDispatcher
  plannerRuntime?: PlannerRuntime
  agentKernel?: AgentKernel
  llmAdapter?: LLMAdapter
  timelineBroadcaster?: TimelineBroadcaster
  channelRegistry?: ChannelRegistry
  webSearchBrowserProvider?: CloakBrowserProvider
}

export interface ApiContextError {
  code: 'CONNECTION_CLOSED' | 'CONNECTION_FAILED' | 'MIGRATION_FAILED' | 'STORE_INIT_FAILED'
  message: string
  details?: unknown
}

/**
 * Simple adapter registry for the runtime dispatcher.
 * Provides a minimal implementation for test-friendly injection.
 */
class SimpleAdapterRegistry implements AdapterRegistry {
  private adapters = new Map<TargetRuntime, RuntimeAdapter>()

  register(runtimeType: TargetRuntime, adapter: RuntimeAdapter): void {
    this.adapters.set(runtimeType, adapter)
  }

  getAdapter(runtimeType: TargetRuntime): RuntimeAdapter | null {
    return this.adapters.get(runtimeType) ?? null
  }

  unregister(runtimeType: TargetRuntime): void {
    this.adapters.delete(runtimeType)
  }

  listAdapters(): TargetRuntime[] {
    return Array.from(this.adapters.keys())
  }
}

function isProviderScopedLLMAdapter(adapter: LLMAdapter): adapter is ProviderScopedLLMAdapter {
  return 'runWithUserProviders' in adapter
}

export const MESSAGE_PROCESSOR_TIMEOUT_HEADROOM_MS = 10000
export const DEFAULT_MESSAGE_PROCESSOR_TIMEOUT_MS =
  DEFAULT_ROUTING_TIMEOUT_MS * (1 + DEFAULT_REPAIR_ATTEMPTS) + MESSAGE_PROCESSOR_TIMEOUT_HEADROOM_MS

function createOrchestrationMessageProcessor(deps: ProcessorOrchestrationDeps): MessageProcessor {
  const orchestrationFn = createOrchestrationProcessor({ deps })
  return createMessageProcessorImpl({
    timeoutMs: DEFAULT_MESSAGE_PROCESSOR_TIMEOUT_MS,
    processorFn: orchestrationFn,
  })
}

function isConnectionOpen(connection: ConnectionManager): boolean {
  try {
    return connection.isOpen()
  } catch {
    return false
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
    webSearchBrowserProvider: injectedWebSearchBrowserProvider,
  } = options

  const webSearchBrowserProvider = injectedWebSearchBrowserProvider ?? createCloakBrowserProvider()

  const connection = existingConnection ?? createConnectionManager(dbPath)

  if (!isConnectionOpen(connection)) {
    try {
      connection.open()
    } catch (error) {
      return {
        code: 'CONNECTION_FAILED',
        message: 'Failed to open database connection',
        details: error instanceof Error ? error.message : String(error),
      }
    }
  }

  let migrationRunner
  try {
    migrationRunner = createMigrationRunner(connection)
    migrationRunner.init()
    migrationRunner.apply(allStoreMigrations)
  } catch (error) {
    return {
      code: 'MIGRATION_FAILED',
      message: 'Failed to apply database migrations',
      details: error instanceof Error ? error.message : String(error),
    }
  }

  let eventStore: EventStore
  let runtimeActionStore: RuntimeActionStore
  let transcriptStore: TranscriptStore
  let summaryStore: SummaryStore
  let approvalStore: ApprovalStore
  let permissionGrantStore: PermissionGrantStore
  let toolExecutionStore: ToolExecutionStore
  let plannerRunStore: PlannerRunStore
  let backgroundRunStore: BackgroundRunStore
  let kernelRunStore: KernelRunStore
  let sessionStore: SessionStore
  let userStore: UserStore
  let authTokenStore: AuthTokenStore
  let providerConfigStore: ProviderConfigStore
  let agentConfigStore: AgentConfigStore
  let longTermMemoryStore: LongTermMemoryStore
  let memoryExtractionRunStore: MemoryExtractionRunStore
  let toolResultStore: ToolResultStore
  let workflowDraftStore: WorkflowDraftStore
  let workflowDefinitionStore: WorkflowDefinitionStore
  let workflowRunStore: WorkflowRunStore
  let triggerStore: TriggerStore
  let webhookTriggerStore: WebhookTriggerStore
  let webhookDeliveryStore: WebhookDeliveryStore
  let scheduleTriggerStore: ScheduleTriggerStore
  let connectorStore: ConnectorStore
  let sessionChannelMapStore: SessionChannelMapStore
  let planStore: PlanStore
  let waitConditionStore: WaitConditionStore
  let artifactStore: ArtifactStore
  let deadLetterStore: DeadLetterStore
  let apiKeyStore: ApiKeyStore
  let organizationStore: OrganizationStore
  let todoStore: TodoStore
  let fileUploadStore: FileUploadStore
  let subagentRunStore: SubagentRunStore
  let subagentTranscriptStore: SubagentTranscriptStore
  let subagentProviderPreferenceStore: SubagentProviderPreferenceStore

  try {
    eventStore = existingStores?.eventStore ?? createEventStore(connection)
    runtimeActionStore = existingStores?.runtimeActionStore ?? createRuntimeActionStore(connection)
    transcriptStore = existingStores?.transcriptStore ?? createTranscriptStore(connection)
    summaryStore = existingStores?.summaryStore ?? createSummaryStore(connection)
    approvalStore = existingStores?.approvalStore ?? createApprovalStore(connection)
    permissionGrantStore = existingStores?.permissionGrantStore ?? createPermissionGrantStore(connection)
    toolExecutionStore = existingStores?.toolExecutionStore ?? createToolExecutionStore(connection)
    toolResultStore =
      ((existingStores as Record<string, unknown>)?.toolResultStore as ToolResultStore) ??
      createToolResultStore(connection)
    plannerRunStore = existingStores?.plannerRunStore ?? createPlannerRunStore(connection)
    backgroundRunStore = existingStores?.backgroundRunStore ?? createBackgroundRunStore(connection)
    kernelRunStore = existingStores?.kernelRunStore ?? createKernelRunStore(connection)
    sessionStore = existingStores?.sessionStore ?? createSessionStore(connection)
    userStore = ((existingStores as Record<string, unknown>)?.userStore as UserStore) ?? createUserStore(connection)
    authTokenStore =
      ((existingStores as Record<string, unknown>)?.authTokenStore as AuthTokenStore) ??
      createAuthTokenStore(connection)
    providerConfigStore =
      ((existingStores as Record<string, unknown>)?.providerConfigStore as ProviderConfigStore) ??
      createProviderConfigStore(connection)
    agentConfigStore =
      ((existingStores as Record<string, unknown>)?.agentConfigStore as AgentConfigStore) ??
      createAgentConfigStore(connection)
    longTermMemoryStore =
      ((existingStores as Record<string, unknown>)?.longTermMemoryStore as LongTermMemoryStore) ??
      createLongTermMemoryStore(connection)
    memoryExtractionRunStore =
      ((existingStores as Record<string, unknown>)?.memoryExtractionRunStore as MemoryExtractionRunStore) ??
      createMemoryExtractionRunStore(connection)
    workflowDraftStore =
      ((existingStores as Record<string, unknown>)?.workflowDraftStore as WorkflowDraftStore) ??
      createWorkflowDraftStore(connection)
    workflowDefinitionStore =
      ((existingStores as Record<string, unknown>)?.workflowDefinitionStore as WorkflowDefinitionStore) ??
      createWorkflowDefinitionStore(connection)
    workflowRunStore =
      ((existingStores as Record<string, unknown>)?.workflowRunStore as WorkflowRunStore) ??
      createWorkflowRunStore(connection)
    triggerStore =
      ((existingStores as Record<string, unknown>)?.triggerStore as TriggerStore) ?? createTriggerStore(connection)
    webhookTriggerStore =
      ((existingStores as Record<string, unknown>)?.webhookTriggerStore as WebhookTriggerStore) ??
      createWebhookTriggerStore(connection)
    webhookDeliveryStore =
      ((existingStores as Record<string, unknown>)?.webhookDeliveryStore as WebhookDeliveryStore) ??
      createWebhookDeliveryStore(connection)
    scheduleTriggerStore =
      ((existingStores as Record<string, unknown>)?.scheduleTriggerStore as ScheduleTriggerStore) ??
      createScheduleTriggerStore(connection)
    connectorStore =
      ((existingStores as Record<string, unknown>)?.connectorStore as ConnectorStore) ??
      createConnectorStore(connection)
    sessionChannelMapStore = createSessionChannelMapStore(connection)
    planStore = ((existingStores as Record<string, unknown>)?.planStore as PlanStore) ?? createPlanStore(connection)
    waitConditionStore =
      ((existingStores as Record<string, unknown>)?.waitConditionStore as WaitConditionStore) ??
      createWaitConditionStore(connection)
    artifactStore =
      ((existingStores as Record<string, unknown>)?.artifactStore as ArtifactStore) ?? createArtifactStore(connection)
    deadLetterStore =
      ((existingStores as Record<string, unknown>)?.deadLetterStore as DeadLetterStore) ??
      createDeadLetterStore(connection)
    apiKeyStore =
      ((existingStores as Record<string, unknown>)?.apiKeyStore as ApiKeyStore) ?? createApiKeyStore(connection)
    organizationStore =
      ((existingStores as Record<string, unknown>)?.organizationStore as OrganizationStore) ??
      createOrganizationStore(connection)
    todoStore =
      ((existingStores as Record<string, unknown>)?.todoStore as TodoStore) ??
      createTodoStore(connection)
    fileUploadStore = createFileUploadStore(connection)
    subagentRunStore = createSubagentRunStore(connection)
    subagentTranscriptStore = createSubagentTranscriptStore(connection)
    subagentProviderPreferenceStore = createSubagentProviderPreferenceStore(connection)
  } catch (error) {
    return {
      code: 'STORE_INIT_FAILED',
      message: 'Failed to initialize stores',
      details: error instanceof Error ? error.message : String(error),
    }
  }

  registerMessagingDefinitions(connectorStore)

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
      findBySessionId: (sessionId: string) =>
        runtimeActionStore.query({ sessionId }) as unknown as Array<{
          actionId: string
          status: string
          targetRef?: Record<string, unknown>
        }>,
    },
  }

  const gateway = createGateway({ stores })

  // Create timeline services first (needed by channel handlers)
  const consoleTimelineService = createConsoleTimelineService({
    transcriptStore,
    eventStore,
    fileUploadStore,
  })

  // Use injected timeline broadcaster or create default
  const timelineBroadcaster =
    injectedTimelineBroadcaster ??
    createTimelineBroadcaster({
      timelineService: consoleTimelineService,
    })

  // Use injected channel registry or create default
  const channelRegistry = injectedChannelRegistry ?? createChannelRegistry()
  // Only register webui if using default registry (not injected)
  if (!injectedChannelRegistry) {
    channelRegistry.register(
      'webui',
      createWebUIChannelHandler({
        timelineBroadcaster,
        consoleTimelineService,
      }),
      {
        type: 'webui',
        status: 'active',
        configured: true,
      },
    )
  }

  // Determine whether to use mock LLM adapter
  const useMockLLM = process.env.NODE_ENV === 'test' || process.env.MVP_USE_MOCK_LLM === 'true'

  // Use injected LLM adapter or create appropriate adapter based on environment
  const llmAdapter =
    injectedLlmAdapter ??
    (useMockLLM ? createMockLLMAdapter() : createProviderScopedLLMAdapter({ providerConfigStore }))

  // Create ModelInputBuilder early so it can be shared by ForegroundAgent and AgentKernel
  const templateRegistry = new PromptTemplateRegistry()
  const templateLoader = new TemplateLoader()
  const modelInputBuilder = new ModelInputBuilder({
    templateRegistry,
    templateLoader,
  })

  const promptProjectionResolver = createPromptProjectionResolver(templateRegistry, templateLoader)

  const modelInputSnapshotStore = createModelInputSnapshotStore(createModelInputRedactor())

  const refreshProvidersForUser = (_userId: string): void => {
    // Request-scoped adapters read provider configs on each processing scope.
    // This hook remains for provider CRUD routes and injected adapters.
  }
  const runWithProvidersForUser = async <T>(
    userId: string,
    fn: () => Promise<T>,
    preferredProviderId?: string,
  ): Promise<T> => {
    if (!injectedLlmAdapter && isProviderScopedLLMAdapter(llmAdapter)) {
      return llmAdapter.runWithUserProviders(userId, fn, preferredProviderId)
    }

    return fn()
  }

  // Create adapter registry for dispatcher
  const adapterRegistry = new SimpleAdapterRegistry()

  // Use injected runtime dispatcher or create default
  const runtimeDispatcher =
    injectedRuntimeDispatcher ??
    createRuntimeDispatcher({
      actionStore: runtimeActionStore,
      eventStore: {
        append: (event: unknown) => eventStore.append(event as EventRecord | EventRecord[]),
      } as unknown as RuntimeDispatcherConfig['eventStore'],
      adapterRegistry,
    })

  // Use injected planner runtime or create default
  const plannerRuntime =
    injectedPlannerRuntime ??
    createPlannerRuntime({
      planStore,
      plannerRunStore,
      runtimeActionStore,
      eventStore: {
        append: (event: unknown) => eventStore.append(event as EventRecord | EventRecord[]),
        query: (filters: { sessionId?: string; eventType?: string }) => eventStore.query(filters),
        findByCorrelationId: (correlationId: string) => eventStore.findByCorrelationId?.(correlationId) ?? [],
        findByCausationId: (causationId: string) => eventStore.findByCausationId?.(causationId) ?? [],
        updateUserIdForSession: () => {
          /* no-op */
        },
      } as unknown as EventStore,
    })

  // Create permission engine
  const permissionEngine = createPermissionEngine({
    approvalStore,
    grantStore: permissionGrantStore,
    eventStore,
  })

  // Create tool registry and register built-in tools
  const toolRegistry = createToolRegistry()
  registerBuiltInTools(toolRegistry, {
    artifactStore,
    summaryStore,
    transcriptStore,
    planStore,
    longTermMemoryStore,
    toolResultStore,
    sessionStore,
    todoStore,
    webSearchBrowserProvider: webSearchBrowserProvider.getBrowser,
  })

  // Create skill registry and register built-in skills (active + deprecated aliases)
  const skillRegistry = createSkillRegistry()
  registerBuiltinSkills(skillRegistry)

  const globalAgentConfig = agentConfigStore.getGlobalDefault()
  const searchLlmProviderId = globalAgentConfig?.searchLlmProviderId ?? globalAgentConfig?.providerId ?? undefined
  const searchLlmModel = globalAgentConfig?.searchLlmModel ?? globalAgentConfig?.model ?? undefined

  let searchSubagent: SearchSubagent | undefined
  if (searchLlmProviderId && searchLlmModel) {
    const searchProviderFamily = resolveProviderFamily(searchLlmProviderId)
    searchSubagent = createSearchSubagent({
      llmAdapter,
      webSearchExecutor: async (params) => {
        const result = await executeWebSearch({ query: params.query })
        return result
      },
      modelInputBuilder,
      providerFamily: searchProviderFamily,
      searchLlmProviderId,
      searchLlmModel,
    })
  }

  if (searchSubagent) {
    const searchSubagentDeps = {
      searchSubagent,
      queryPlanner: new DefaultSearchQueryPlanner(),
      resultNormalizer: new DefaultSearchResultNormalizer(),
      scopeGuard: assertSearchScope,
    }
    registerAllForegroundTools(toolRegistry, searchSubagentDeps)
  } else {
    registerAllForegroundTools(toolRegistry)
  }

  // Create foreground agent with tool registry for schema projection
  const foregroundAgent =
    injectedForegroundAgent ??
    createForegroundAgent({
      agentConfig: agentConfigStore.getByUser('default') ?? undefined,
      toolRegistry,
    })

  const envelopeRegistry = createAgentTypeToolEnvelopeRegistry()

  // Create tool executor
  const toolExecutor = createToolExecutor({
    registry: toolRegistry,
    permissionEngine,
    envelopeRegistry,
    toolExecutionStore: {
      create: (exec) =>
        toolExecutionStore.create({
          toolCallId: exec.toolCallId,
          toolName: exec.toolName,
          userId: exec.userId,
          sessionId: exec.sessionId,
          kernelRunId: exec.kernelRunId,
          status: exec.status as import('../shared/states.js').ToolExecutionState,
          params: exec.params,
          sensitivity: exec.sensitivity as import('../storage/tool-execution-store.js').SensitivityLevel,
        }),
      updateStatus: (toolCallId, status) =>
        toolExecutionStore.updateStatus(toolCallId, status as import('../shared/states.js').ToolExecutionState),
      saveResult: (toolCallId, result) => toolExecutionStore.saveResult(toolCallId, result),
    },
    eventStore: {
      append: (event) => eventStore.append(event as EventRecord | EventRecord[]),
    },
  })

  // Adapter for AgentKernel's ToolExecutor interface
  const kernelToolExecutor: import('../kernel/types.js').ToolExecutor = {
    execute: async (request) => {
      const result = await toolExecutor.execute({
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        params: request.params,
        userId: request.userId,
	        sessionId: request.sessionId,
	        kernelRunId: request.kernelRunId,
	        agentId: request.agentId,
	        agentType: request.agentType,
	        agentProfile: request.agentProfile,
	        launchSource: request.launchSource,
	        permissionContext: {
          userId: request.permissionContext.userId,
          sessionId: request.sessionId ?? '',
          mode: 'ask_on_write',
          grants: [],
        },
      })
      return {
        success: result.success,
        data: result.data,
        error: result.error,
        resultPreview: result.resultPreview,
      }
    },
  }

  // Resolve default model for AgentKernel using agent-provider-resolver
  const kernelAgentConfig = agentConfigStore.getGlobalDefault()
  const modelResolution = resolveProviderAndModel({
    session: {},
    agentConfig: kernelAgentConfig
      ? { providerId: kernelAgentConfig.providerId ?? undefined, model: kernelAgentConfig.model ?? undefined }
      : {},
    userId: 'default',
    providerConfigStore,
    includeEnvProviders: true,
  })
  const defaultModel = modelResolution.type === 'success' ? (modelResolution.selectedModel ?? undefined) : undefined

  const providerFamily = resolveProviderFamily(
    modelResolution.type === 'success' ? modelResolution.selectedProviderId : undefined,
  )

  const agentKernel =
    injectedAgentKernel ??
    new AgentKernel({
      llmAdapter,
      toolExecutor: kernelToolExecutor,
      contextManager: {
        assembleBundle: () => ({
          runId: 'default',
          bundleId: 'default-bundle',
          agentId: 'default-agent',
          agentType: 'main' as const,
          userId: 'default-user',
          invocationSource: 'system' as const,
          orderedItems: [],
          pinnedItems: [],
          tokenEstimate: 1000,
        }),
        getItems: () => [],
        addItem: () => {},
        applyDelta: () => {},
      },
      dispatcher: createKernelDispatcherAdapter(runtimeDispatcher),
      modelInputBuilder,
      maxIterations: 10,
      timeoutMs: 30000,
      defaultModel,
      providerFamily,
      modelInputSnapshotStore,
      promptProjectionResolver,
    })

  foregroundAgent.setAgentKernel?.(agentKernel)
  foregroundAgent.setToolRegistry?.(toolRegistry)

  // Create processing observer that broadcasts status to SSE subscribers
  const processingObserver = {
    emitStatus: (status: import('./types.js').ProcessingStatusPayload) => {
      timelineBroadcaster.broadcastProcessingStatus(status.sessionId, status)
    },
  }

  const memoryExtractionScheduler: LongTermMemoryScheduler | undefined = createLongTermMemoryScheduler({
    transcriptStore,
    summaryStore,
    longTermMemoryStore,
    memoryExtractionRunStore,
    llmAdapter,
    modelInputBuilder,
  })

  const workflowRuntime = createWorkflowRuntime({
    draftStore: workflowDraftStore,
    definitionStore: workflowDefinitionStore,
    workflowRunStore,
    runtimeActionStore,
    eventStore,
    dispatcher: createWorkflowDispatcherAdapter(runtimeDispatcher),
  })

  const triggerRuntime = createEventTriggerRuntime({
    triggerStore,
    waitConditionStore,
    eventStore,
    runtimeActionStore,
  })

  const backgroundRuntime = createBackgroundRuntime({
    backgroundRunStore,
    eventStore,
    maxConcurrentRuns: 10,
    watchdogTimeoutMs: 60000,
  })

  const subagentRegistry = createSubagentRegistry()
  registerBuiltInSubagents(subagentRegistry)

  const subagentContextManager = createDefaultSubagentContextManager({
    summaryStore: {
      get: (id: string) => {
        const record = summaryStore.getBySummaryId(id)
        return record ? { content: record.summary } : null
      },
    },
    transcriptStore: {
      get: (id: string) => transcriptStore.getTurn(id),
    },
    artifactStore: {
      get: (id: string) => artifactStore.findById(id) ?? null,
    },
  })

  const subagentKernelAdapter = createSubagentKernelAdapter({
    agentKernel,
    subagentRegistry,
    providerConfigStore,
    agentConfigStore,
    sessionStore,
	    toolRegistry,
	    preferenceStore: subagentProviderPreferenceStore,
	    runWithProvidersForUser,
	    envelopeRegistry,
	  })

  const subagentRuntime = createSubagentRuntime({
    kernelAdapter: subagentKernelAdapter,
    contextManager: subagentContextManager,
    maxConcurrent: 10,
    defaultTimeoutMs: 60000,
    defaultMaxIterations: 10,
    runStore: subagentRunStore,
    transcriptStore: subagentTranscriptStore,
  })

  // Register default runtime adapters
  registerDefaultRuntimeAdapters({
    adapterRegistry,
    toolExecutor,
    toolRegistry,
    plannerRuntime,
    workflowRuntime,
    triggerRuntime,
    agentKernel,
    permissionGrantStore,
    backgroundRuntime,
    subagentRuntime,
    subagentRegistry,
  })

  const messageProcessor =
    injectedMessageProcessor ??
    createOrchestrationMessageProcessor({
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
    })

  const auditStore = createAuditStore(connection)
  const auditRecorder = createAuditRecorder({ auditStore })

  const uploadFileService = createUploadFileService()
  const uploadPreviewExtractor = createUploadPreviewExtractor()

  return {
    gateway,
    channelRegistry,
    messageProcessor,
    foregroundAgent,
    runtimeDispatcher,
    plannerRuntime,
    agentKernel,
    llmAdapter,
    permissionEngine,
    toolRegistry,
    toolExecutor,
    skillRegistry,
    stores: {
      eventStore,
      runtimeActionStore,
      transcriptStore,
      summaryStore,
      approvalStore,
      permissionGrantStore,
      toolExecutionStore,
      toolResultStore,
      plannerRunStore,
      backgroundRunStore,
      kernelRunStore,
      sessionStore,
      userStore,
      authTokenStore,
      longTermMemoryStore,
      memoryExtractionRunStore,
      workflowDraftStore,
      workflowDefinitionStore,
      workflowRunStore,
      triggerStore,
      webhookTriggerStore,
      webhookDeliveryStore,
      scheduleTriggerStore,
      planStore,
      waitConditionStore,
      artifactStore,
      connectorStore,
      deadLetterStore,
      apiKeyStore,
      organizationStore,
      todoStore,
      fileUploadStore,
    },
    providerConfigStore,
    agentConfigStore,
    refreshProvidersForUser,
    runWithProvidersForUser,
    connection,
    consoleTimelineService,
    timelineBroadcaster,
    memoryExtractionScheduler,
    workflowRuntime,
    triggerRuntime,
    subagentRuntime,
    subagentRegistry,
    subagentRunStore,
    subagentTranscriptStore,
    subagentProviderPreferenceStore,
    auditRecorder,
    uploadFileService,
    uploadPreviewExtractor,
    sessionChannelMapStore,
    webSearchBrowserProvider,
  }
}

export function isApiContextError(value: ApiContext | ApiContextError): value is ApiContextError {
  return 'code' in value && 'message' in value
}
