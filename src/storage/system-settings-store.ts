import type { ConnectionManager } from './connection.js'
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-context.js'

export interface SystemSettings {
  rateLimitPerMinute: number
  rateLimitPerHour: number
  sessionTokenTtlHours: number
}

export interface SystemSettingsStore {
  get(tenantId?: string): SystemSettings
  update(partial: Partial<SystemSettings>, tenantId?: string): SystemSettings
}

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  rateLimitPerMinute: 180,
  rateLimitPerHour: 1000,
  sessionTokenTtlHours: 24,
}

const SETTINGS_KEY = 'runtime'

interface SettingsRow {
  value_json: string
}

function assertPositiveInteger(name: keyof SystemSettings, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  if ((name === 'rateLimitPerMinute' || name === 'rateLimitPerHour') && value > 100000) {
    throw new Error(`${name} must be <= 100000`)
  }
  if (name === 'sessionTokenTtlHours' && value > 168) {
    throw new Error('sessionTokenTtlHours must be <= 168')
  }
}

function normalizeSettings(input: Partial<SystemSettings>): SystemSettings {
  const settings = { ...DEFAULT_SYSTEM_SETTINGS, ...input }
  assertPositiveInteger('rateLimitPerMinute', settings.rateLimitPerMinute)
  assertPositiveInteger('rateLimitPerHour', settings.rateLimitPerHour)
  assertPositiveInteger('sessionTokenTtlHours', settings.sessionTokenTtlHours)
  return settings
}

class SystemSettingsStoreImpl implements SystemSettingsStore {
  constructor(private readonly connection: ConnectionManager) {}

  get(tenantId: string = DEFAULT_TENANT_ID): SystemSettings {
    const rows = this.connection.query<SettingsRow>(
      'SELECT value_json FROM system_settings WHERE tenant_id = ? AND key = ?',
      [tenantId, SETTINGS_KEY],
    )
    if (rows.length === 0) return DEFAULT_SYSTEM_SETTINGS
    const parsed = JSON.parse(rows[0].value_json) as Partial<SystemSettings>
    return normalizeSettings(parsed)
  }

  update(partial: Partial<SystemSettings>, tenantId: string = DEFAULT_TENANT_ID): SystemSettings {
    const settings = normalizeSettings({ ...this.get(tenantId), ...partial })
    const now = new Date().toISOString()
    this.connection.exec(
      `
        INSERT INTO system_settings (tenant_id, key, value_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(tenant_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `,
      [tenantId, SETTINGS_KEY, JSON.stringify(settings), now],
    )
    return settings
  }
}

export function createSystemSettingsStore(connection: ConnectionManager): SystemSettingsStore {
  return new SystemSettingsStoreImpl(connection)
}
