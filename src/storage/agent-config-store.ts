import type { ConnectionManager } from './connection.js';

export type AgentScope = 'global' | 'user';

export interface AgentConfig {
  agentConfigId: string;
  agentId: string;
  scope: AgentScope;
  userId: string | null;
  displayName: string;
  enabled: boolean;
  systemPrompt: string;
  routingPrompt: string | null;
  providerId: string | null;
  model: string | null;
  allowedToolIds: string[];
  allowedSkillIds: string[];
  routingTimeoutMs: number;
  repairAttempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertAgentConfigInput {
  agentId: string;
  scope: AgentScope;
  userId?: string;
  displayName: string;
  enabled?: boolean;
  systemPrompt: string;
  routingPrompt?: string;
  providerId?: string;
  model?: string;
  allowedToolIds?: string[];
  allowedSkillIds?: string[];
  routingTimeoutMs?: number;
  repairAttempts?: number;
}

export interface AgentConfigStore {
  getGlobalDefault(): AgentConfig | null;
  getByUser(userId: string): AgentConfig | null;
  listByUser(userId: string): AgentConfig[];
  upsert(input: UpsertAgentConfigInput): AgentConfig;
  remove(agentConfigId: string): boolean;
}

interface AgentConfigRow {
  agent_config_id: string;
  agent_id: string;
  scope: AgentScope;
  user_id: string;
  display_name: string;
  enabled: number;
  system_prompt: string;
  routing_prompt: string | null;
  provider_id: string | null;
  model: string | null;
  allowed_tool_ids: string;
  allowed_skill_ids: string;
  routing_timeout_ms: number;
  repair_attempts: number;
  created_at: string;
  updated_at: string;
}

const VALID_AGENT_IDS = ['foreground.default'];

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}

function validateAgentId(agentId: string): void {
  if (!VALID_AGENT_IDS.includes(agentId)) {
    throw new Error(`Invalid agent_id: ${agentId}. Only ${VALID_AGENT_IDS.join(', ')} is supported.`);
  }
}

function parseJsonArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

class AgentConfigStoreImpl implements AgentConfigStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  getGlobalDefault(): AgentConfig | null {
    const sql = `
      SELECT * FROM agent_configs
      WHERE agent_id = ? AND scope = 'global'
      LIMIT 1
    `;
    const rows = this.connection.query<AgentConfigRow>(sql, ['foreground.default']);

    if (rows.length === 0) {
      return null;
    }

    return this.rowToConfig(rows[0]);
  }

  getByUser(userId: string): AgentConfig | null {
    const userSql = `
      SELECT * FROM agent_configs
      WHERE agent_id = ? AND scope = 'user' AND user_id = ?
      LIMIT 1
    `;
    const userRows = this.connection.query<AgentConfigRow>(userSql, ['foreground.default', userId]);

    if (userRows.length > 0) {
      const userConfig = this.rowToConfig(userRows[0]);
      const globalSql = `
        SELECT * FROM agent_configs
        WHERE agent_id = ? AND scope = 'global'
        LIMIT 1
      `;
      const globalRows = this.connection.query<AgentConfigRow>(globalSql, ['foreground.default']);

      if (globalRows.length > 0) {
        const globalConfig = this.rowToConfig(globalRows[0]);
        return this.mergeConfigs(globalConfig, userConfig);
      }

      return userConfig;
    }

    return this.getGlobalDefault();
  }

  listByUser(userId: string): AgentConfig[] {
    const sql = `
      SELECT * FROM agent_configs
      WHERE user_id = ? AND scope = 'user'
      ORDER BY created_at DESC
    `;
    const rows = this.connection.query<AgentConfigRow>(sql, [userId]);
    return rows.map(row => this.rowToConfig(row));
  }

  upsert(input: UpsertAgentConfigInput): AgentConfig {
    validateAgentId(input.agentId);

    const now = new Date().toISOString();
    const agentConfigId = generateId();
    const userId = input.userId ?? '';

    const allowedToolIds = JSON.stringify(input.allowedToolIds ?? []);
    const allowedSkillIds = JSON.stringify(input.allowedSkillIds ?? []);

    const insertSql = `
      INSERT INTO agent_configs (
        agent_config_id, agent_id, scope, user_id, display_name, enabled,
        system_prompt, routing_prompt, provider_id, model,
        allowed_tool_ids, allowed_skill_ids, routing_timeout_ms, repair_attempts,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        updated_at = excluded.updated_at
    `;

    const params = [
      agentConfigId,
      input.agentId,
      input.scope,
      userId,
      input.displayName,
      (input.enabled ?? true) ? 1 : 0,
      input.systemPrompt,
      input.routingPrompt ?? null,
      input.providerId ?? null,
      input.model ?? null,
      allowedToolIds,
      allowedSkillIds,
      input.routingTimeoutMs ?? 10000,
      input.repairAttempts ?? 1,
      now,
      now,
    ];

    this.connection.exec(insertSql, params);

    const selectSql = `
      SELECT * FROM agent_configs
      WHERE agent_id = ? AND scope = ? AND user_id = ?
      LIMIT 1
    `;
    const rows = this.connection.query<AgentConfigRow>(selectSql, [input.agentId, input.scope, userId]);
    return this.rowToConfig(rows[0]);
  }

  remove(agentConfigId: string): boolean {
    const selectSql = 'SELECT 1 FROM agent_configs WHERE agent_config_id = ? LIMIT 1';
    const existing = this.connection.query<Record<string, unknown>>(selectSql, [agentConfigId]);

    if (existing.length === 0) {
      return false;
    }

    const deleteSql = 'DELETE FROM agent_configs WHERE agent_config_id = ?';
    this.connection.exec(deleteSql, [agentConfigId]);
    return true;
  }

  private mergeConfigs(global: AgentConfig, user: AgentConfig): AgentConfig {
    return {
      agentConfigId: user.agentConfigId,
      agentId: user.agentId,
      scope: user.scope,
      userId: user.userId,
      displayName: user.displayName,
      enabled: user.enabled,
      systemPrompt: user.systemPrompt,
      routingPrompt: user.routingPrompt ?? global.routingPrompt,
      providerId: user.providerId ?? global.providerId,
      model: user.model ?? global.model,
      allowedToolIds: user.allowedToolIds.length > 0 ? user.allowedToolIds : global.allowedToolIds,
      allowedSkillIds: user.allowedSkillIds.length > 0 ? user.allowedSkillIds : global.allowedSkillIds,
      routingTimeoutMs: user.routingTimeoutMs !== 10000 ? user.routingTimeoutMs : global.routingTimeoutMs,
      repairAttempts: user.repairAttempts !== 1 ? user.repairAttempts : global.repairAttempts,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
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
      allowedToolIds: parseJsonArray(row.allowed_tool_ids),
      allowedSkillIds: parseJsonArray(row.allowed_skill_ids),
      routingTimeoutMs: row.routing_timeout_ms,
      repairAttempts: row.repair_attempts,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export function createAgentConfigStore(connection: ConnectionManager): AgentConfigStore {
  return new AgentConfigStoreImpl(connection);
}
