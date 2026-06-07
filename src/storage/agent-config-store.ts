import type { ConnectionManager } from './connection.js'
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-context.js'

export const DEFAULT_ROUTING_TIMEOUT_MS = 60000
export const DEFAULT_REPAIR_ATTEMPTS = 1
export const INHERIT_ROUTING_TIMEOUT_MS = -1
export const INHERIT_REPAIR_ATTEMPTS = -1

export type AgentScope = 'global' | 'user'

export interface AgentConfig {
  agentConfigId: string
  agentId: string
  scope: AgentScope
  userId: string | null
  displayName: string
  enabled: boolean
  systemPrompt: string | null
  routingPrompt: string | null
  providerId: string | null
  model: string | null
  allowedToolIds: string[] | null
  allowedSkillIds: string[] | null
  routingTimeoutMs: number
  repairAttempts: number
  promptType: string | null
  promptVersion: string | null
  searchLlmProviderId: string | null
  searchLlmModel: string | null
  createdAt: string
  updatedAt: string
}

export interface UpsertAgentConfigInput {
  agentId: string
  scope: AgentScope
  userId?: string
  displayName: string
  enabled?: boolean
  systemPrompt?: string | null
  routingPrompt?: string | null
  providerId?: string | null
  model?: string | null
  allowedToolIds?: string[] | null
  allowedSkillIds?: string[] | null
  routingTimeoutMs?: number
  repairAttempts?: number
  promptType?: string | null
  promptVersion?: string | null
  searchLlmProviderId?: string | null
  searchLlmModel?: string | null
}

export interface AgentConfigStore {
  getGlobalDefault(tenantId?: string): AgentConfig | null
  getByUser(userId: string, tenantId?: string): AgentConfig | null
  listByUser(userId: string, tenantId?: string): AgentConfig[]
  upsert(input: UpsertAgentConfigInput, tenantId?: string): AgentConfig
  remove(agentConfigId: string, tenantId?: string): boolean
}

interface AgentConfigRow {
  agent_config_id: string
  agent_id: string
  scope: AgentScope
  user_id: string
  display_name: string
  enabled: number
  system_prompt: string | null
  routing_prompt: string | null
  provider_id: string | null
  model: string | null
  allowed_tool_ids: string | null
  allowed_skill_ids: string | null
  routing_timeout_ms: number
  repair_attempts: number
  prompt_type: string | null
  prompt_version: string | null
  search_llm_provider_id: string | null
  search_llm_model: string | null
  created_at: string
  updated_at: string
}

const VALID_AGENT_IDS = ['foreground.default']

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`
}

function validateAgentId(agentId: string): void {
  if (!VALID_AGENT_IDS.includes(agentId)) {
    throw new Error(`Invalid agent_id: ${agentId}. Only ${VALID_AGENT_IDS.join(', ')} is supported.`)
  }
}

function parseJsonArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

class AgentConfigStoreImpl implements AgentConfigStore {
  private connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
  }

  getGlobalDefault(tenantId: string = DEFAULT_TENANT_ID): AgentConfig | null {
    const sql = `
      SELECT * FROM agent_configs
      WHERE agent_id = ? AND scope = 'global' AND tenant_id = ?
      LIMIT 1
    `
    const rows = this.connection.query<AgentConfigRow>(sql, ['foreground.default', tenantId])

    if (rows.length === 0) {
      return null
    }

    return this.rowToConfig(rows[0])
  }

  getByUser(userId: string, tenantId: string = DEFAULT_TENANT_ID): AgentConfig | null {
    const userSql = `
      SELECT * FROM agent_configs
      WHERE agent_id = ? AND scope = 'user' AND user_id = ? AND tenant_id = ?
      LIMIT 1
    `
    const userRows = this.connection.query<AgentConfigRow>(userSql, ['foreground.default', userId, tenantId])

    if (userRows.length > 0) {
      const userConfig = this.rowToConfig(userRows[0])
      const globalSql = `
        SELECT * FROM agent_configs
        WHERE agent_id = ? AND scope = 'global' AND tenant_id = ?
        LIMIT 1
      `
      const globalRows = this.connection.query<AgentConfigRow>(globalSql, ['foreground.default', tenantId])

      const globalConfig = globalRows.length > 0 ? this.rowToConfig(globalRows[0]) : null
      return this.mergeConfigs(globalConfig, userConfig)
    }

    return this.getGlobalDefault(tenantId)
  }

  listByUser(userId: string, tenantId: string = DEFAULT_TENANT_ID): AgentConfig[] {
    const sql = `
      SELECT * FROM agent_configs
      WHERE user_id = ? AND scope = 'user' AND tenant_id = ?
      ORDER BY created_at DESC
    `
    const rows = this.connection.query<AgentConfigRow>(sql, [userId, tenantId])
    return rows.map((row) => this.rowToConfig(row))
  }

  upsert(input: UpsertAgentConfigInput, tenantId: string = DEFAULT_TENANT_ID): AgentConfig {
    validateAgentId(input.agentId)

    const now = new Date().toISOString()
    const agentConfigId = generateId()
    const userId = input.userId ?? ''

    const allowedToolIdsJson =
      input.allowedToolIds === undefined
        ? input.scope === 'user'
          ? null
          : JSON.stringify([])
        : input.allowedToolIds === null
          ? null
          : JSON.stringify(input.allowedToolIds)
    const allowedSkillIdsJson =
      input.allowedSkillIds === undefined
        ? input.scope === 'user'
          ? null
          : JSON.stringify([])
        : input.allowedSkillIds === null
          ? null
          : JSON.stringify(input.allowedSkillIds)

    const routingTimeoutMs =
      input.routingTimeoutMs ?? (input.scope === 'user' ? INHERIT_ROUTING_TIMEOUT_MS : DEFAULT_ROUTING_TIMEOUT_MS)
    const repairAttempts =
      input.repairAttempts ?? (input.scope === 'user' ? INHERIT_REPAIR_ATTEMPTS : DEFAULT_REPAIR_ATTEMPTS)

    const systemPrompt = input.systemPrompt === undefined ? (input.scope === 'user' ? null : '') : input.systemPrompt

    const insertSql = `
      INSERT INTO agent_configs (
        agent_config_id, agent_id, scope, user_id, display_name, enabled,
        system_prompt, routing_prompt, provider_id, model,
        allowed_tool_ids, allowed_skill_ids, routing_timeout_ms, repair_attempts,
        prompt_type, prompt_version, search_llm_provider_id, search_llm_model,
        created_at, updated_at, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO UPDATE SET
        display_name = excluded.display_name,
        enabled = excluded.enabled,
        system_prompt = excluded.system_prompt,
        routing_prompt = excluded.routing_prompt,
        provider_id = excluded.provider_id,
        model = excluded.model,
        allowed_tool_ids = excluded.allowed_tool_ids,
        allowed_skill_ids = excluded.allowed_skill_ids,
        routing_timeout_ms = excluded.routing_timeout_ms,
        repair_attempts = excluded.repair_attempts,
        prompt_type = excluded.prompt_type,
        prompt_version = excluded.prompt_version,
        search_llm_provider_id = excluded.search_llm_provider_id,
        search_llm_model = excluded.search_llm_model,
        updated_at = excluded.updated_at,
        tenant_id = excluded.tenant_id
    `

    const params = [
      agentConfigId,
      input.agentId,
      input.scope,
      userId,
      input.displayName,
      (input.enabled ?? true) ? 1 : 0,
      systemPrompt,
      input.routingPrompt ?? null,
      input.providerId ?? null,
      input.model ?? null,
      allowedToolIdsJson,
      allowedSkillIdsJson,
      routingTimeoutMs,
      repairAttempts,
      input.promptType ?? null,
      input.promptVersion ?? null,
      input.searchLlmProviderId ?? null,
      input.searchLlmModel ?? null,
      now,
      now,
      tenantId,
    ]

    this.connection.exec(insertSql, params)

    const selectSql = `
      SELECT * FROM agent_configs
      WHERE agent_id = ? AND scope = ? AND user_id = ? AND tenant_id = ?
      LIMIT 1
    `
    const rows = this.connection.query<AgentConfigRow>(selectSql, [input.agentId, input.scope, userId, tenantId])
    return this.rowToConfig(rows[0])
  }

  remove(agentConfigId: string, tenantId: string = DEFAULT_TENANT_ID): boolean {
    const selectSql = 'SELECT 1 FROM agent_configs WHERE agent_config_id = ? AND tenant_id = ? LIMIT 1'
    const existing = this.connection.query<Record<string, unknown>>(selectSql, [agentConfigId, tenantId])

    if (existing.length === 0) {
      return false
    }

    const deleteSql = 'DELETE FROM agent_configs WHERE agent_config_id = ? AND tenant_id = ?'
    this.connection.exec(deleteSql, [agentConfigId, tenantId])
    return true
  }

  private mergeConfigs(global: AgentConfig | null, user: AgentConfig): AgentConfig {
    return {
      agentConfigId: user.agentConfigId,
      agentId: user.agentId,
      scope: user.scope,
      userId: user.userId,
      displayName: user.displayName,
      enabled: user.enabled,
      systemPrompt: user.systemPrompt ?? global?.systemPrompt ?? null,
      routingPrompt: user.routingPrompt ?? global?.routingPrompt ?? null,
      providerId: user.providerId ?? global?.providerId ?? null,
      model: user.model ?? global?.model ?? null,
      allowedToolIds: user.allowedToolIds ?? global?.allowedToolIds ?? null,
      allowedSkillIds: user.allowedSkillIds ?? global?.allowedSkillIds ?? null,
      routingTimeoutMs:
        user.routingTimeoutMs === INHERIT_ROUTING_TIMEOUT_MS
          ? (global?.routingTimeoutMs ?? DEFAULT_ROUTING_TIMEOUT_MS)
          : user.routingTimeoutMs,
      repairAttempts:
        user.repairAttempts === INHERIT_REPAIR_ATTEMPTS
          ? (global?.repairAttempts ?? DEFAULT_REPAIR_ATTEMPTS)
          : user.repairAttempts,
      promptType: user.promptType ?? global?.promptType ?? null,
      promptVersion: user.promptVersion ?? global?.promptVersion ?? null,
      searchLlmProviderId: user.searchLlmProviderId ?? global?.searchLlmProviderId ?? null,
      searchLlmModel: user.searchLlmModel ?? global?.searchLlmModel ?? null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }
  }

  private rowToConfig(row: AgentConfigRow): AgentConfig {
    return {
      agentConfigId: row.agent_config_id,
      agentId: row.agent_id,
      scope: row.scope,
      userId: row.user_id || null,
      displayName: row.display_name,
      enabled: Boolean(row.enabled),
      systemPrompt: row.system_prompt,
      routingPrompt: row.routing_prompt,
      providerId: row.provider_id,
      model: row.model,
      allowedToolIds: row.allowed_tool_ids === null ? null : parseJsonArray(row.allowed_tool_ids),
      allowedSkillIds: row.allowed_skill_ids === null ? null : parseJsonArray(row.allowed_skill_ids),
      routingTimeoutMs: row.routing_timeout_ms,
      repairAttempts: row.repair_attempts,
      promptType: row.prompt_type,
      promptVersion: row.prompt_version,
      searchLlmProviderId: row.search_llm_provider_id,
      searchLlmModel: row.search_llm_model,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}

export function createAgentConfigStore(connection: ConnectionManager): AgentConfigStore {
  return new AgentConfigStoreImpl(connection)
}
