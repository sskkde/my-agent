import type {
  AdminUsersResponse,
  AdminUser,
  UpdateUserRoleRequest,
  UpdateUserStatusRequest,
  AdminApiKeysResponse,
  AdminApiKey,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  ConnectorHealthResponse,
  SystemSettingsResponse,
  UpdateSystemSettingsRequest,
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

export async function listUsers(): Promise<AdminUsersResponse> {
  const response = await fetch(`${API_BASE}/admin/users`, { credentials: 'include' });
  const result = await parseResponse<{ data: AdminUsersResponse }>(response);
  return result.data;
}

export async function updateUserRole(userId: string, request: UpdateUserRoleRequest): Promise<AdminUser> {
  const response = await fetch(`${API_BASE}/admin/users/${userId}/role`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const result = await parseResponse<{ data: { user: AdminUser } }>(response);
  return result.data.user;
}

export async function updateUserStatus(userId: string, request: UpdateUserStatusRequest): Promise<AdminUser> {
  const response = await fetch(`${API_BASE}/admin/users/${userId}/status`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const result = await parseResponse<{ data: { user: AdminUser } }>(response);
  return result.data.user;
}

export async function listApiKeys(): Promise<AdminApiKeysResponse> {
  const response = await fetch(`${API_BASE}/api-keys`, { credentials: 'include' });
  const result = await parseResponse<{ data: AdminApiKey[] }>(response);
  return { keys: result.data, total: result.data.length };
}

export async function createApiKey(request: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
  const response = await fetch(`${API_BASE}/api-keys`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const result = await parseResponse<{ data: CreateApiKeyResponse }>(response);
  return result.data;
}

export async function revokeApiKey(id: string): Promise<{ id: string; isActive: boolean }> {
  const response = await fetch(`${API_BASE}/api-keys/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const result = await parseResponse<{ data: { id: string; isActive: boolean } }>(response);
  return result.data;
}

export async function getConnectorHealth(): Promise<ConnectorHealthResponse> {
  const response = await fetch(`${API_BASE}/admin/connectors/health`, { credentials: 'include' });
  const result = await parseResponse<{ data: ConnectorHealthResponse }>(response);
  return result.data;
}

export async function getSystemSettings(): Promise<SystemSettingsResponse> {
  const response = await fetch(`${API_BASE}/admin/settings`, { credentials: 'include' });
  const result = await parseResponse<{ data: SystemSettingsResponse }>(response);
  return result.data;
}

export async function updateSystemSettings(request: UpdateSystemSettingsRequest): Promise<SystemSettingsResponse> {
  const response = await fetch(`${API_BASE}/admin/settings`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const result = await parseResponse<{ data: SystemSettingsResponse }>(response);
  return result.data;
}

export { ApiClientError };
