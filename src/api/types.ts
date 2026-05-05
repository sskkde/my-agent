// MVP Allowed Endpoints:
// GET /api/health, POST /api/sessions, GET /api/sessions/:sessionId,
// GET /api/sessions/:sessionId/transcripts, POST /api/sessions/:sessionId/messages,
// GET /api/runs, GET /api/runs/stream, GET /api/approvals, PATCH /api/approvals/:approvalId

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ApiSuccess<T> {
  data: T;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface ModuleHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded';
  timestamp: string;
  modules: Record<string, ModuleHealth>;
}

export interface SessionInfo {
  sessionId: string;
  userId: string;
  messageCount: number;
  lastActivityAt: string;
  activePlannerRunIds: string[];
  activeBackgroundRunIds: string[];
  selectedModel?: string;
  selectedProviderId?: string;
}

export interface SessionResponse {
  session: SessionInfo;
}

export interface VisibleMessage {
  messageId: string;
  role: 'user' | 'assistant' | 'tool' | 'thinking' | 'system_status' | 'approval' | 'artifact' | 'error';
  content: string;
}

export interface TranscriptTurn {
  turnId: string;
  sessionId: string;
  userId: string;
  input: {
    inboundEventId?: string;
    userMessageSummary?: string;
    contentRefs?: string[];
    inboundTimestamp?: string;
  };
  output: {
    visibleMessages: VisibleMessage[];
    artifactRefs?: string[];
  };
  runtimeSummary?: {
    foregroundDecisionId?: string;
    plannerRunIds?: string[];
    runtimeActionIds?: string[];
    toolCallSummaries?: string[];
    approvalSummaries?: string[];
  };
  eventRange?: {
    startEventId: string;
    endEventId: string;
  };
  visibility: 'public' | 'internal' | 'confidential';
  createdAt: string;
}

export interface TranscriptsResponse {
  transcripts: TranscriptTurn[];
  total: number;
}

export interface SendMessageRequest {
  text: string;
}

export interface SendMessageResponse {
  accepted: boolean;
  turnId?: string;
  message?: string;
  status: string;
  correlationId: string;
  envelopeId: string;
}

export interface RunInfo {
  runId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  objective?: string;
  progress?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface RunsResponse {
  runs: RunInfo[];
  total: number;
}

export interface SseRunEvent {
  type: 'run_started' | 'run_progress' | 'run_completed' | 'run_failed' | 'run_cancelled';
  runId: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface ApprovalInfo {
  id: string;
  userId: string;
  sessionId: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
  riskLevel?: string;
  scope?: string;
  actionType: string;
  resource?: string;
  justification?: string;
  requestedBy: string;
  requestedAt: string;
  expiresAt?: string;
}

export interface ApprovalsResponse {
  approvals: ApprovalInfo[];
  total: number;
}

export interface ApprovalDecisionRequest {
  decision: 'approved' | 'rejected';
  reason?: string;
}

export interface ApprovalDecisionResponse {
  success: boolean;
  approvalId: string;
  status: 'approved' | 'rejected';
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
  | 'token_stream';

export interface ConsoleTimelineEvent {
  eventId: string;
  eventType: ConsoleTimelineEventType;
  sessionId: string;
  timestamp: string;
  content?: string;
  metadata?: Record<string, unknown>;
  actor?: string;
}

// =============================================================================
// Live Streaming and Processing Status Types
// =============================================================================

export type ProcessingStage =
  | 'idle'
  | 'receiving'
  | 'routing'
  | 'model_call'
  | 'tool_call'
  | 'streaming'
  | 'persisting'
  | 'completed'
  | 'failed';

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
};

export interface ProcessingToolStatus {
  toolId: string;
  status: 'running' | 'completed' | 'failed';
  label?: string;
}

/** Exact token counts only. No estimated or approximate fields. */
export interface ExactContextUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  maxContextTokens?: number;
}

export interface ProcessingStatusPayload {
  sessionId: string;
  attemptId: string;
  messageId?: string;
  stage: ProcessingStage;
  stageLabel: string;
  providerId?: string;
  model?: string;
  contextUsage?: ExactContextUsage | null;
  activeTools: ProcessingToolStatus[];
  timestamp: string;
  error?: string;
}

/** SAFETY: delta contains assistant-visible text only. Raw chain-of-thought MUST NOT be included. */
export interface TokenStreamPayload {
  sessionId: string;
  attemptId: string;
  messageId?: string;
  sequence: number;
  delta: string;
  accumulated?: string;
  isFinal?: boolean;
  timestamp: string;
}

export interface ConsoleSessionInfo {
  sessionId: string;
  userId: string;
  title: string;
  status: 'active' | 'archived' | 'closed';
  messageCount: number;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  selectedModel?: string;
  selectedProviderId?: string;
}

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface UsageSummary {
  sessionId: string;
  messageCount: number;
  turnCount: number;
  toolCallCount: number;
  approvalCount: number;
  artifactCount: number;
  runCount: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  estimatedCostCents: number | null;
  updatedAt: string;
}

export interface LogEntry {
  eventId: string;
  eventType: string;
  sourceModule: string;
  sessionId?: string;
  severity: 'info' | 'warn' | 'error';
  summary: string;
  createdAt: string;
  payloadPreview?: string;
}

export interface InstanceSummary {
  type: 'local';
  status: 'healthy' | 'degraded';
  uptime?: number;
  apiPort: number;
  storeStatus: string;
}

export interface ChannelSummary {
  connectorId: string;
  type: string;
  status: string;
  configured: boolean;
}

export interface SkillSummary {
  skillId: string;
  name: string;
  type: string;
  enabled: boolean;
}

export interface InstancesResponse {
  instances: InstanceSummary[];
}

export interface ChannelsResponse {
  channels: ChannelSummary[];
}

export interface SkillsResponse {
  skills: SkillSummary[];
}

export interface SettingsConfig {
  localOnly: boolean;
  providers: Record<string, { configured: boolean }>;
  retentionDays: number;
}

export interface SettingsResponse {
  settings: SettingsConfig;
}

// =============================================================================
// Auth Types - Task 14
// =============================================================================

export interface SetupStatusResponse {
  needsSetup: boolean;
}

export interface UserMetadata {
  userId: string;
  username: string;
  createdAt: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface CreateUserRequest {
  username: string;
  password: string;
}

export interface AuthSuccessResponse {
  user: UserMetadata;
}

// =============================================================================
// Provider Types - Task 18
// =============================================================================

export type ProviderType = 'openai' | 'openrouter' | 'ollama' | 'custom';

export interface ProviderSummary {
  providerId: string;
  providerType: ProviderType;
  displayName: string;
  enabled: boolean;
  configured: boolean;
  apiKeyLast4: string | null;
  baseUrl: string | null;
  selectedModel: string | null;
  source: string;
  lastTestStatus: string | null;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProviderRequest {
  providerType: ProviderType;
  displayName?: string;
  apiKey?: string;
  baseUrl?: string;
  selectedModel?: string;
}

export interface UpdateProviderRequest {
  displayName?: string;
  apiKey?: string;
  baseUrl?: string;
  selectedModel?: string;
  enabled?: boolean;
}

export interface TestProviderResponse {
  success: boolean;
  latencyMs: number;
  modelCount?: number;
  error?: string;
}

export interface SetModelRequest {
  providerId: string;
  model: string;
}

export interface ModelsResponse {
  providers: ProviderSummary[];
  selectedModel?: string;
  selectedProviderId?: string;
}

// =============================================================================
// Tool Catalog Types - Task 2
// =============================================================================

export type ToolCategory = 'read' | 'write' | 'delete' | 'execute' | 'search' | 'admin' | 'connector' | 'internal';
export type ToolSensitivity = 'low' | 'medium' | 'high' | 'restricted';

export interface ToolSummary {
  name: string;
  description: string;
  category: ToolCategory;
  sensitivity: ToolSensitivity;
}

export interface ToolsResponse {
  tools: ToolSummary[];
  total: number;
}
