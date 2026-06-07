import type { ConnectionManager } from './connection.js'

export interface SubagentProviderPreference {
  providerId?: string
  model?: string
  fallbackMode?: 'none' | 'same_provider' | 'any_compatible'
}

export interface SubagentProviderPreferenceStore {
  get(userId: string, agentType: string): SubagentProviderPreference | null
  set(userId: string, agentType: string, preference: SubagentProviderPreference): void
  delete(userId: string, agentType: string): void
  getByUser(userId: string): Array<{ agentType: string } & SubagentProviderPreference>
}

interface SubagentProviderPreferenceRow {
  user_id: string
  agent_type: string
  provider_id: string | null
  model: string | null
  fallback_mode: string
  created_at: string
  updated_at: string
}

function rowToPreference(row: SubagentProviderPreferenceRow): SubagentProviderPreference {
  return {
    providerId: row.provider_id ?? undefined,
    model: row.model ?? undefined,
    fallbackMode: row.fallback_mode as SubagentProviderPreference['fallbackMode'],
  }
}

class SubagentProviderPreferenceStoreImpl implements SubagentProviderPreferenceStore {
  private connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
    this.createTable()
  }

  private createTable(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS subagent_provider_preferences (
        user_id TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        provider_id TEXT,
        model TEXT,
        fallback_mode TEXT NOT NULL DEFAULT 'any_compatible',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, agent_type)
      )
    `)
  }

  get(userId: string, agentType: string): SubagentProviderPreference | null {
    const results = this.connection.query<SubagentProviderPreferenceRow>(
      `SELECT * FROM subagent_provider_preferences WHERE user_id = ? AND agent_type = ?`,
      [userId, agentType],
    )

    if (results.length === 0) {
      return null
    }

    return rowToPreference(results[0])
  }

  set(userId: string, agentType: string, preference: SubagentProviderPreference): void {
    const now = new Date().toISOString()
    this.connection.exec(
      `INSERT OR REPLACE INTO subagent_provider_preferences (
        user_id, agent_type, provider_id, model, fallback_mode, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        agentType,
        preference.providerId ?? null,
        preference.model ?? null,
        preference.fallbackMode ?? 'any_compatible',
        now,
        now,
      ],
    )
  }

  delete(userId: string, agentType: string): void {
    this.connection.exec(`DELETE FROM subagent_provider_preferences WHERE user_id = ? AND agent_type = ?`, [
      userId,
      agentType,
    ])
  }

  getByUser(userId: string): Array<{ agentType: string } & SubagentProviderPreference> {
    const rows = this.connection.query<SubagentProviderPreferenceRow>(
      `SELECT * FROM subagent_provider_preferences WHERE user_id = ? ORDER BY agent_type`,
      [userId],
    )

    return rows.map((row) => ({
      agentType: row.agent_type,
      ...rowToPreference(row),
    }))
  }
}

export function createSubagentProviderPreferenceStore(connection: ConnectionManager): SubagentProviderPreferenceStore {
  return new SubagentProviderPreferenceStoreImpl(connection)
}
