import type {
  TriggerResponse,
  TriggersResponse,
  TriggerLogsResponse,
} from './types';

const API_BASE = '/api';

class ApiClientError extends Error {
  code: string;
  details?: unknown;

  constructor(error: { code: string; message: string; details?: unknown }) {
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
  if (response.status === 204) {
    return {} as T;
  }
  return response.json();
}

export async function getTriggers(type?: string): Promise<TriggerResponse[]> {
  const params = new URLSearchParams();
  if (type) params.append('type', type);
  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${API_BASE}/triggers${query}`, { credentials: 'include' });
  const result = await parseResponse<{ data: TriggersResponse }>(response);
  return result.data.triggers;
}

export async function toggleTrigger(
  triggerId: string,
  newStatus: 'active' | 'paused'
): Promise<TriggerResponse> {
  const response = await fetch(`${API_BASE}/triggers/${triggerId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus }),
  });
  const result = await parseResponse<{ data: TriggerResponse }>(response);
  return result.data;
}

export async function getTriggerLogs(
  triggerId: string,
  limit?: number
): Promise<TriggerLogsResponse> {
  const params = new URLSearchParams();
  if (limit !== undefined) params.append('limit', String(limit));
  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${API_BASE}/triggers/${triggerId}/logs${query}`, {
    credentials: 'include',
  });
  const result = await parseResponse<{ data: TriggerLogsResponse }>(response);
  return result.data;
}

export { ApiClientError };
