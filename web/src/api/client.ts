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
} from './types';

const API_BASE = '/api';

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
  return response.json();
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE}/health`, { credentials: 'include' });
  const result = await parseResponse<{ data: HealthResponse }>(response);
  return result.data;
}

export async function createSession(): Promise<SessionResponse> {
  const response = await fetch(`${API_BASE}/sessions`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const result = await parseResponse<{ data: SessionResponse }>(response);
  return result.data;
}

export async function getSession(sessionId: string): Promise<SessionResponse> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}`, { credentials: 'include' });
  const result = await parseResponse<{ data: SessionResponse }>(response);
  return result.data;
}

export async function getTranscripts(sessionId: string): Promise<TranscriptsResponse> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/transcripts`, { credentials: 'include' });
  const result = await parseResponse<{ data: TranscriptsResponse }>(response);
  return result.data;
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
  const result = await parseResponse<{ data: SendMessageResponse }>(response);
  return result.data;
}

export async function getRuns(): Promise<RunsResponse> {
  const response = await fetch(`${API_BASE}/runs`, { credentials: 'include' });
  const result = await parseResponse<{ data: RunsResponse }>(response);
  return result.data;
}

export async function getApprovals(): Promise<ApprovalsResponse> {
  const response = await fetch(`${API_BASE}/approvals`, { credentials: 'include' });
  const result = await parseResponse<{ data: ApprovalsResponse }>(response);
  return result.data;
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
  const result = await parseResponse<{ data: ApprovalDecisionResponse }>(response);
  return result.data;
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
  const result = await parseResponse<{ data: { items: SessionsResponse['sessions']; total: number } }>(response);
  return { sessions: result.data.items, total: result.data.total };
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
  const result = await parseResponse<{ data: SessionResponse }>(response);
  return result.data;
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
  const result = await parseResponse<{ data: { items: UsageResponse['usages']; total: number } }>(response);
  return { usages: result.data.items, total: result.data.total };
}

export async function getSessionUsage(sessionId: string): Promise<SessionUsageResponse> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/usage`, { credentials: 'include' });
  const result = await parseResponse<{ data: SessionUsageResponse['usage'] }>(response);
  return { usage: result.data };
}

export async function getLogs(
  sessionId?: string,
  sourceModule?: string,
  eventType?: string,
  limit?: number,
  offset?: number
): Promise<LogsResponse> {
  const params = new URLSearchParams();
  if (sessionId) params.append('sessionId', sessionId);
  if (sourceModule) params.append('sourceModule', sourceModule);
  if (eventType) params.append('eventType', eventType);
  if (limit !== undefined) params.append('limit', String(limit));
  if (offset !== undefined) params.append('offset', String(offset));
  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${API_BASE}/logs${query}`, { credentials: 'include' });
  const result = await parseResponse<{ data: { items: LogsResponse['logs']; total: number } }>(response);
  return { logs: result.data.items, total: result.data.total };
}

export async function getDebugReplay(sessionId: string): Promise<DebugReplayResponse> {
  const response = await fetch(`${API_BASE}/debug/replay/${sessionId}`, { credentials: 'include' });
  const result = await parseResponse<{ data: DebugReplayResponse }>(response);
  return result.data;
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
  const result = await parseResponse<{ data: { items: ConsoleTimelineEvent[]; total: number } }>(response);
  return { events: result.data.items, total: result.data.total };
}

export async function getInstances(): Promise<InstancesResponse> {
  const response = await fetch(`${API_BASE}/instances`, { credentials: 'include' });
  const result = await parseResponse<{ data: InstancesResponse }>(response);
  return result.data;
}

export async function getChannels(): Promise<ChannelsResponse> {
  const response = await fetch(`${API_BASE}/channels`, { credentials: 'include' });
  const result = await parseResponse<{ data: ChannelsResponse }>(response);
  return result.data;
}

export async function getSkills(): Promise<SkillsResponse> {
  const response = await fetch(`${API_BASE}/skills`, { credentials: 'include' });
  const result = await parseResponse<{ data: SkillsResponse }>(response);
  return result.data;
}

export async function getSettings(): Promise<SettingsResponse> {
  const response = await fetch(`${API_BASE}/settings`, { credentials: 'include' });
  const result = await parseResponse<{ data: SettingsResponse }>(response);
  return result.data;
}

export type SessionTimelineEventCallback = (event: ConsoleTimelineEvent) => void;
export type SessionTimelineErrorCallback = (error: Error) => void;

export function subscribeSessionTimeline(
  sessionId: string,
  onEvent: SessionTimelineEventCallback,
  onError?: SessionTimelineErrorCallback
): () => void {
  const eventSource = new EventSource(`${API_BASE}/sessions/${sessionId}/timeline/stream`, { withCredentials: true });

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as ConsoleTimelineEvent;
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

export async function getSetupStatus(): Promise<SetupStatusResponse> {
  const response = await fetch(`${API_BASE}/setup/status`, { credentials: 'include' });
  const result = await parseResponse<{ data: SetupStatusResponse }>(response);
  return result.data;
}

export async function setupUser(username: string, password: string): Promise<AuthSuccessResponse> {
  const response = await fetch(`${API_BASE}/setup/user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password } as CreateUserRequest),
  });
  const result = await parseResponse<{ data: AuthSuccessResponse }>(response);
  return result.data;
}

export async function login(username: string, password: string): Promise<AuthSuccessResponse> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password } as LoginRequest),
  });
  const result = await parseResponse<{ data: AuthSuccessResponse }>(response);
  return result.data;
}

export async function logout(): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });
  const result = await parseResponse<{ data: { success: boolean } }>(response);
  return result.data;
}

export async function getMe(): Promise<{ user: UserMetadata }> {
  const response = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' });
  const result = await parseResponse<{ data: { user: UserMetadata } }>(response);
  return result.data;
}

export async function getProviders(): Promise<ProviderSummary[]> {
  const response = await fetch(`${API_BASE}/providers`, { credentials: 'include' });
  const result = await parseResponse<{ data: ProviderSummary[] }>(response);
  return result.data;
}

export async function createProvider(request: CreateProviderRequest): Promise<ProviderSummary> {
  const response = await fetch(`${API_BASE}/providers`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const result = await parseResponse<{ data: ProviderSummary }>(response);
  return result.data;
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
  const result = await parseResponse<{ data: ProviderSummary }>(response);
  return result.data;
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
  const result = await parseResponse<{ data: TestProviderResponse }>(response);
  return result.data;
}

export async function getTools(): Promise<ToolsResponse> {
  const response = await fetch(`${API_BASE}/tools`, { credentials: 'include' });
  const result = await parseResponse<{ data: ToolsResponse }>(response);
  return result.data;
}

export { ApiClientError };
