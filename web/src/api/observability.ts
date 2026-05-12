import { ApiClientError } from './client';

const API_BASE = '/api';

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

export interface RunEntry {
  id: string;
  type: 'planner_run' | 'workflow_run';
  status: string;
  createdAt: string;
  summary?: string;
}

export interface TimelineEvent {
  eventId: string;
  eventType: string;
  timestamp: string;
  summary: string;
}

export interface AuditEntry {
  auditId: string;
  action: string;
  timestamp: string;
}

export interface ConsoleResponse {
  runId: string;
  status: string;
  timeline: TimelineEvent[];
  audit?: AuditEntry[];
}

export interface BlockedAction {
  eventId: string;
  action: string;
  reason: string;
}

export interface ReplayPreviewResponse {
  runId: string;
  mode: string;
  timeline: TimelineEvent[];
  blockedActions?: BlockedAction[];
  stateSnapshot?: Record<string, unknown>;
}

export async function getRuns(status?: string): Promise<RunEntry[]> {
  const params = new URLSearchParams();
  if (status) params.append('status', status);
  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${API_BASE}/observability/runs${query}`, { credentials: 'include' });
  const result = await parseResponse<{ data: RunEntry[] }>(response);
  return result.data;
}

export async function getRunConsole(runId: string): Promise<ConsoleResponse> {
  const response = await fetch(`${API_BASE}/observability/runs/${runId}/console`, { credentials: 'include' });
  const result = await parseResponse<{ data: ConsoleResponse }>(response);
  return result.data;
}

export async function getReplayPreview(runId: string): Promise<ReplayPreviewResponse> {
  const response = await fetch(`${API_BASE}/observability/runs/${runId}/replay-preview`, { credentials: 'include' });
  const result = await parseResponse<{ data: ReplayPreviewResponse }>(response);
  return result.data;
}
