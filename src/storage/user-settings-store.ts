import type { ConnectionManager } from './connection.js'

export type AppTheme = 'default' | 'warm-paper' | 'dark'

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high'

export interface CommandPrefs {
  verbose: boolean
  reasoningVisible: boolean
  thinkingLevel: ThinkingLevel
}

export interface UserSettings {
  theme?: AppTheme
  commandPrefs?: CommandPrefs
}

const SETTINGS_KEY = 'ui'

interface UserSettingsRow {
  value_json: string
}

const VALID_THEMES = new Set<AppTheme>(['default', 'warm-paper', 'dark'])
const VALID_THINKING_LEVELS = new Set<ThinkingLevel>(['off', 'minimal', 'low', 'medium', 'high'])

function normalizeTheme(value: unknown): AppTheme | undefined {
  if (value === null || value === undefined) return undefined
  return typeof value === 'string' && VALID_THEMES.has(value as AppTheme) ? (value as AppTheme) : undefined
}

function normalizeCommandPrefs(value: unknown): CommandPrefs | undefined {
  if (value === null || value === undefined || typeof value !== 'object') return undefined
  const input = value as Record<string, unknown>
  if (input.theme !== undefined || input.verbose === undefined) return undefined
  const thinkingLevel =
    typeof input.thinkingLevel === 'string' && VALID_THINKING_LEVELS.has(input.thinkingLevel as ThinkingLevel)
      ? (input.thinkingLevel as ThinkingLevel)
      : 'off'
  return {
    verbose: typeof input.verbose === 'boolean' ? input.verbose : false,
    reasoningVisible: typeof input.reasoningVisible === 'boolean' ? input.reasoningVisible : false,
    thinkingLevel,
  }
}

function normalizeUserSettings(raw: unknown): UserSettings {
  if (!raw || typeof raw !== 'object') return {}
  const input = raw as Record<string, unknown>
  return {
    theme: normalizeTheme(input.theme),
    commandPrefs: normalizeCommandPrefs(input.commandPrefs),
  }
}

export interface UserSettingsStore {
  get(userId: string): UserSettings
  update(userId: string, partial: Partial<UserSettings>): UserSettings
}

class UserSettingsStoreImpl implements UserSettingsStore {
  constructor(private readonly connection: ConnectionManager) {}

  get(userId: string): UserSettings {
    const rows = this.connection.query<UserSettingsRow>(
      'SELECT value_json FROM user_settings WHERE user_id = ? AND key = ?',
      [userId, SETTINGS_KEY],
    )
    if (rows.length === 0) return {}
    return normalizeUserSettings(JSON.parse(rows[0].value_json))
  }

  update(userId: string, partial: Partial<UserSettings>): UserSettings {
    const current = this.get(userId)
    const merged: UserSettings = {
      ...current,
      ...partial,
    }
    if (partial.theme !== undefined) merged.theme = partial.theme
    if (partial.commandPrefs !== undefined) merged.commandPrefs = partial.commandPrefs
    const now = new Date().toISOString()
    this.connection.exec(
      `
        INSERT INTO user_settings (user_id, key, value_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `,
      [userId, SETTINGS_KEY, JSON.stringify(merged), now],
    )
    return merged
  }
}

export function createUserSettingsStore(connection: ConnectionManager): UserSettingsStore {
  return new UserSettingsStoreImpl(connection)
}
