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
  SubagentDefinitionsResponse,
  SubagentPreferenceResponse,
  UpdateSubagentPreferenceRequest,
  ReadinessResponse,
  CreateTodoRequest,
  UpdateTodoRequest,
  TodosResponse,
  TodoResponse,
  DeleteTodoResponse,
  FileUploadMetadata,
  FileUploadResponse,
  FileListResponse,
  WorkdirsResponse,
  WorkdirResponse,
  DeleteWorkdirResponse,
  SessionWorkdirResponse,
  ClearSessionWorkdirResponse,
  WorkdirTreeResponse,
  WorkdirFileContent,
  WriteWorkdirFileRequest,
  WriteWorkdirFileResponse,
  MoveWorkdirEntryRequest,
  MoveWorkdirEntryResponse,
  DeleteWorkdirEntryResponse,
  UploadWorkdirFileRequest,
  UploadWorkdirFileResponse,
  CreateWorkdirDirResponse,
  BrowserStatusResponse,
  BrowserTakeoverResponse,
  BrowserReleaseResponse,
  BrowserInputRequest,
  BrowserInputResponse,
  BrowserStreamEvent,
} from './types'

const API_BASE = '/api/v1'

export interface ApiEnvelopeSuccess<T> {
  ok: true
  data: T
  requestId: string
}

export interface ApiEnvelopeError {
  ok: false
  error: { code: string; message: string; details?: unknown }
  requestId: string
}

export type ApiEnvelope<T> = ApiEnvelopeSuccess<T> | ApiEnvelopeError

const DEFAULT_REQUEST_TIMEOUT_MS = 30000

const SSE_RECONNECT_BASE_DELAY_MS = 1000
const SSE_RECONNECT_MAX_DELAY_MS = 30000

async function fetchWithTimeout(
  url: string,
  init?: RequestInit & { timeout?: number },
): Promise<Response> {
  const { timeout = DEFAULT_REQUEST_TIMEOUT_MS, signal: externalSignal, ...rest } = init ?? {}
  const controller = new AbortController()

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort()
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true })
    }
  }

  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    return await fetch(url, { ...rest, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

class ApiClientError extends Error {
  code: string
  status?: number
  details?: unknown

  constructor(error: ApiError['error'], status?: number) {
    super(error.message)
    this.name = 'ApiClientError'
    this.code = error.code
    this.status = status
    this.details = error.details
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    throw new ApiClientError(
      errorBody.error || {
        code: 'UNKNOWN_ERROR',
        message: `HTTP ${response.status}: ${response.statusText}`,
      },
      response.status,
    )
  }
  if (response.status === 204) return {} as T
  const body = (await response.json()) as ApiEnvelope<T>
  if ('ok' in body) {
    if (body.ok) {
      return body.data
    }
    throw new ApiClientError(body.error, response.status)
  }
  return (body as { data: T }).data
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/health`, { credentials: 'include' })
  return parseResponse<HealthResponse>(response)
}

export async function createSession(): Promise<SessionResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/sessions`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  return parseResponse<SessionResponse>(response)
}

export async function getSession(sessionId: string): Promise<SessionResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/sessions/${sessionId}`, { credentials: 'include' })
  return parseResponse<SessionResponse>(response)
}

export async function getTranscripts(sessionId: string): Promise<TranscriptsResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/sessions/${sessionId}/transcripts`, { credentials: 'include' })
  return parseResponse<TranscriptsResponse>(response)
}

export async function sendMessage(
  sessionId: string,
  text: string,
  attachmentIds?: string[],
): Promise<SendMessageResponse> {
  const payload: SendMessageRequest & { attachmentIds?: string[] } = { text }
  if (attachmentIds && attachmentIds.length > 0) {
    payload.attachmentIds = attachmentIds
  }
  const response = await fetchWithTimeout(`${API_BASE}/sessions/${sessionId}/messages`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parseResponse<SendMessageResponse>(response)
}

export async function getRuns(): Promise<RunsResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/runs`, { credentials: 'include' })
  return parseResponse<RunsResponse>(response)
}

export async function getApprovals(): Promise<ApprovalsResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/approvals`, { credentials: 'include' })
  return parseResponse<ApprovalsResponse>(response)
}

export async function getApprovalDetail(approvalId: string): Promise<ApprovalDetailResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/approvals/${approvalId}`, { credentials: 'include' })
  return parseResponse<ApprovalDetailResponse>(response)
}

export async function respondApproval(
  approvalId: string,
  response: 'approved' | 'rejected' | 'approve_once' | 'approve_always' | 'reject',
  reason?: string,
): Promise<ApprovalDecisionResponse> {
  let requestBody: ApprovalDecisionRequest

  if (response === 'approved') {
    requestBody = { decision: 'approved', responseType: 'approve_once', reason }
  } else if (response === 'rejected') {
    requestBody = { decision: 'rejected', responseType: 'reject', reason }
  } else {
    requestBody = { responseType: response, reason }
  }

  const httpResponse = await fetchWithTimeout(`${API_BASE}/approvals/${approvalId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  })
  return parseResponse<ApprovalDecisionResponse>(httpResponse)
}

export type RunEventCallback = (event: SseRunEvent) => void
export type RunErrorCallback = (error: Error) => void

export function subscribeRuns(onEvent: RunEventCallback, onError?: RunErrorCallback): () => void {
  let eventSource: EventSource | null = null
  let reconnectAttempts = 0
  let reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null
  let closed = false

  const connect = () => {
    if (closed) return

    eventSource = new EventSource(`${API_BASE}/runs/stream`, { withCredentials: true })

    eventSource.onmessage = (event) => {
      reconnectAttempts = 0
      try {
        const data = JSON.parse(event.data) as SseRunEvent
        onEvent(data)
      } catch {
        onError?.(new Error('Failed to parse SSE event'))
      }
    }

    eventSource.onerror = () => {
      if (closed) return
      eventSource?.close()
      eventSource = null
      const delay = Math.min(
        SSE_RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts,
        SSE_RECONNECT_MAX_DELAY_MS,
      )
      reconnectAttempts += 1
      reconnectTimeoutId = setTimeout(connect, delay)
    }
  }

  connect()

  return () => {
    closed = true
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId)
      reconnectTimeoutId = null
    }
    eventSource?.close()
    eventSource = null
  }
}

export async function getSessions(status?: string, limit?: number, offset?: number): Promise<SessionsResponse> {
  const params = new URLSearchParams()
  if (status) params.append('status', status)
  if (limit !== undefined) params.append('limit', String(limit))
  if (offset !== undefined) params.append('offset', String(offset))
  const query = params.toString() ? `?${params.toString()}` : ''
  const response = await fetchWithTimeout(`${API_BASE}/sessions${query}`, { credentials: 'include' })
  const result = await parseResponse<{
    items: SessionsResponse['sessions']
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }>(response)
  return { sessions: result.items, total: result.total }
}

export async function updateSession(
  sessionId: string,
  updates: { title?: string; status?: 'active' | 'archived' | 'closed' },
): Promise<SessionResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/sessions/${sessionId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  return parseResponse<SessionResponse>(response)
}

export async function getUsage(sessionId?: string, limit?: number, offset?: number): Promise<UsageResponse> {
  const params = new URLSearchParams()
  if (sessionId) params.append('sessionId', sessionId)
  if (limit !== undefined) params.append('limit', String(limit))
  if (offset !== undefined) params.append('offset', String(offset))
  const query = params.toString() ? `?${params.toString()}` : ''
  const response = await fetchWithTimeout(`${API_BASE}/usage${query}`, { credentials: 'include' })
  const result = await parseResponse<{ items: UsageResponse['usages']; total: number }>(response)
  return { usages: result.items, total: result.total }
}

export async function getSessionUsage(sessionId: string): Promise<SessionUsageResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/sessions/${sessionId}/usage`, { credentials: 'include' })
  const usage = await parseResponse<SessionUsageResponse['usage']>(response)
  return { usage }
}

export async function getLogs(
  sessionId?: string,
  sourceModule?: string,
  eventType?: string,
  limit?: number,
  offset?: number,
  runRef?: string,
): Promise<LogsResponse> {
  const params = new URLSearchParams()
  if (sessionId) params.append('sessionId', sessionId)
  if (sourceModule) params.append('sourceModule', sourceModule)
  if (eventType) params.append('eventType', eventType)
  if (runRef) params.append('runRef', runRef)
  if (limit !== undefined) params.append('limit', String(limit))
  if (offset !== undefined) params.append('offset', String(offset))
  const query = params.toString() ? `?${params.toString()}` : ''
  const response = await fetchWithTimeout(`${API_BASE}/logs${query}`, { credentials: 'include' })
  const result = await parseResponse<{ items: LogsResponse['logs']; total: number }>(response)
  return { logs: result.items, total: result.total }
}

export async function getDebugReplay(sessionId: string): Promise<DebugReplayResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/debug/replay/${sessionId}`, { credentials: 'include' })
  return parseResponse<DebugReplayResponse>(response)
}

export async function getSessionTimeline(
  sessionId: string,
  limit?: number,
  offset?: number,
): Promise<{ events: ConsoleTimelineEvent[]; total: number }> {
  const params = new URLSearchParams()
  if (limit !== undefined) params.append('limit', String(limit))
  if (offset !== undefined) params.append('offset', String(offset))
  const query = params.toString() ? `?${params.toString()}` : ''
  const response = await fetchWithTimeout(`${API_BASE}/sessions/${sessionId}/timeline${query}`, { credentials: 'include' })
  const result = await parseResponse<{ items: ConsoleTimelineEvent[]; total: number }>(response)
  return { events: result.items, total: result.total }
}

export async function getInstances(): Promise<InstancesResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/instances`, { credentials: 'include' })
  return parseResponse<InstancesResponse>(response)
}

export async function getChannels(): Promise<ChannelsResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/channels`, { credentials: 'include' })
  return parseResponse<ChannelsResponse>(response)
}

export async function getSkills(): Promise<SkillsResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/skills`, { credentials: 'include' })
  return parseResponse<SkillsResponse>(response)
}

export async function getSettings(): Promise<SettingsResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/settings`, { credentials: 'include' })
  return parseResponse<SettingsResponse>(response)
}

export type SessionTimelineEventCallback = (event: ConsoleTimelineEvent) => void
export type SessionTimelineErrorCallback = (error: Error) => void
export type SessionTimelineStatusCallback = (status: ProcessingStatusPayload) => void
export type SessionTimelineTokenCallback = (token: TokenStreamPayload) => void
export type SessionTimelineOpenCallback = () => void

type SseEnvelope =
  | { type: 'snapshot'; events: ConsoleTimelineEvent[]; timestamp: string }
  | { type: 'heartbeat'; timestamp: string }
  | { type: 'timeline_event'; event: ConsoleTimelineEvent; timestamp: string }
  | { type: 'processing_status'; status: ProcessingStatusPayload }
  | { type: 'token_stream'; token: TokenStreamPayload }

export function subscribeSessionTimeline(
  sessionId: string,
  onEvent: SessionTimelineEventCallback,
  onError?: SessionTimelineErrorCallback,
  onStatus?: SessionTimelineStatusCallback,
  onToken?: SessionTimelineTokenCallback,
  onOpen?: SessionTimelineOpenCallback,
): () => void {
  let eventSource: EventSource | null = null
  let reconnectAttempts = 0
  let reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null
  let closed = false

  const connect = () => {
    if (closed) return

    eventSource = new EventSource(`${API_BASE}/sessions/${sessionId}/timeline/stream`, { withCredentials: true })

    eventSource.onopen = () => {
      reconnectAttempts = 0
      onOpen?.()
    }

    eventSource.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data) as SseEnvelope

        switch (envelope.type) {
          case 'snapshot':
            for (const e of envelope.events) {
              onEvent(e)
            }
            break
          case 'timeline_event':
            onEvent(envelope.event)
            break
          case 'processing_status':
            onStatus?.(envelope.status)
            break
          case 'token_stream':
            onToken?.(envelope.token)
            break
          case 'heartbeat':
            break
        }
      } catch {
        onError?.(new Error('Failed to parse SSE event'))
      }
    }

    eventSource.onerror = () => {
      if (closed) return
      eventSource?.close()
      eventSource = null
      const delay = Math.min(
        SSE_RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts,
        SSE_RECONNECT_MAX_DELAY_MS,
      )
      reconnectAttempts += 1
      reconnectTimeoutId = setTimeout(connect, delay)
    }
  }

  connect()

  return () => {
    closed = true
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId)
      reconnectTimeoutId = null
    }
    eventSource?.close()
    eventSource = null
  }
}

export async function getSetupStatus(): Promise<SetupStatusResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/setup/status`, { credentials: 'include' })
  return parseResponse<SetupStatusResponse>(response)
}

export async function getReadiness(): Promise<ReadinessResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/setup/readiness`, { credentials: 'include' })
  return parseResponse<ReadinessResponse>(response)
}

export async function setupUser(username: string, password: string): Promise<AuthSuccessResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/setup/user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password } as CreateUserRequest),
  })
  return parseResponse<AuthSuccessResponse>(response)
}

export async function login(username: string, password: string): Promise<AuthSuccessResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password } as LoginRequest),
  })
  return parseResponse<AuthSuccessResponse>(response)
}

export async function logout(): Promise<{ success: boolean }> {
  const response = await fetchWithTimeout(`${API_BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  })
  return parseResponse<{ success: boolean }>(response)
}

export async function getMe(): Promise<{ user: UserMetadata | null }> {
  const response = await fetchWithTimeout(`${API_BASE}/auth/me`, { credentials: 'include' })
  if (response.status === 401) {
    return { user: null }
  }
  return parseResponse<{ user: UserMetadata }>(response)
}

export async function getProviders(): Promise<ProviderSummary[]> {
  const response = await fetchWithTimeout(`${API_BASE}/providers`, { credentials: 'include' })
  return parseResponse<ProviderSummary[]>(response)
}

export async function createProvider(request: CreateProviderRequest): Promise<ProviderSummary> {
  const response = await fetchWithTimeout(`${API_BASE}/providers`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  return parseResponse<ProviderSummary>(response)
}

export async function updateProvider(providerId: string, request: UpdateProviderRequest): Promise<ProviderSummary> {
  const response = await fetchWithTimeout(`${API_BASE}/providers/${providerId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  return parseResponse<ProviderSummary>(response)
}

export async function deleteProvider(providerId: string): Promise<void> {
  const response = await fetchWithTimeout(`${API_BASE}/providers/${providerId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    throw new ApiClientError(
      errorBody.error || {
        code: 'UNKNOWN_ERROR',
        message: `HTTP ${response.status}: ${response.statusText}`,
      },
    )
  }
}

export async function testProvider(providerId: string): Promise<TestProviderResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/providers/${providerId}/test`, {
    method: 'POST',
    credentials: 'include',
  })
  return parseResponse<TestProviderResponse>(response)
}

export async function getTools(): Promise<ToolsResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/tools`, { credentials: 'include' })
  return parseResponse<ToolsResponse>(response)
}

// =============================================================================
// AgentConfig API - Task 3 (Wave 1)
// =============================================================================

export async function getAgentConfig(agentId: string): Promise<AgentConfig> {
  const response = await fetchWithTimeout(`${API_BASE}/agents/${agentId}/config`, {
    credentials: 'include',
  })
  return parseResponse<AgentConfig>(response)
}

export async function updateAgentConfig(
  agentId: string,
  scope: 'global' | 'override',
  request: UpdateAgentGlobalConfigRequest | UpdateAgentUserOverrideRequest,
): Promise<AgentGlobalConfig | AgentUserOverride> {
  const response = await fetchWithTimeout(`${API_BASE}/agents/${agentId}/config/${scope}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  return parseResponse<AgentGlobalConfig | AgentUserOverride>(response)
}

export async function resetAgentConfigOverride(agentId: string): Promise<ResetAgentConfigOverrideResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/agents/${agentId}/config/override`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (response.status === 204) {
    return { success: true }
  }
  return parseResponse<ResetAgentConfigOverrideResponse>(response)
}

export { ApiClientError }

// =============================================================================
// Workflow API - Task 3 (P0-5 Builder UI)
// =============================================================================

export async function listWorkflowDrafts(): Promise<WorkflowDraftResponse[]> {
  const response = await fetchWithTimeout(`${API_BASE}/workflows/drafts`, { credentials: 'include' })
  return parseResponse<WorkflowDraftResponse[]>(response)
}

export async function getWorkflowDraft(draftId: string): Promise<WorkflowDraftResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/workflows/drafts/${draftId}`, { credentials: 'include' })
  return parseResponse<WorkflowDraftResponse>(response)
}

export async function createWorkflowDraft(payload: {
  name: string
  description?: string
  steps: WorkflowStep[]
}): Promise<WorkflowDraftResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/workflows/drafts`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parseResponse<WorkflowDraftResponse>(response)
}

export async function updateWorkflowDraft(
  draftId: string,
  payload: { name?: string; description?: string; steps?: WorkflowStep[] },
): Promise<WorkflowDraftResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/workflows/drafts/${draftId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parseResponse<WorkflowDraftResponse>(response)
}

export async function validateWorkflowDraft(draftId: string): Promise<WorkflowValidationResult> {
  const response = await fetchWithTimeout(`${API_BASE}/workflows/drafts/${draftId}/validate`, {
    method: 'POST',
    credentials: 'include',
  })
  return parseResponse<WorkflowValidationResult>(response)
}

export async function publishWorkflowDraft(draftId: string): Promise<WorkflowDefinitionResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/workflows/drafts/${draftId}/publish`, {
    method: 'POST',
    credentials: 'include',
  })
  return parseResponse<WorkflowDefinitionResponse>(response)
}

export async function startWorkflowRun(
  definitionId: string,
  inputData?: Record<string, unknown>,
): Promise<WorkflowRunResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/workflows/runs`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ definitionId, inputData }),
  })
  return parseResponse<WorkflowRunResponse>(response)
}

export async function listWorkflowDefinitions(): Promise<WorkflowDefinitionResponse[]> {
  const response = await fetchWithTimeout(`${API_BASE}/workflows/definitions`, { credentials: 'include' })
  return parseResponse<WorkflowDefinitionResponse[]>(response)
}

// Memory API
export async function getMemories(params?: {
  query?: string
  type?: string
  limit?: number
}): Promise<MemoriesResponse> {
  const searchParams = new URLSearchParams()
  if (params?.query) searchParams.set('query', params.query)
  if (params?.type) searchParams.set('type', params.type)
  if (params?.limit) searchParams.set('limit', String(params.limit))
  const qs = searchParams.toString()
  const response = await fetchWithTimeout(`${API_BASE}/memory${qs ? `?${qs}` : ''}`, { credentials: 'include' })
  return parseResponse<MemoriesResponse>(response)
}

export async function getMemory(memoryId: string): Promise<MemoryItem> {
  const response = await fetchWithTimeout(`${API_BASE}/memory/${encodeURIComponent(memoryId)}`, { credentials: 'include' })
  const detail = await parseResponse<MemoryDetailResponse>(response)
  return detail.memory
}

export async function deleteMemory(memoryId: string): Promise<DeleteMemoryResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/memory/${encodeURIComponent(memoryId)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return parseResponse<DeleteMemoryResponse>(response)
}

export async function getPlannerRunEvents(plannerRunId: string): Promise<PlannerRunEventsResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/planner-runs/${plannerRunId}/events`, { credentials: 'include' })
  return parseResponse<PlannerRunEventsResponse>(response)
}

export async function getPlannerRunSummary(plannerRunId: string): Promise<PlannerRunSummaryResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/planner-runs/${plannerRunId}/summary`, { credentials: 'include' })
  return parseResponse<PlannerRunSummaryResponse>(response)
}

export async function getSubagentDefinitions(): Promise<SubagentDefinitionsResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/subagents`, { credentials: 'include' })
  const definitions = await parseResponse<SubagentDefinitionsResponse['definitions']>(response)
  return { definitions }
}

export async function getSubagentPreference(subagentType: string): Promise<SubagentPreferenceResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/subagents/${encodeURIComponent(subagentType)}/preference`, {
    credentials: 'include',
  })
  return parseResponse<SubagentPreferenceResponse>(response)
}

export async function updateSubagentPreference(
  subagentType: string,
  request: UpdateSubagentPreferenceRequest,
): Promise<SubagentPreferenceResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/subagents/${encodeURIComponent(subagentType)}/preference`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  return parseResponse<SubagentPreferenceResponse>(response)
}

export async function resetSubagentPreference(subagentType: string): Promise<void> {
  const response = await fetchWithTimeout(`${API_BASE}/subagents/${encodeURIComponent(subagentType)}/preference`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    throw new ApiClientError(
      errorBody.error || {
        code: 'UNKNOWN_ERROR',
        message: `HTTP ${response.status}: ${response.statusText}`,
      },
    )
  }
}

export async function listTodos(sessionId: string, ownerAgentId?: string): Promise<TodosResponse> {
  const params = new URLSearchParams()
  if (ownerAgentId) params.set('ownerAgentId', ownerAgentId)
  const query = params.toString() ? `?${params.toString()}` : ''
  const response = await fetchWithTimeout(`${API_BASE}/sessions/${sessionId}/todos${query}`, {
    credentials: 'include',
  })
  return parseResponse<TodosResponse>(response)
}

export async function createSessionTodo(
  sessionId: string,
  data: CreateTodoRequest,
): Promise<TodoResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/sessions/${sessionId}/todos`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return parseResponse<TodoResponse>(response)
}

export async function updateSessionTodo(
  sessionId: string,
  todoId: string,
  data: UpdateTodoRequest,
): Promise<TodoResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/sessions/${sessionId}/todos/${todoId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return parseResponse<TodoResponse>(response)
}

export async function deleteSessionTodo(
  sessionId: string,
  todoId: string,
): Promise<DeleteTodoResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/sessions/${sessionId}/todos/${todoId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return parseResponse<DeleteTodoResponse>(response)
}

export interface TodoItemWithChildren {
  todoId: string
  sessionId: string
  tenantId?: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'high' | 'medium' | 'low'
  parentTodoId?: string | null
  position: number
  ownerAgentId?: string
  createdAt: string
  updatedAt: string
  children?: TodoItemWithChildren[]
}

export async function getTodos(): Promise<{ todos: TodoItemWithChildren[]; total: number }> {
  const response = await fetchWithTimeout(`${API_BASE}/todos`, {
    credentials: 'include',
  })
  return parseResponse<{ todos: TodoItemWithChildren[]; total: number }>(response)
}

export async function createTodo(data: {
  content: string
  priority?: 'high' | 'medium' | 'low'
  parentTodoId?: string
}): Promise<TodoItemWithChildren> {
  const response = await fetchWithTimeout(`${API_BASE}/todos`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const result = await parseResponse<{ todo: TodoItemWithChildren }>(response)
  return result.todo
}

export async function updateTodo(
  todoId: string,
  data: {
    content?: string
    status?: 'pending' | 'in_progress' | 'completed' | 'cancelled'
    priority?: 'high' | 'medium' | 'low'
  },
): Promise<TodoItemWithChildren> {
  const response = await fetchWithTimeout(`${API_BASE}/todos/${todoId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const result = await parseResponse<{ todo: TodoItemWithChildren }>(response)
  return result.todo
}

export async function deleteTodo(todoId: string): Promise<{ success: boolean; deletedCount: number }> {
  const response = await fetchWithTimeout(`${API_BASE}/todos/${todoId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return parseResponse<{ success: boolean; deletedCount: number }>(response)
}

// =============================================================================
// File Upload API - Session Attachments
// =============================================================================

export async function uploadSessionFile(sessionId: string, file: File): Promise<FileUploadMetadata> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await fetchWithTimeout(`${API_BASE}/sessions/${sessionId}/files`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  })
  const body = await parseResponse<FileUploadResponse>(response)
  return body.file
}

export async function listSessionFiles(sessionId: string): Promise<FileUploadMetadata[]> {
  const response = await fetchWithTimeout(`${API_BASE}/sessions/${sessionId}/files`, {
    credentials: 'include',
  })
  const body = await parseResponse<FileListResponse>(response)
  return body.files
}

export async function getFileMetadata(fileId: string): Promise<FileUploadMetadata> {
  const response = await fetchWithTimeout(`${API_BASE}/files/${encodeURIComponent(fileId)}`, {
    credentials: 'include',
  })
  const body = await parseResponse<FileUploadResponse>(response)
  return body.file
}

export async function deleteFile(fileId: string): Promise<void> {
  const response = await fetchWithTimeout(`${API_BASE}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    throw new ApiClientError(
      errorBody.error || {
        code: 'UNKNOWN_ERROR',
        message: `HTTP ${response.status}: ${response.statusText}`,
      },
    )
  }
}

export function getFileDownloadUrl(fileId: string): string {
  return `${API_BASE}/files/${encodeURIComponent(fileId)}/download`
}

export function downloadFile(fileId: string): void {
  const url = getFileDownloadUrl(fileId)
  window.open(url, '_blank')
}

// =============================================================================
// Workdir API - User Session Workdirs
// =============================================================================

export async function listWorkdirs(): Promise<WorkdirsResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/workdirs`, { credentials: 'include' })
  return parseResponse<WorkdirsResponse>(response)
}

export async function createWorkdir(name: string): Promise<WorkdirResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/workdirs`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return parseResponse<WorkdirResponse>(response)
}

export async function renameWorkdir(workdirId: string, name: string): Promise<WorkdirResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/workdirs/${encodeURIComponent(workdirId)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return parseResponse<WorkdirResponse>(response)
}

export async function deleteWorkdir(workdirId: string): Promise<DeleteWorkdirResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/workdirs/${encodeURIComponent(workdirId)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return parseResponse<DeleteWorkdirResponse>(response)
}

// =============================================================================
// Session Workdir API
// =============================================================================

export async function getSessionWorkdir(sessionId: string): Promise<SessionWorkdirResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}/workdir`, {
    credentials: 'include',
  })
  return parseResponse<SessionWorkdirResponse>(response)
}

export async function setSessionWorkdir(
  sessionId: string,
  workdirId: string,
): Promise<SessionWorkdirResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}/workdir`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workdirId }),
  })
  return parseResponse<SessionWorkdirResponse>(response)
}

export async function clearSessionWorkdir(sessionId: string): Promise<ClearSessionWorkdirResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}/workdir`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return parseResponse<ClearSessionWorkdirResponse>(response)
}

// =============================================================================
// Workdir File Tree API
// =============================================================================

export async function listWorkdirTree(
  workdirId: string,
  path?: string,
): Promise<WorkdirTreeResponse> {
  const params = new URLSearchParams()
  if (path) params.set('path', path)
  const query = params.toString() ? `?${params.toString()}` : ''
  const response = await fetchWithTimeout(`${API_BASE}/workdirs/${encodeURIComponent(workdirId)}/tree${query}`, {
    credentials: 'include',
  })
  return parseResponse<WorkdirTreeResponse>(response)
}

export async function readWorkdirFile(
  workdirId: string,
  path: string,
): Promise<WorkdirFileContent> {
  const params = new URLSearchParams({ path })
  const response = await fetchWithTimeout(
    `${API_BASE}/workdirs/${encodeURIComponent(workdirId)}/files?${params.toString()}`,
    { credentials: 'include' },
  )
  return parseResponse<WorkdirFileContent>(response)
}

export async function writeWorkdirFile(
  workdirId: string,
  path: string,
  content: string,
): Promise<WriteWorkdirFileResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/workdirs/${encodeURIComponent(workdirId)}/files`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content } satisfies WriteWorkdirFileRequest),
  })
  return parseResponse<WriteWorkdirFileResponse>(response)
}

export async function createWorkdirDir(
  workdirId: string,
  path: string,
): Promise<CreateWorkdirDirResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/workdirs/${encodeURIComponent(workdirId)}/dirs`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  return parseResponse<CreateWorkdirDirResponse>(response)
}

export async function moveWorkdirEntry(
  workdirId: string,
  fromPath: string,
  toPath: string,
): Promise<MoveWorkdirEntryResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/workdirs/${encodeURIComponent(workdirId)}/files`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromPath, toPath } satisfies MoveWorkdirEntryRequest),
  })
  return parseResponse<MoveWorkdirEntryResponse>(response)
}

export async function deleteWorkdirEntry(
  workdirId: string,
  path: string,
  options: { recursive?: boolean } = {},
): Promise<DeleteWorkdirEntryResponse> {
  const params = new URLSearchParams({ path })
  if (options.recursive === true) params.set('recursive', 'true')
  const response = await fetchWithTimeout(
    `${API_BASE}/workdirs/${encodeURIComponent(workdirId)}/files?${params.toString()}`,
    {
      method: 'DELETE',
      credentials: 'include',
    },
  )
  return parseResponse<DeleteWorkdirEntryResponse>(response)
}

export function getWorkdirFileDownloadUrl(workdirId: string, path: string): string {
  const params = new URLSearchParams({ path })
  return `${API_BASE}/workdirs/${encodeURIComponent(workdirId)}/files/download?${params.toString()}`
}

export async function uploadWorkdirFile(
  workdirId: string,
  path: string,
  content: string,
): Promise<UploadWorkdirFileResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/workdirs/${encodeURIComponent(workdirId)}/files/upload`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content } satisfies UploadWorkdirFileRequest),
  })
  return parseResponse<UploadWorkdirFileResponse>(response)
}

// =============================================================================
// Browser Handoff Client
// =============================================================================

export async function getBrowserStatus(sessionId: string): Promise<BrowserStatusResponse> {
  const response = await fetchWithTimeout(
    `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/browser/status`,
    { credentials: 'include' },
  )
  return parseResponse<BrowserStatusResponse>(response)
}

export async function acquireTakeover(sessionId: string): Promise<BrowserTakeoverResponse> {
  const response = await fetchWithTimeout(
    `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/browser/takeover`,
    { method: 'POST', credentials: 'include' },
  )
  return parseResponse<BrowserTakeoverResponse>(response)
}

export async function releaseTakeover(sessionId: string): Promise<BrowserReleaseResponse> {
  const response = await fetchWithTimeout(
    `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/browser/release`,
    { method: 'POST', credentials: 'include' },
  )
  return parseResponse<BrowserReleaseResponse>(response)
}

export async function sendInput(
  sessionId: string,
  input: BrowserInputRequest,
): Promise<BrowserInputResponse> {
  const response = await fetchWithTimeout(
    `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/browser/input`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  return parseResponse<BrowserInputResponse>(response)
}

export function subscribeToFrames(
  sessionId: string,
  onEvent: (event: BrowserStreamEvent) => void,
  onError?: (error: Error) => void,
): () => void {
  let eventSource: EventSource | null = null
  let reconnectAttempts = 0
  let reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null
  let closed = false

  const connect = () => {
    if (closed) return

    eventSource = new EventSource(
      `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/browser/frame/stream`,
      { withCredentials: true },
    )

    eventSource.onmessage = (event) => {
      reconnectAttempts = 0
      try {
        const parsed = JSON.parse(event.data) as BrowserStreamEvent
        onEvent(parsed)
      } catch {
        onError?.(new Error('Failed to parse browser frame SSE event'))
      }
    }

    eventSource.onerror = () => {
      if (closed) return
      eventSource?.close()
      eventSource = null
      onError?.(new Error('Browser frame stream connection error'))
      const delay = Math.min(
        SSE_RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts,
        SSE_RECONNECT_MAX_DELAY_MS,
      )
      reconnectAttempts += 1
      reconnectTimeoutId = setTimeout(connect, delay)
    }
  }

  connect()

  return () => {
    closed = true
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId)
      reconnectTimeoutId = null
    }
    eventSource?.close()
    eventSource = null
  }
}
