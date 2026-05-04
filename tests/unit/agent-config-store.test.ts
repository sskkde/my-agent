import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager } from '../../src/storage/connection.js';
import { createAgentConfigStore } from '../../src/storage/agent-config-store.js';
import type { ConnectionManager } from '../../src/storage/connection.js';
import type { AgentConfigStore } from '../../src/storage/agent-config-store.js';

const CREATE_TABLE_SQL = `
  CREATE TABLE agent_configs (
    agent_config_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    scope TEXT NOT NULL CHECK(scope IN ('global', 'user')),
    user_id TEXT,
    user_id_key TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    system_prompt TEXT NOT NULL,
    routing_prompt TEXT,
    provider_id TEXT,
    model TEXT,
    allowed_tool_ids TEXT NOT NULL DEFAULT '[]',
    allowed_skill_ids TEXT NOT NULL DEFAULT '[]',
    routing_timeout_ms INTEGER NOT NULL DEFAULT 10000,
    repair_attempts INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`;

const CREATE_UNIQUE_INDEX_SQL = `
  CREATE UNIQUE INDEX idx_agent_configs_unique ON agent_configs(agent_id, scope, user_id_key)
`;

describe('agent-config-store', () => {
  let connection: ConnectionManager;
  let store: AgentConfigStore;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    connection.exec(CREATE_TABLE_SQL);
    connection.exec(CREATE_UNIQUE_INDEX_SQL);
    store = createAgentConfigStore(connection);
  });

  afterEach(() => {
    connection.close();
  });

  describe('getGlobalDefault', () => {
    it('should return null when no global default exists', () => {
      const result = store.getGlobalDefault();
      expect(result).toBeNull();
    });

    it('should return global default when it exists', () => {
      const global = store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Foreground Agent',
        enabled: true,
        systemPrompt: 'You are the global foreground agent',
      });

      const result = store.getGlobalDefault();
      expect(result).not.toBeNull();
      expect(result?.agentConfigId).toBe(global.agentConfigId);
      expect(result?.agentId).toBe('foreground.default');
      expect(result?.scope).toBe('global');
      expect(result?.userId).toBeNull();
      expect(result?.displayName).toBe('Global Foreground Agent');
      expect(result?.enabled).toBe(true);
      expect(result?.systemPrompt).toBe('You are the global foreground agent');
      expect(result?.routingTimeoutMs).toBe(10000);
      expect(result?.repairAttempts).toBe(1);
    });
  });

  describe('upsert', () => {
    it('should create a global config', () => {
      const result = store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'Global system prompt',
        routingPrompt: 'Global routing prompt',
        providerId: 'prov-001',
        model: 'gpt-4',
        allowedToolIds: ['tool1', 'tool2'],
        allowedSkillIds: ['skill1'],
        routingTimeoutMs: 15000,
        repairAttempts: 2,
      });

      expect(result.agentConfigId).toBeDefined();
      expect(result.agentId).toBe('foreground.default');
      expect(result.scope).toBe('global');
      expect(result.userId).toBeNull();
      expect(result.displayName).toBe('Global Agent');
      expect(result.enabled).toBe(true);
      expect(result.systemPrompt).toBe('Global system prompt');
      expect(result.routingPrompt).toBe('Global routing prompt');
      expect(result.providerId).toBe('prov-001');
      expect(result.model).toBe('gpt-4');
      expect(result.allowedToolIds).toEqual(['tool1', 'tool2']);
      expect(result.allowedSkillIds).toEqual(['skill1']);
      expect(result.routingTimeoutMs).toBe(15000);
      expect(result.repairAttempts).toBe(2);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should create a user override config', () => {
      const result = store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Override Agent',
        enabled: false,
        systemPrompt: 'User system prompt',
      });

      expect(result.agentConfigId).toBeDefined();
      expect(result.agentId).toBe('foreground.default');
      expect(result.scope).toBe('user');
      expect(result.userId).toBe('user-001');
      expect(result.displayName).toBe('User Override Agent');
      expect(result.enabled).toBe(false);
      expect(result.systemPrompt).toBe('User system prompt');
    });

    it('should reject invalid agent_id outside foreground.default', () => {
      expect(() => {
        store.upsert({
          agentId: 'invalid.agent',
          scope: 'global',
          displayName: 'Invalid Agent',
          enabled: true,
          systemPrompt: 'Should fail',
        });
      }).toThrow('Invalid agent_id: invalid.agent. Only foreground.default is supported.');
    });

    it('should update existing config on upsert', () => {
      const first = store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Original Name',
        enabled: true,
        systemPrompt: 'Original prompt',
      });

      // Small delay to ensure different timestamp
      const start = Date.now();
      while (Date.now() - start < 10) {
        // busy wait
      }

      const updated = store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Updated Name',
        enabled: false,
        systemPrompt: 'Updated prompt',
      });

      expect(updated.agentConfigId).toBe(first.agentConfigId);
      expect(updated.displayName).toBe('Updated Name');
      expect(updated.enabled).toBe(false);
      expect(updated.systemPrompt).toBe('Updated prompt');
      expect(updated.updatedAt).not.toBe(first.updatedAt);
    });

    it('should enforce unique constraint on agent_id, scope, user_id', () => {
      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'First Config',
        enabled: true,
        systemPrompt: 'First prompt',
      });

      // This should update, not create duplicate
      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'Second Config',
        enabled: true,
        systemPrompt: 'Second prompt',
      });

      const userConfigs = store.listByUser('user-001');
      expect(userConfigs).toHaveLength(1);
      expect(userConfigs[0].displayName).toBe('Second Config');
    });
  });

  describe('getByUser', () => {
    it('should return merged config when user override exists', () => {
      // Create global default
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'Global prompt',
        routingPrompt: 'Global routing',
        providerId: 'prov-global',
        model: 'gpt-4',
        allowedToolIds: ['tool1'],
        allowedSkillIds: ['skill1'],
        routingTimeoutMs: 10000,
        repairAttempts: 1,
      });

      // Create user override
      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: false,
        systemPrompt: 'User prompt',
        model: 'gpt-3.5',
      });

      const result = store.getByUser('user-001');
      expect(result).not.toBeNull();
      // User overrides should take precedence
      expect(result?.displayName).toBe('User Agent');
      expect(result?.enabled).toBe(false);
      expect(result?.systemPrompt).toBe('User prompt');
      expect(result?.model).toBe('gpt-3.5');
      // Global values should be inherited for unset fields
      expect(result?.routingPrompt).toBe('Global routing');
      expect(result?.providerId).toBe('prov-global');
      expect(result?.allowedToolIds).toEqual(['tool1']);
      expect(result?.allowedSkillIds).toEqual(['skill1']);
    });

    it('should return global default when no user override exists', () => {
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'Global prompt',
      });

      const result = store.getByUser('user-001');
      expect(result).not.toBeNull();
      expect(result?.displayName).toBe('Global Agent');
      expect(result?.scope).toBe('global');
    });

    it('should return null when no config exists', () => {
      const result = store.getByUser('user-001');
      expect(result).toBeNull();
    });
  });

  describe('listByUser', () => {
    it('should list all user-scoped configs for a user', () => {
      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'Config 1',
        enabled: true,
        systemPrompt: 'Prompt 1',
      });

      const results = store.listByUser('user-001');
      expect(results).toHaveLength(1);
      expect(results[0].displayName).toBe('Config 1');
    });

    it('should return empty array when no user configs exist', () => {
      const results = store.listByUser('user-001');
      expect(results).toEqual([]);
    });
  });

  describe('remove', () => {
    it('should remove a config by id', () => {
      const config = store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'To Remove',
        enabled: true,
        systemPrompt: 'Prompt',
      });

      const removed = store.remove(config.agentConfigId);
      expect(removed).toBe(true);

      const result = store.getGlobalDefault();
      expect(result).toBeNull();
    });

    it('should return false when config does not exist', () => {
      const removed = store.remove('non-existent-id');
      expect(removed).toBe(false);
    });
  });

  describe('defaults', () => {
    it('should use default values for optional fields', () => {
      const result = store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Minimal Config',
        enabled: true,
        systemPrompt: 'Minimal prompt',
      });

      expect(result.routingTimeoutMs).toBe(10000);
      expect(result.repairAttempts).toBe(1);
      expect(result.allowedToolIds).toEqual([]);
      expect(result.allowedSkillIds).toEqual([]);
      expect(result.enabled).toBe(true);
    });
  });
});
