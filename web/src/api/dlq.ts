import type {
  DeadLetterEntry,
  DlqListResponse,
  DlqRetryResponse,
  DlqDiscardResponse,
  DlqBatchRetryResponse,
  DlqBatchDiscardResponse,
} from './types';

const API_BASE = '/api/v1';

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

export async function getDlqEntries(
  status?: string,
  limit?: number,
  offset?: number
): Promise<DlqListResponse> {
  const params = new URLSearchParams();
  if (status) params.append('status', status);
  if (limit !== undefined) params.append('limit', String(limit));
  if (offset !== undefined) params.append('offset', String(offset));
  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${API_BASE}/dlq${query}`, { credentials: 'include' });
  const result = await parseResponse<{ data: DlqListResponse }>(response);
  return result.data;
}

export async function getDlqEntry(eventId: string): Promise<DeadLetterEntry> {
  const response = await fetch(`${API_BASE}/dlq/${eventId}`, { credentials: 'include' });
  const result = await parseResponse<{ data: { entry: DeadLetterEntry } }>(response);
  return result.data.entry;
}

export async function retryDlqEntry(eventId: string): Promise<DlqRetryResponse> {
  const response = await fetch(`${API_BASE}/dlq/${eventId}/retry`, {
    method: 'POST',
    credentials: 'include',
  });
  const result = await parseResponse<{ data: DlqRetryResponse }>(response);
  return result.data;
}

export async function discardDlqEntry(eventId: string): Promise<DlqDiscardResponse> {
  const response = await fetch(`${API_BASE}/dlq/${eventId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const result = await parseResponse<{ data: DlqDiscardResponse }>(response);
  return result.data;
}

export async function batchRetryDlqEntries(eventIds: string[]): Promise<DlqBatchRetryResponse> {
  const response = await fetch(`${API_BASE}/dlq/batch-retry`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventIds }),
  });
  const result = await parseResponse<{ data: DlqBatchRetryResponse }>(response);
  return result.data;
}

export async function batchDiscardDlqEntries(eventIds: string[]): Promise<DlqBatchDiscardResponse> {
  const response = await fetch(`${API_BASE}/dlq/batch-discard`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventIds }),
  });
  const result = await parseResponse<{ data: DlqBatchDiscardResponse }>(response);
  return result.data;
}

export { ApiClientError };
