import type { ApiError } from './types'

const API_BASE = '/api/v1'

class ApiClientError extends Error {
  code: string
  details?: unknown

  constructor(error: ApiError['error']) {
    super(error.message)
    this.name = 'ApiClientError'
    this.code = error.code
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
    )
  }
  return response.json()
}

export type ConnectorType = 'api' | 'messaging' | 'storage' | 'database' | 'custom'
export type ConnectorStatus = 'draft' | 'active' | 'deprecated' | 'inactive'

export interface ConnectorDefinition {
  id: string
  connectorId: string
  name: string
  connectorType: ConnectorType
  version: string
  description?: string
  capabilities: string[]
  configSchema?: Record<string, unknown>
  status: ConnectorStatus
  createdAt: string
  updatedAt: string
}

export interface ConnectorInstance {
  id: string
  connectorInstanceId: string
  connectorDefinitionId: string
  userId: string
  name: string
  authStateRef: string
  config?: Record<string, unknown>
  status: ConnectorStatus
  createdAt: string
  updatedAt: string
}

export async function getConnectors(): Promise<ConnectorDefinition[]> {
  const response = await fetch(`${API_BASE}/connectors`, { credentials: 'include' })
  const result = await parseResponse<{ data: ConnectorDefinition[] }>(response)
  return result.data
}

export async function getConnector(id: string): Promise<ConnectorDefinition> {
  const response = await fetch(`${API_BASE}/connectors/${id}`, { credentials: 'include' })
  const result = await parseResponse<{ data: ConnectorDefinition }>(response)
  return result.data
}

export async function getInstances(id: string): Promise<ConnectorInstance[]> {
  const response = await fetch(`${API_BASE}/connectors/${id}/instances`, { credentials: 'include' })
  const result = await parseResponse<{ data: ConnectorInstance[] }>(response)
  return result.data
}

export async function updateInstanceConfig(
  connectorId: string,
  instanceId: string,
  config: Record<string, unknown>,
): Promise<ConnectorInstance> {
  const response = await fetch(`${API_BASE}/connectors/${connectorId}/instances/${instanceId}/config`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  })
  const result = await parseResponse<{ data: ConnectorInstance }>(response)
  return result.data
}

export { ApiClientError }
