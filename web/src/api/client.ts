import type {
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
  ApiError,
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
  const response = await fetch(`${API_BASE}/health`);
  const result = await parseResponse<{ data: HealthResponse }>(response);
  return result.data;
}

export async function createSession(): Promise<SessionResponse> {
  const response = await fetch(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const result = await parseResponse<{ data: SessionResponse }>(response);
  return result.data;
}

export async function getSession(sessionId: string): Promise<SessionResponse> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}`);
  const result = await parseResponse<{ data: SessionResponse }>(response);
  return result.data;
}

export async function getTranscripts(sessionId: string): Promise<TranscriptsResponse> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/transcripts`);
  const result = await parseResponse<{ data: TranscriptsResponse }>(response);
  return result.data;
}

export async function sendMessage(
  sessionId: string,
  text: string
): Promise<SendMessageResponse> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text } as SendMessageRequest),
  });
  const result = await parseResponse<{ data: SendMessageResponse }>(response);
  return result.data;
}

export async function getRuns(): Promise<RunsResponse> {
  const response = await fetch(`${API_BASE}/runs`);
  const result = await parseResponse<{ data: RunsResponse }>(response);
  return result.data;
}

export async function getApprovals(): Promise<ApprovalsResponse> {
  const response = await fetch(`${API_BASE}/approvals`);
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
  const eventSource = new EventSource(`${API_BASE}/runs/stream`);

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

export { ApiClientError };