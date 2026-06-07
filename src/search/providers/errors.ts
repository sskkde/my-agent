import type { ProviderErrorResponse } from '../types.js'

export function isProviderErrorResponse(payload: unknown): payload is ProviderErrorResponse {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return false
  }

  const record = payload as Record<string, unknown>
  return typeof record.error === 'string' && typeof record.code === 'string'
}
