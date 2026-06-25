export interface ApiError {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export interface ApiSuccess<T> {
  data: T
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError

export interface ModuleHealth {
  status: 'healthy' | 'degraded' | 'unhealthy'
  message?: string
}

export interface HealthResponse {
  status: 'healthy' | 'degraded'
  timestamp: string
  modules: Record<string, ModuleHealth>
}

export interface SessionInfo {
  sessionId: string
  userId: string
  messageCount: number
  lastActivityAt: string
  activePlannerRunIds: string[]
  activeBackgroundRunIds: string[]
}

export interface SessionResponse {
  session: SessionInfo
}

export interface VisibleMessage {
  messageId: string
  role: 'user' | 'assistant' | 'tool' | 'thinking' | 'system_status' | 'approval' | 'artifact' | 'error'
  content: string
}

export interface TranscriptTurn {
  turnId: string
  sessionId: string
  userId: string
  input: {
    inboundEventId?: string
    userMessageSummary?: string
    contentRefs?: string[]
  }
  output: {
    visibleMessages: VisibleMessage[]
    artifactRefs?: string[]
  }
  runtimeSummary?: {
    foregroundDecisionId?: string
    plannerRunIds?: string[]
    runtimeActionIds?: string[]
    toolCallSummaries?: string[]
    approvalSummaries?: string[]
  }
  eventRange?: {
    startEventId: string
    endEventId: string
  }
  visibility: 'public' | 'internal' | 'confidential'
  createdAt: string
}

export interface TranscriptsResponse {
  transcripts: TranscriptTurn[]
  total: number
}

export interface SendMessageRequest {
  text: string
}

export interface SendMessageResponse {
  accepted: boolean
  turnId?: string
  message?: string
  status: string
  correlationId: string
  envelopeId: string
}

export interface RunInfo {
  runId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  objective?: string
  progress?: number
  createdAt: string
  updatedAt?: string
}

export interface RunsResponse {
  runs: RunInfo[]
  total: number
}

export interface SseRunEvent {
  type: 'run_started' | 'run_progress' | 'run_completed' | 'run_failed' | 'run_cancelled'
  runId: string
  data: Record<string, unknown>
  timestamp: string
}

export interface ApprovalInfo {
  id: string
  userId: string
  sessionId: string
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled'
  riskLevel?: string
  scope?: string
  actionType: string
  resource?: string
  justification?: string
  requestedBy: string
  requestedAt: string
  expiresAt?: string
  respondedAt?: string
  responseBy?: string
  responseReason?: string
  plannerRunId?: string
}

export interface ApprovalDetailResponse {
  approval: ApprovalInfo
}

export interface ApprovalsResponse {
  approvals: ApprovalInfo[]
  total: number
}

export type ApprovalResponseType = 'reject' | 'approve_once' | 'approve_always'

export interface ApprovalDecisionRequest {
  decision?: 'approved' | 'rejected' // legacy
  responseType?: ApprovalResponseType // new canonical
  reason?: string
}

export interface ApprovalDecisionResponse {
  success: boolean
  approvalId: string
  status: 'approved' | 'rejected'
  responseType?: ApprovalResponseType
  grantCreated?: boolean
  grantId?: string
}

// =============================================================================
// Console Timeline Types - Canonical API Contracts
// =============================================================================

/** SAFETY: thinking_summary contains ONLY summarized/public-safe content. Raw chain-of-thought MUST NOT be included. */
export type ConsoleTimelineEventType =
  | 'user_message'
  | 'assistant_message'
  | 'thinking_summary'
  | 'tool_call'
  | 'tool_result'
  | 'approval_request'
  | 'approval_decision'
  | 'artifact_created'
  | 'run_started'
  | 'run_progress'
  | 'run_completed'
  | 'run_failed'
  | 'run_cancelled'
  | 'system_status'
  | 'error'
  | 'processing_status'
  | 'token_stream'

export interface ConsoleTimelineEvent {
  eventId: string
  eventType: ConsoleTimelineEventType
  sessionId: string
  timestamp: string
  content?: string
  metadata?: Record<string, unknown>
  actor?: string
}

// =============================================================================
// Live Streaming and Processing Status Types
// =============================================================================

export type StreamStatus = 'connecting' | 'connected' | 'disconnected'

export type ProcessingStage =
  | 'idle'
  | 'receiving'
  | 'routing'
  | 'model_call'
  | 'tool_call'
  | 'streaming'
  | 'persisting'
  | 'completed'
  | 'failed'

export const ProcessingStageLabel: Record<ProcessingStage, string> = {
  idle: '空闲',
  receiving: '接收',
  routing: '路由',
  model_call: '模型调用',
  tool_call: '工具调用',
  streaming: '流式输出',
  persisting: '持久化',
  completed: '完成',
  failed: '失败',
}

export interface ProcessingToolStatus {
  toolId: string
  status: 'running' | 'completed' | 'failed'
  label?: string
}

/** Exact token counts only. No estimated or approximate fields. */
export interface ExactContextUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  maxContextTokens?: number
}

export interface ProcessingStatusPayload {
  sessionId: string
  attemptId: string
  messageId?: string
  stage: ProcessingStage
  stageLabel: string
  providerId?: string
  model?: string
  contextUsage?: ExactContextUsage | null
  activeTools: ProcessingToolStatus[]
  timestamp: string
  error?: string
}

/** SAFETY: delta contains assistant-visible text only. Raw chain-of-thought MUST NOT be included. */
export interface TokenStreamPayload {
  sessionId: string
  attemptId: string
  messageId?: string
  sequence: number
  delta: string
  accumulated?: string
  isFinal?: boolean
  timestamp: string
}

export interface ConsoleSessionInfo {
  sessionId: string
  userId: string
  title: string
  status: 'active' | 'archived' | 'closed'
  messageCount: number
  lastActivityAt: string
  createdAt: string
  updatedAt: string
}

export interface PaginationParams {
  limit?: number
  offset?: number
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export interface UsageSummary {
  sessionId: string
  messageCount: number
  turnCount: number
  toolCallCount: number
  approvalCount: number
  artifactCount: number
  runCount: number
  estimatedInputTokens: number
  estimatedOutputTokens: number
  estimatedTotalTokens: number
  estimatedCostCents: number | null
  updatedAt: string
}

export interface LogEntry {
  eventId: string
  eventType: string
  sourceModule: string
  sessionId?: string
  severity: 'info' | 'warn' | 'error'
  summary: string
  createdAt: string
  payloadPreview?: string
}

export interface InstanceSummary {
  type: 'local'
  status: 'healthy' | 'degraded'
  uptime?: number
  apiPort: number
  storeStatus: string
}

export interface ChannelSummary {
  connectorId: string
  type: string
  status: string
  configured: boolean
}

export interface SkillSummary {
  skillId: string
  name: string
  description: string
  category: string
  sensitivity: string
  enabled: boolean
  source: string
}

export interface SettingsConfig {
  localOnly: boolean
  providers: Record<string, { configured: boolean }>
  retentionDays: number
}

// =============================================================================
// API Response Types for Console Panels
// =============================================================================

export interface SessionsResponse {
  sessions: ConsoleSessionInfo[]
  total: number
}

export interface UsageResponse {
  usages: UsageSummary[]
  total: number
}

export interface SessionUsageResponse {
  usage: UsageSummary
}

export interface LogsResponse {
  logs: LogEntry[]
  total: number
}

export interface RedactedPreview {
  eventId: string
  eventType: string
  preview: string
}

export interface RedactedPreview {
  eventId: string
  eventType: string
  preview: string
}

export interface DebugReplayResponse {
  sessionId: string
  eventCount: number
  transcriptCount: number
  runRefs: string[]
  approvalRefs: string[]
  lastEventId: string | null
  redactedPreviews: RedactedPreview[]
}

export interface InstancesResponse {
  instances: InstanceSummary[]
}

export interface ChannelsResponse {
  channels: ChannelSummary[]
}

export interface SkillsResponse {
  skills: SkillSummary[]
}

export interface SettingsResponse {
  settings: SettingsConfig
}

// =============================================================================
// File Upload Types - Session Attachments
// =============================================================================

export interface FileUploadMetadata {
  fileId: string
  userId: string
  sessionId: string
  originalFilename: string
  sanitizedName: string
  mimeType: string
  extension: string
  sizeBytes: number
  previewStatus: 'pending' | 'generated' | 'skipped' | 'failed'
  status: 'uploading' | 'ready' | 'deleted'
  createdAt: string
  updatedAt: string
}

export interface FileUploadResponse {
  file: FileUploadMetadata
}

export interface FileListResponse {
  files: FileUploadMetadata[]
  total: number
}

// =============================================================================
// Auth Types - Task 15
// =============================================================================

export interface SetupStatusResponse {
  needsSetup: boolean
}

// =============================================================================
// Setup Readiness Types - Task 8
// =============================================================================

export interface ReadinessItem {
  id: string
  label: string
  status: 'ok' | 'warning' | 'error'
  details: string
}

export interface ReadinessResponse {
  items: ReadinessItem[]
  timestamp: string
}

export interface UserMetadata {
  userId: string
  username: string
  role?: UserRole
  createdAt: string
}

export interface LoginRequest {
  username: string
  password: string
}

export interface CreateUserRequest {
  username: string
  password: string
}

export interface AuthSuccessResponse {
  user: UserMetadata
}

// =============================================================================
// Provider Types - Task 18
// =============================================================================

export type ProviderType = 'openai' | 'openrouter' | 'deepseek' | 'ollama' | 'custom'

export interface ProviderSummary {
  providerId: string
  providerType: ProviderType
  displayName: string
  enabled: boolean
  configured: boolean
  apiKeyLast4: string | null
  baseUrl: string | null
  selectedModel: string | null
  source: string
  lastTestStatus: string | null
  lastTestedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateProviderRequest {
  providerType: ProviderType
  displayName?: string
  apiKey?: string
  baseUrl?: string
  selectedModel?: string
}

export interface UpdateProviderRequest {
  displayName?: string
  apiKey?: string
  baseUrl?: string
  selectedModel?: string
  enabled?: boolean
}

export interface TestProviderResponse {
  success: boolean
  latencyMs: number
  modelCount?: number
  error?: string
}

// =============================================================================
// Tool Catalog Types - Task 2
// =============================================================================

export type ToolCategory = 'read' | 'write' | 'delete' | 'execute' | 'search' | 'admin' | 'connector' | 'internal'
export type ToolSensitivity = 'low' | 'medium' | 'high' | 'restricted'

export interface ToolSummary {
  name: string
  description: string
  category: ToolCategory
  sensitivity: ToolSensitivity
}

export interface ToolsResponse {
  tools: ToolSummary[]
  total: number
}

// =============================================================================
// AgentConfig Types - Task 3 (Wave 1)
// =============================================================================

export interface AgentGlobalConfig {
  providerId: string
  model: string
  systemPrompt: string
  routingPrompt: string
  allowedToolIds: string[]
  allowedSkillIds: string[]
  routingTimeoutMs: number
  repairAttempts: number
}

export interface AgentUserOverride {
  providerId: string
  model: string
  systemPrompt: string
  routingPrompt: string
  allowedToolIds: string[]
  allowedSkillIds: string[]
  routingTimeoutMs?: number
  repairAttempts?: number
}

export interface AgentEffectiveConfig {
  providerId: string
  model: string
  systemPrompt: string
  routingPrompt: string
  allowedToolIds: string[]
  allowedSkillIds: string[]
  routingTimeoutMs: number
  repairAttempts: number
  resolvedPromptType?: string
  resolvedPromptVersion?: string
  promptFallbackReason?: 'UNKNOWN_PROMPT_VERSION' | 'UNKNOWN_PROMPT_TYPE'
}

export interface AgentConfig {
  agentId: string
  global: AgentGlobalConfig
  userOverride: AgentUserOverride | null
  effective: AgentEffectiveConfig
}

export interface UpdateAgentGlobalConfigRequest {
  providerId?: string
  model?: string
  systemPrompt?: string
  routingPrompt?: string
  allowedToolIds?: string[]
  allowedSkillIds?: string[]
  routingTimeoutMs?: number
  repairAttempts?: number
}

export interface UpdateAgentUserOverrideRequest {
  providerId?: string
  model?: string
  systemPrompt?: string
  routingPrompt?: string
  allowedToolIds?: string[]
  allowedSkillIds?: string[]
  routingTimeoutMs?: number
  repairAttempts?: number
}

export interface ResetAgentConfigOverrideResponse {
  success: boolean
}

// =============================================================================
// Workflow Types - Task 3 (P0-5 Builder UI)
// =============================================================================

export type WorkflowStepType = 'tool_call' | 'agent_run' | 'subagent_run' | 'approval' | 'wait'

export interface WorkflowStepConfig {
  toolName?: string
  agentId?: string
  /** @deprecated Use agentProfile instead. Kept for backward compatibility. */
  subagentType?: string
  /** Capability profile identifier for subagent_run steps. Falls back to subagentType when not provided. */
  agentProfile?: string
  approvalScope?: string
  waitCondition?: Record<string, unknown>
}

export interface WorkflowStep {
  stepId: string
  stepType: WorkflowStepType
  name: string
  description?: string
  config: WorkflowStepConfig
  nextStepId?: string
  requiresApproval?: boolean
}

export interface WorkflowValidationIssue {
  code: string
  message: string
  stepId?: string
  severity: 'error' | 'warning'
}

export interface WorkflowDraftResponse {
  draftId: string
  name: string
  description?: string
  steps: WorkflowStep[]
  ownerUserId: string
  status: string
  validationIssues: WorkflowValidationIssue[]
  createdAt: string
  updatedAt: string
}

export interface WorkflowDefinitionResponse {
  workflowId: string
  name: string
  description?: string
  version: number
  steps: WorkflowStep[]
  ownerUserId: string
  status: string
  publishedFromDraftId?: string
  createdAt: string
  updatedAt: string
}

export interface WorkflowRunStepInfo {
  stepRunId: string
  stepId: string
  stepType: string
  status: string
  startedAt?: string
  completedAt?: string
}

export interface WorkflowRunResponse {
  workflowRunId: string
  definitionId: string
  version: number
  status: string
  currentStepIds: string[]
  stepRuns: WorkflowRunStepInfo[]
}

export interface WorkflowValidationResult {
  valid: boolean
  issues: WorkflowValidationIssue[]
}

export interface MemoryItem {
  memoryId: string
  userId: string
  type: string
  content: string
  sensitivity: string
  lifecycle: {
    status: string
    createdAt: string
  }
  keywords?: string[]
  sourceRefs?: Array<{ sourceType: string; sourceId: string }>
  createdAt: string
  updatedAt?: string
}

export interface MemoriesResponse {
  memories: MemoryItem[]
  total: number
}

export interface MemoryDetailResponse {
  memory: MemoryItem
}

export interface DeleteMemoryResponse {
  deleted: boolean
  memoryId: string
}

// =============================================================================
// PlannerRun Timeline / Summary Types - Task 18
// =============================================================================

export interface PlannerRunEvent {
  eventId: string
  eventType: string
  timestamp: string
  payload?: Record<string, unknown>
  sourceModule?: string
}

export interface PlannerRunEventsResponse {
  events: PlannerRunEvent[]
  total: number
}

export interface PlannerRunSummary {
  plannerRunId: string
  status: string
  goal?: string
  stepCount: number
  currentStep: string | null
  planVersion: number
}

export interface PlannerRunSummaryResponse {
  summary: PlannerRunSummary
}

// =============================================================================
// Trigger Types - TriggersTab UI
// =============================================================================

export interface TriggerResponse {
  triggerId: string
  name: string
  triggerType: 'schedule' | 'webhook'
  status: 'active' | 'paused'
  createdAt: string
  // schedule-specific
  cronExpression?: string
  // webhook-specific
  webhookKey?: string
  webhookUrl?: string
}

export interface TriggerLogEntry {
  logId: string
  triggerId: string
  eventType: string
  status: string
  executedAt: string
  error?: string
}

export interface TriggersResponse {
  triggers: TriggerResponse[]
  total: number
}

export interface TriggerLogsResponse {
  logs: TriggerLogEntry[]
  total: number
}

// =============================================================================
// DLQ (Dead Letter Queue) Types - DLQTab UI
// =============================================================================

export type DeadLetterStatus = 'pending' | 'retrying' | 'discarded' | 'resolved'

export interface DeadLetterEntry {
  eventId: string
  sourceModule: string
  sourceId: string
  reason: string
  payload?: Record<string, unknown>
  status: DeadLetterStatus
  failureCount: number
  lastError?: string
  enqueuedAt: string
  updatedAt: string
  discardedAt?: string
  resolvedAt?: string
}

export interface DlqListResponse {
  entries: DeadLetterEntry[]
  total: number
}

export interface DlqRetryResponse {
  success: boolean
  eventId: string
  error?: string
}

export interface DlqDiscardResponse {
  success: boolean
  eventId: string
}

export interface DlqBatchRetryResponse {
  results: Array<{
    eventId: string
    success: boolean
    error?: string
  }>
  successCount: number
  failedCount: number
}

export interface DlqBatchDiscardResponse {
  results: Array<{
    eventId: string
    success: boolean
  }>
  successCount: number
}

// =============================================================================
// Admin Types - AdminTab UI
// =============================================================================

export type UserRole = 'admin' | 'user' | 'service'
export type UserStatus = 'active' | 'disabled'

export interface AdminUser {
  userId: string
  username: string
  role: UserRole
  status: UserStatus
  createdAt: string
  updatedAt: string
}

export interface AdminUsersResponse {
  users: AdminUser[]
  total: number
}

export interface UpdateUserRoleRequest {
  role: UserRole
}

export interface UpdateUserStatusRequest {
  status: UserStatus
}

export interface AdminApiKey {
  id: string
  name: string
  prefix: string
  role: UserRole
  status: 'active' | 'revoked'
  userId: string | null
  createdAt: string
  expiresAt: string | null
  lastUsedAt: string | null
}

export interface AdminApiKeysResponse {
  keys: AdminApiKey[]
  total: number
}

export interface CreateApiKeyRequest {
  name: string
  role: UserRole
  expiresAt?: string
}

export interface CreateApiKeyResponse {
  id: string
  name: string
  key: string
  prefix: string
  role: UserRole
  createdAt: string
}

export interface ConnectorHealthStatus {
  connectorId: string
  connectorType: string
  displayName: string
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
  message?: string
  lastCheckedAt: string | null
}

export interface ConnectorHealthResponse {
  connectors: ConnectorHealthStatus[]
}

export interface SystemSettings {
  rateLimitPerMinute: number
  rateLimitPerHour: number
  sessionTokenTtlHours: number
}

export interface SystemSettingsResponse {
  settings: SystemSettings
}

export interface UpdateSystemSettingsRequest {
  rateLimitPerMinute?: number
  rateLimitPerHour?: number
  sessionTokenTtlHours?: number
}

// =============================================================================
// Subagent Configuration Types
// =============================================================================

export type SubagentFallbackMode = 'none' | 'same_provider' | 'any_compatible'

export interface SubagentProviderPolicy {
  defaultProviderId?: string
  defaultModel?: string
  allowedProviderIds?: string[]
  allowedModelIds?: string[]
  requiredCapabilities?: string[]
  fallbackMode: SubagentFallbackMode
}

export interface SubagentDefinition {
  agentType: string
  agentProfile: string
  displayName: string
  description: string
  modality: string
  providerPolicy: SubagentProviderPolicy
}

export interface SubagentPreference {
  providerId?: string
  model?: string
  fallbackMode?: SubagentFallbackMode
}

export interface SubagentPreferenceResponse {
  agentType: string
  agentProfile: string
  preference: SubagentPreference | null
  providerPolicy: SubagentProviderPolicy
}

export interface SubagentDefinitionsResponse {
  definitions: SubagentDefinition[]
}

export interface UpdateSubagentPreferenceRequest {
  providerId?: string | null
  model?: string | null
  fallbackMode?: SubagentFallbackMode
}

// =============================================================================
// Todo Types - Session-scoped Todo Management
// =============================================================================

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
export type TodoPriority = 'high' | 'medium' | 'low'

export interface TodoItem {
  todoId: string
  sessionId: string
  content: string
  status: TodoStatus
  priority: TodoPriority
  parentTodoId?: string
  position: number
  ownerAgentId?: string
  createdAt: string
  updatedAt: string
}

export interface CreateTodoRequest {
  content: string
  priority?: TodoPriority
  parentTodoId?: string
  status?: TodoStatus
  ownerAgentId?: string
}

export interface UpdateTodoRequest {
  content?: string
  status?: TodoStatus
  priority?: TodoPriority
}

export interface TodosResponse {
  todos: TodoItem[]
  total: number
}

export interface TodoResponse {
  todo: TodoItem
}

export interface DeleteTodoResponse {
  success: boolean
}

// =============================================================================
// Workdir Types - User Session Workdirs
// =============================================================================

/** Safe workdir view — never includes raw absolute paths */
export interface WorkdirInfo {
  id: string
  userId: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface WorkdirsResponse {
  workdirs: WorkdirInfo[]
  total: number
}

export interface CreateWorkdirRequest {
  name: string
}

export interface RenameWorkdirRequest {
  name: string
}

export interface WorkdirResponse {
  workdir: WorkdirInfo | null
}

export interface DeleteWorkdirResponse {
  deleted: boolean
  workdirId: string
}

// =============================================================================
// Session Workdir Types
// =============================================================================

export interface SessionWorkdirResponse {
  workdir: WorkdirInfo | null
}

export interface SetSessionWorkdirRequest {
  workdirId: string
}

export interface ClearSessionWorkdirResponse {
  cleared: boolean
}

// =============================================================================
// Workdir File Tree Types
// =============================================================================

export interface WorkdirTreeNode {
  name: string
  type: 'file' | 'directory'
  relativePath: string
}

export interface WorkdirTreeResponse {
  tree: WorkdirTreeNode[]
  path: string
}

// =============================================================================
// Workdir File Types
// =============================================================================

export interface WorkdirFileContent {
  path: string
  content: string
  sizeBytes: number
  modifiedAt: string
}

export interface WriteWorkdirFileRequest {
  path: string
  content: string
}

export interface WriteWorkdirFileResponse {
  path: string
  sizeBytes: number
  modifiedAt: string
}

export interface MoveWorkdirEntryRequest {
  fromPath: string
  toPath: string
}

export interface MoveWorkdirEntryResponse {
  fromPath: string
  path: string
  type: 'file' | 'directory'
}

export interface DeleteWorkdirEntryResponse {
  path: string
  deleted: boolean
}

export interface UploadWorkdirFileRequest {
  path: string
  content: string
}

export type UploadWorkdirFileResponse = WriteWorkdirFileResponse

export interface CreateWorkdirDirRequest {
  path: string
}

export interface CreateWorkdirDirResponse {
  path: string
  created: boolean
}
