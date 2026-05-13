import type {
  TestProviderResponse,
  ToolsResponse,
  ApiError,
  HealthResponse,
  SessionResponse,
  TranscriptsResponse,
  SendMessageRequest,
  SendMessageResponse,
  RunsResponse,
  ApprovalsResponse,
  ApprovalDetailResponse,
  ApprovalDecisionRequest,
  ApprovalDecisionResponse,
  SseRunEvent,
  SessionsResponse,
  UsageResponse,
  SessionUsageResponse,
  LogsResponse,
  DebugReplayResponse,
  ConsoleTimelineEvent,
  InstancesResponse,
  ChannelsResponse,
  SkillsResponse,
  SettingsResponse,
  SetupStatusResponse,
  AuthSuccessResponse,
  CreateUserRequest,
  LoginRequest,
  UserMetadata,
  ProviderSummary,
  CreateProviderRequest,
  UpdateProviderRequest,
  AgentConfig,
  AgentGlobalConfig,
  AgentUserOverride,
  UpdateAgentGlobalConfigRequest,
  UpdateAgentUserOverrideRequest,
  ResetAgentConfigOverrideResponse,
  ProcessingStatusPayload,
  TokenStreamPayload,
  WorkflowDraftResponse,
  WorkflowDefinitionResponse,
  WorkflowRunResponse,
  WorkflowValidationResult,
  WorkflowStep,
  MemoriesResponse,
  MemoryItem,
  MemoryDetailResponse,
  DeleteMemoryResponse,
  PlannerRunEventsResponse,
  PlannerRunSummaryResponse,
} from './types';

const API_BASE = '/api';

export interface ApiEnvelopeSuccess<T> {
  ok: true;
  data: T;
  requestId: string;
}

export interface ApiEnvelopeError {
  ok: false;
  error: { code: string; message: string; details?: unknown };
  requestId: string;
}

export type ApiEnvelope<T> = ApiEnvelopeSuccess<T> | ApiEnvelopeError;

class ApiClientError extends Error {
  code: string;
  details?: unknown;

  constructor(error: ApiError['error']) {
    super(error.message);
    this.name = 'ApiClientError';
    this.code = error.code;
    this.details = error.details;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new ApiClientError(errorBody.error || {
      code: 'UNKNOWN_ERROR',
      message: `HTTP ${response.status}: ${response.statusText}`,
    });
  }
  if (response.status === 204) return {} as T;
  const body = await response.json() as ApiEnvelope<T>;
  if ('ok' in body) {
    if (body.ok) {
      return body.data;
    }
    throw new ApiClientError(body.error);
  }
  return (body as { data: T }).data;
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE}/health`, { credentials: 'include' });
  return parseResponse<HealthResponse>(response);
}

export async function createSession(): Promise<SessionResponse> {
  const response = await fetch(`${API_BASE}/sessions`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return parseResponse<SessionResponse>(response);
}

export async function getSession(sessionId: string): Promise<SessionResponse> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}`, { credentials: 'include' });
  return parseResponse<SessionResponse>(response);
}

export async function getTranscripts(sessionId: string): Promise<TranscriptsResponse> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/transcripts`, { credentials: 'include' });
  return parseResponse<TranscriptsResponse>(response);
}

export async function sendMessage(
  sessionId: string,
  text: string
): Promise<SendMessageResponse> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/messages`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text } as SendMessageRequest),
  });
  return parseResponse<SendMessageResponse>(response);
}

export async function getRuns(): Promise<RunsResponse> {
  const response = await fetch(`${API_BASE}/runs`, { credentials: 'include' });
  return parseResponse<RunsResponse>(response);
}

export async function getApprovals(): Promise<ApprovalsResponse> {
  const response = await fetch(`${API_BASE}/approvals`, { credentials: 'include' });
  return parseResponse<ApprovalsResponse>(response);
}

export async function getApprovalDetail(approvalId: string): Promise<ApprovalDetailResponse> {
  const response = await fetch(`${API_BASE}/approvals/${approvalId}`, { credentials: 'include' });
  return parseResponse<ApprovalDetailResponse>(response);
}

export async function respondApproval(
  approvalId: string,
  decision: 'approved' | 'rejected',
  reason?: string
): Promise<ApprovalDecisionResponse> {
  const response = await fetch(`${API_BASE}/approvals/${approvalId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, reason } as ApprovalDecisionRequest),
  });
  return parseResponse<ApprovalDecisionResponse>(response);
}

export type RunEventCallback = (event: SseRunEvent) => void;
export type RunErrorCallback = (error: Error) => void;

export function subscribeRuns(
  onEvent: RunEventCallback,
  onError?: RunErrorCallback
): () => void {
  const eventSource = new EventSource(`${API_BASE}/runs/stream`, { withCredentials: true });

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as SseRunEvent;
      onEvent(data);
    } catch (err) {
      onError?.(new Error('Failed to parse SSE event'));
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
    onError?.(new Error('SSE connection failed'));
  };

  return () => {
    eventSource.close();
  };
}

export async function getSessions(
  status?: string,
  limit?: number,
  offset?: number
): Promise<SessionsResponse> {
  const params = new URLSearchParams();
  if (status) params.append('status', status);
  if (limit !== undefined) params.append('limit', String(limit));
  if (offset !== undefined) params.append('offset', String(offset));
  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${API_BASE}/sessions${query}`, { credentials: 'include' });
  const result = await parseResponse<{ items: SessionsResponse['sessions']; total: number; limit: number; offset: number; hasMore: boolean }>(response);
  return { sessions: result.items, total: result.total };
}

export async function updateSession(
  sessionId: string,
  updates: { title?: string; status?: 'active' | 'archived' | 'closed' }
): Promise<SessionResponse> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return parseResponse<SessionResponse>(response);
}

export async function getUsage(
  sessionId?: string,
  limit?: number,
  offset?: number
): Promise<UsageResponse> {
  const params = new URLSearchParams();
  if (sessionId) params.append('sessionId', sessionId);
  if (limit !== undefined) params.append('limit', String(limit));
  if (offset !== undefined) params.append('offset', String(offset));
  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${API_BASE}/usage${query}`, { credentials: 'include' });
  const result = await parseResponse<{ items: UsageResponse['usages']; total: number }>(response);
  return { usages: result.items, total: result.total };
}

export async function getSessionUsage(sessionId: string): Promise<SessionUsageResponse> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/usage`, { credentials: 'include' });
  const usage = await parseResponse<SessionUsageResponse['usage']>(response);
  return { usage };
}

export async function getLogs(
  sessionId?: string,
  sourceModule?: string,
  eventType?: string,
  limit?: number,
  offset?: number,
  runRef?: string
): Promise<LogsResponse> {
  const params = new URLSearchParams();
  if (sessionId) params.append('sessionId', sessionId);
  if (sourceModule) params.append('sourceModule', sourceModule);
  if (eventType) params.append('eventType', eventType);
  if (runRef) params.append('runRef', runRef);
  if (limit !== undefined) params.append('limit', String(limit));
  if (offset !== undefined) params.append('offset', String(offset));
  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${API_BASE}/logs${query}`, { credentials: 'include' });
  const result = await parseResponse<{ items: LogsResponse['logs']; total: number }>(response);
  return { logs: result.items, total: result.total };
}

export async function getDebugReplay(sessionId: string): Promise<DebugReplayResponse> {
  const response = await fetch(`${API_BASE}/debug/replay/${sessionId}`, { credentials: 'include' });
  return parseResponse<DebugReplayResponse>(response);
}

export async function getSessionTimeline(
  sessionId: string,
  limit?: number,
  offset?: number
): Promise<{ events: ConsoleTimelineEvent[]; total: number }> {
  const params = new URLSearchParams();
  if (limit !== undefined) params.append('limit', String(limit));
  if (offset !== undefined) params.append('offset', String(offset));
  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/timeline${query}`, { credentials: 'include' });
  const result = await parseResponse<{ items: ConsoleTimelineEvent[]; total: number }>(response);
  return { events: result.items, total: result.total };
}

export async function getInstances(): Promise<InstancesResponse> {
  const response = await fetch(`${API_BASE}/instances`, { credentials: 'include' });
  return parseResponse<InstancesResponse>(response);
}

export async function getChannels(): Promise<ChannelsResponse> {
  const response = await fetch(`${API_BASE}/channels`, { credentials: 'include' });
  return parseResponse<ChannelsResponse>(response);
}

export async function getSkills(): Promise<SkillsResponse> {
  const response = await fetch(`${API_BASE}/skills`, { credentials: 'include' });
  return parseResponse<SkillsResponse>(response);
}

export async function getSettings(): Promise<SettingsResponse> {
  const response = await fetch(`${API_BASE}/settings`, { credentials: 'include' });
  return parseResponse<SettingsResponse>(response);
}

export type SessionTimelineEventCallback = (event: ConsoleTimelineEvent) => void;
export type SessionTimelineErrorCallback = (error: Error) => void;
export type SessionTimelineStatusCallback = (status: ProcessingStatusPayload) => void;
export type SessionTimelineTokenCallback = (token: TokenStreamPayload) => void;

type SseEnvelope =
  | { type: 'snapshot'; events: ConsoleTimelineEvent[]; timestamp: string }
  | { type: 'heartbeat'; timestamp: string }
  | { type: 'timeline_event'; event: ConsoleTimelineEvent; timestamp: string }
  | { type: 'processing_status'; status: ProcessingStatusPayload }
  | { type: 'token_stream'; token: TokenStreamPayload };

export function subscribeSessionTimeline(
  sessionId: string,
  onEvent: SessionTimelineEventCallback,
  onError?: SessionTimelineErrorCallback,
  onStatus?: SessionTimelineStatusCallback,
  onToken?: SessionTimelineTokenCallback
): () => void {
  const eventSource = new EventSource(`${API_BASE}/sessions/${sessionId}/timeline/stream`, { withCredentials: true });

  eventSource.onmessage = (event) => {
    try {
      const envelope = JSON.parse(event.data) as SseEnvelope;

      switch (envelope.type) {
        case 'snapshot':
          for (const e of envelope.events) {
            onEvent(e);
          }
          break;
        case 'timeline_event':
          onEvent(envelope.event);
          break;
        case 'processing_status':
          onStatus?.(envelope.status);
          break;
        case 'token_stream':
          onToken?.(envelope.token);
          break;
        case 'heartbeat':
          break;
      }
    } catch (err) {
      onError?.(new Error('Failed to parse SSE event'));
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
    onError?.(new Error('SSE connection failed'));
  };

  return () => {
    eventSource.close();
  };
}

export async function getSetupStatus(): Promise<SetupStatusResponse> {
  const response = await fetch(`${API_BASE}/setup/status`, { credentials: 'include' });
  return parseResponse<SetupStatusResponse>(response);
}

export async function setupUser(username: string, password: string): Promise<AuthSuccessResponse> {
  const response = await fetch(`${API_BASE}/setup/user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password } as CreateUserRequest),
  });
  return parseResponse<AuthSuccessResponse>(response);
}

export async function login(username: string, password: string): Promise<AuthSuccessResponse> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password } as LoginRequest),
  });
  return parseResponse<AuthSuccessResponse>(response);
}

export async function logout(): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });
  return parseResponse<{ success: boolean }>(response);
}

export async function getMe(): Promise<{ user: UserMetadata }> {
  const response = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' });
  return parseResponse<{ user: UserMetadata }>(response);
}

export async function getProviders(): Promise<ProviderSummary[]> {
  const response = await fetch(`${API_BASE}/providers`, { credentials: 'include' });
  return parseResponse<ProviderSummary[]>(response);
}

export async function createProvider(request: CreateProviderRequest): Promise<ProviderSummary> {
  const response = await fetch(`${API_BASE}/providers`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  return parseResponse<ProviderSummary>(response);
}

export async function updateProvider(
  providerId: string,
  request: UpdateProviderRequest
): Promise<ProviderSummary> {
  const response = await fetch(`${API_BASE}/providers/${providerId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  return parseResponse<ProviderSummary>(response);
}

export async function deleteProvider(providerId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/providers/${providerId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new ApiClientError(errorBody.error || {
      code: 'UNKNOWN_ERROR',
      message: `HTTP ${response.status}: ${response.statusText}`,
    });
  }
}

export async function testProvider(providerId: string): Promise<TestProviderResponse> {
  const response = await fetch(`${API_BASE}/providers/${providerId}/test`, {
    method: 'POST',
    credentials: 'include',
  });
  return parseResponse<TestProviderResponse>(response);
}

export async function getTools(): Promise<ToolsResponse> {
  const response = await fetch(`${API_BASE}/tools`, { credentials: 'include' });
  return parseResponse<ToolsResponse>(response);
}

// =============================================================================
// AgentConfig API - Task 3 (Wave 1)
// =============================================================================

export async function getAgentConfig(agentId: string): Promise<AgentConfig> {
  const response = await fetch(`${API_BASE}/agents/${agentId}/config`, {
    credentials: 'include',
  });
  return parseResponse<AgentConfig>(response);
}

export async function updateAgentConfig(
  agentId: string,
  scope: 'global' | 'override',
  request: UpdateAgentGlobalConfigRequest | UpdateAgentUserOverrideRequest
): Promise<AgentGlobalConfig | AgentUserOverride> {
  const response = await fetch(`${API_BASE}/agents/${agentId}/config/${scope}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  return parseResponse<AgentGlobalConfig | AgentUserOverride>(response);
}

export async function resetAgentConfigOverride(
  agentId: string
): Promise<ResetAgentConfigOverrideResponse> {
  const response = await fetch(`${API_BASE}/agents/${agentId}/config/override`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (response.status === 204) {
    return { success: true };
  }
  return parseResponse<ResetAgentConfigOverrideResponse>(response);
}

export { ApiClientError };

// =============================================================================
// Workflow API - Task 3 (P0-5 Builder UI)
// =============================================================================

export async function listWorkflowDrafts(): Promise<WorkflowDraftResponse[]> {
  const response = await fetch(`${API_BASE}/workflows/drafts`, { credentials: 'include' });
  return parseResponse<WorkflowDraftResponse[]>(response);
}

export async function getWorkflowDraft(draftId: string): Promise<WorkflowDraftResponse> {
  const response = await fetch(`${API_BASE}/workflows/drafts/${draftId}`, { credentials: 'include' });
  return parseResponse<WorkflowDraftResponse>(response);
}

export async function createWorkflowDraft(payload: {
  name: string;
  description?: string;
  steps: WorkflowStep[];
}): Promise<WorkflowDraftResponse> {
  const response = await fetch(`${API_BASE}/workflows/drafts`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseResponse<WorkflowDraftResponse>(response);
}

export async function updateWorkflowDraft(
  draftId: string,
  payload: { name?: string; description?: string; steps?: WorkflowStep[] }
): Promise<WorkflowDraftResponse> {
  const response = await fetch(`${API_BASE}/workflows/drafts/${draftId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseResponse<WorkflowDraftResponse>(response);
}

export async function validateWorkflowDraft(draftId: string): Promise<WorkflowValidationResult> {
  const response = await fetch(`${API_BASE}/workflows/drafts/${draftId}/validate`, {
    method: 'POST',
    credentials: 'include',
  });
  return parseResponse<WorkflowValidationResult>(response);
}

export async function publishWorkflowDraft(draftId: string): Promise<WorkflowDefinitionResponse> {
  const response = await fetch(`${API_BASE}/workflows/drafts/${draftId}/publish`, {
    method: 'POST',
    credentials: 'include',
  });
  return parseResponse<WorkflowDefinitionResponse>(response);
}

export async function startWorkflowRun(
  definitionId: string,
  inputData?: Record<string, unknown>
): Promise<WorkflowRunResponse> {
  const response = await fetch(`${API_BASE}/workflows/runs`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ definitionId, inputData }),
  });
  return parseResponse<WorkflowRunResponse>(response);
}

export async function listWorkflowDefinitions(): Promise<WorkflowDefinitionResponse[]> {
  const response = await fetch(`${API_BASE}/workflows/definitions`, { credentials: 'include' });
  return parseResponse<WorkflowDefinitionResponse[]>(response);
}

// Memory API
export async function getMemories(params?: { query?: string; type?: string; limit?: number }): Promise<MemoriesResponse> {
  const searchParams = new URLSearchParams();
  if (params?.query) searchParams.set('query', params.query);
  if (params?.type) searchParams.set('type', params.type);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const qs = searchParams.toString();
  const response = await fetch(`${API_BASE}/memory${qs ? `?${qs}` : ''}`, { credentials: 'include' });
  return parseResponse<MemoriesResponse>(response);
}

export async function getMemory(memoryId: string): Promise<MemoryItem> {
  const response = await fetch(`${API_BASE}/memory/${encodeURIComponent(memoryId)}`, { credentials: 'include' });
  const detail = await parseResponse<MemoryDetailResponse>(response);
  return detail.memory;
}

export async function deleteMemory(memoryId: string): Promise<DeleteMemoryResponse> {
  const response = await fetch(`${API_BASE}/memory/${encodeURIComponent(memoryId)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  return parseResponse<DeleteMemoryResponse>(response);
}

export async function getPlannerRunEvents(plannerRunId: string): Promise<PlannerRunEventsResponse> {
  const response = await fetch(`${API_BASE}/planner-runs/${plannerRunId}/events`, { credentials: 'include' });
  return parseResponse<PlannerRunEventsResponse>(response);
}

export async function getPlannerRunSummary(plannerRunId: string): Promise<PlannerRunSummaryResponse> {
  const response = await fetch(`${API_BASE}/planner-runs/${plannerRunId}/summary`, { credentials: 'include' });
  return parseResponse<PlannerRunSummaryResponse>(response);
}
