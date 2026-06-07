import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager } from '../../src/storage/connection.js'
import { createAgentConfigStore } from '../../src/storage/agent-config-store.js'
import type { ConnectionManager } from '../../src/storage/connection.js'
import type { AgentConfigStore } from '../../src/storage/agent-config-store.js'

const CREATE_TABLE_SQL = `
  CREATE TABLE agent_configs (
    agent_config_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    scope TEXT NOT NULL CHECK(scope IN ('global', 'user')),
    user_id TEXT,
    user_id_key TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    system_prompt TEXT,
    routing_prompt TEXT,
    provider_id TEXT,
    model TEXT,
    allowed_tool_ids TEXT,
    allowed_skill_ids TEXT,
    routing_timeout_ms INTEGER NOT NULL DEFAULT 60000,
    repair_attempts INTEGER NOT NULL DEFAULT 1,
    prompt_type TEXT,
    prompt_version TEXT,
    search_llm_provider_id TEXT,
    search_llm_model TEXT,
            tenant_id TEXT NOT NULL DEFAULT 'org_default',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`

const CREATE_UNIQUE_INDEX_SQL = `
  CREATE UNIQUE INDEX idx_agent_configs_unique ON agent_configs(agent_id, scope, user_id_key)
`

describe('agent-config-store', () => {
  let connection: ConnectionManager
  let store: AgentConfigStore

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    connection.exec(CREATE_TABLE_SQL)
    connection.exec(CREATE_UNIQUE_INDEX_SQL)
    store = createAgentConfigStore(connection)
  })

  afterEach(() => {
    connection.close()
  })

  describe('getGlobalDefault', () => {
    it('should return null when no global default exists', () => {
      const result = store.getGlobalDefault()
      expect(result).toBeNull()
    })

    it('should return global default when it exists', () => {
      const global = store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Foreground Agent',
        enabled: true,
        systemPrompt: 'You are the global foreground agent',
      })

      const result = store.getGlobalDefault()
      expect(result).not.toBeNull()
      expect(result?.agentConfigId).toBe(global.agentConfigId)
      expect(result?.agentId).toBe('foreground.default')
      expect(result?.scope).toBe('global')
      expect(result?.userId).toBeNull()
      expect(result?.displayName).toBe('Global Foreground Agent')
      expect(result?.enabled).toBe(true)
      expect(result?.systemPrompt).toBe('You are the global foreground agent')
      expect(result?.routingTimeoutMs).toBe(60000)
      expect(result?.repairAttempts).toBe(1)
    })
  })

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
      })

      expect(result.agentConfigId).toBeDefined()
      expect(result.agentId).toBe('foreground.default')
      expect(result.scope).toBe('global')
      expect(result.userId).toBeNull()
      expect(result.displayName).toBe('Global Agent')
      expect(result.enabled).toBe(true)
      expect(result.systemPrompt).toBe('Global system prompt')
      expect(result.routingPrompt).toBe('Global routing prompt')
      expect(result.providerId).toBe('prov-001')
      expect(result.model).toBe('gpt-4')
      expect(result.allowedToolIds).toEqual(['tool1', 'tool2'])
      expect(result.allowedSkillIds).toEqual(['skill1'])
      expect(result.routingTimeoutMs).toBe(15000)
      expect(result.repairAttempts).toBe(2)
      expect(result.createdAt).toBeDefined()
      expect(result.updatedAt).toBeDefined()
    })

    it('should create a user override config', () => {
      const result = store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Override Agent',
        enabled: false,
        systemPrompt: 'User system prompt',
      })

      expect(result.agentConfigId).toBeDefined()
      expect(result.agentId).toBe('foreground.default')
      expect(result.scope).toBe('user')
      expect(result.userId).toBe('user-001')
      expect(result.displayName).toBe('User Override Agent')
      expect(result.enabled).toBe(false)
      expect(result.systemPrompt).toBe('User system prompt')
    })

    it('should reject invalid agent_id outside foreground.default', () => {
      expect(() => {
        store.upsert({
          agentId: 'invalid.agent',
          scope: 'global',
          displayName: 'Invalid Agent',
          enabled: true,
          systemPrompt: 'Should fail',
        })
      }).toThrow('Invalid agent_id: invalid.agent. Only foreground.default is supported.')
    })

    it('should update existing config on upsert', () => {
      const first = store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Original Name',
        enabled: true,
        systemPrompt: 'Original prompt',
      })

      // Small delay to ensure different timestamp
      const start = Date.now()
      while (Date.now() - start < 10) {
        // busy wait
      }

      const updated = store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Updated Name',
        enabled: false,
        systemPrompt: 'Updated prompt',
      })

      expect(updated.agentConfigId).toBe(first.agentConfigId)
      expect(updated.displayName).toBe('Updated Name')
      expect(updated.enabled).toBe(false)
      expect(updated.systemPrompt).toBe('Updated prompt')
      expect(updated.updatedAt).not.toBe(first.updatedAt)
    })

    it('should enforce unique constraint on agent_id, scope, user_id', () => {
      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'First Config',
        enabled: true,
        systemPrompt: 'First prompt',
      })

      // This should update, not create duplicate
      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'Second Config',
        enabled: true,
        systemPrompt: 'Second prompt',
      })

      const userConfigs = store.listByUser('user-001')
      expect(userConfigs).toHaveLength(1)
      expect(userConfigs[0].displayName).toBe('Second Config')
    })
  })

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
      })

      // Create user override
      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: false,
        systemPrompt: 'User prompt',
        model: 'gpt-3.5',
      })

      const result = store.getByUser('user-001')
      expect(result).not.toBeNull()
      // User overrides should take precedence
      expect(result?.displayName).toBe('User Agent')
      expect(result?.enabled).toBe(false)
      expect(result?.systemPrompt).toBe('User prompt')
      expect(result?.model).toBe('gpt-3.5')
      // Global values should be inherited for unset fields
      expect(result?.routingPrompt).toBe('Global routing')
      expect(result?.providerId).toBe('prov-global')
      expect(result?.allowedToolIds).toEqual(['tool1'])
      expect(result?.allowedSkillIds).toEqual(['skill1'])
      expect(result?.routingTimeoutMs).toBe(10000)
      expect(result?.repairAttempts).toBe(1)
    })

    it('should preserve explicit user timeout and repair overrides that equal defaults', () => {
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'Global prompt',
        routingTimeoutMs: 30000,
        repairAttempts: 0,
      })

      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: true,
        systemPrompt: 'User prompt',
        routingTimeoutMs: 60000,
        repairAttempts: 1,
      })

      const result = store.getByUser('user-001')
      expect(result).not.toBeNull()
      expect(result?.routingTimeoutMs).toBe(60000)
      expect(result?.repairAttempts).toBe(1)
    })

    it('should keep omitted user timeout and repair inherited after global changes', () => {
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'Global prompt',
        routingTimeoutMs: 30000,
        repairAttempts: 0,
      })

      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: true,
        systemPrompt: 'User prompt',
      })

      expect(store.getByUser('user-001')?.routingTimeoutMs).toBe(30000)
      expect(store.getByUser('user-001')?.repairAttempts).toBe(0)

      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'Global prompt',
        routingTimeoutMs: 50000,
        repairAttempts: 1,
      })

      const result = store.getByUser('user-001')
      expect(result?.routingTimeoutMs).toBe(50000)
      expect(result?.repairAttempts).toBe(1)
    })

    it('should return global default when no user override exists', () => {
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'Global prompt',
      })

      const result = store.getByUser('user-001')
      expect(result).not.toBeNull()
      expect(result?.displayName).toBe('Global Agent')
      expect(result?.scope).toBe('global')
    })

    it('should return null when no config exists', () => {
      const result = store.getByUser('user-001')
      expect(result).toBeNull()
    })
  })

  describe('listByUser', () => {
    it('should list all user-scoped configs for a user', () => {
      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'Config 1',
        enabled: true,
        systemPrompt: 'Prompt 1',
      })

      const results = store.listByUser('user-001')
      expect(results).toHaveLength(1)
      expect(results[0].displayName).toBe('Config 1')
    })

    it('should return empty array when no user configs exist', () => {
      const results = store.listByUser('user-001')
      expect(results).toEqual([])
    })
  })

  describe('remove', () => {
    it('should remove a config by id', () => {
      const config = store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'To Remove',
        enabled: true,
        systemPrompt: 'Prompt',
      })

      const removed = store.remove(config.agentConfigId)
      expect(removed).toBe(true)

      const result = store.getGlobalDefault()
      expect(result).toBeNull()
    })

    it('should return false when config does not exist', () => {
      const removed = store.remove('non-existent-id')
      expect(removed).toBe(false)
    })
  })

  describe('defaults', () => {
    it('should use default values for optional fields', () => {
      const result = store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Minimal Config',
        enabled: true,
        systemPrompt: 'Minimal prompt',
      })

      expect(result.routingTimeoutMs).toBe(60000)
      expect(result.repairAttempts).toBe(1)
      expect(result.allowedToolIds).toEqual([])
      expect(result.allowedSkillIds).toEqual([])
      expect(result.enabled).toBe(true)
    })
  })

  describe('allowedToolIds three-state semantics', () => {
    const ALL_TOOLS = [
      'artifact_create',
      'artifact_update',
      'ask_user',
      'status_query',
      'memory_retrieve',
      'transcript_search',
      'plan_patch',
      'docs_search',
    ]

    it('should inherit allowedToolIds from global when user override has null', () => {
      // Create global with specific tools
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'Global prompt',
        allowedToolIds: ['tool1', 'tool2'],
      })

      // Create user override with null (inherit)
      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: true,
        systemPrompt: 'User prompt',
        allowedToolIds: null, // null = inherit from global
      })

      const result = store.getByUser('user-001')
      expect(result).not.toBeNull()
      expect(result?.allowedToolIds).toEqual(['tool1', 'tool2']) // inherited from global
    })

    it('should allow no tools when user override has explicit empty array', () => {
      // Create global with tools
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'Global prompt',
        allowedToolIds: ['tool1', 'tool2'],
      })

      // Create user override with explicit empty array (no tools)
      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: true,
        systemPrompt: 'User prompt',
        allowedToolIds: [], // [] = no tools allowed
      })

      const result = store.getByUser('user-001')
      expect(result).not.toBeNull()
      expect(result?.allowedToolIds).toEqual([]) // explicit empty, not inherited
    })

    it('should allow all known tools when user override has full list', () => {
      // Create global with limited tools
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'Global prompt',
        allowedToolIds: ['tool1'],
      })

      // Create user override with all tools
      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: true,
        systemPrompt: 'User prompt',
        allowedToolIds: ALL_TOOLS, // full list = all tools allowed
      })

      const result = store.getByUser('user-001')
      expect(result).not.toBeNull()
      expect(result?.allowedToolIds).toEqual(ALL_TOOLS)
    })

    it('should update inherited tools when global changes', () => {
      // Create global
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'Global prompt',
        allowedToolIds: ['tool1'],
      })

      // Create user override with null (inherit)
      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: true,
        systemPrompt: 'User prompt',
        allowedToolIds: null,
      })

      expect(store.getByUser('user-001')?.allowedToolIds).toEqual(['tool1'])

      // Update global tools
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'Global prompt',
        allowedToolIds: ['tool2', 'tool3'],
      })

      const result = store.getByUser('user-001')
      expect(result?.allowedToolIds).toEqual(['tool2', 'tool3']) // inherited updated
    })

    it('should NOT update explicit user tools when global changes', () => {
      // Create global
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'Global prompt',
        allowedToolIds: ['tool1'],
      })

      // Create user override with explicit tools
      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: true,
        systemPrompt: 'User prompt',
        allowedToolIds: ['tool2'],
      })

      // Update global tools
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'Global prompt',
        allowedToolIds: ['tool3'],
      })

      const result = store.getByUser('user-001')
      expect(result?.allowedToolIds).toEqual(['tool2']) // unchanged, explicit
    })
  })

  describe('prompt inheritance', () => {
    it('should inherit systemPrompt from global when user override has null', () => {
      // Create global
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'Global system prompt',
      })

      // Create user override with null systemPrompt (inherit)
      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: true,
        systemPrompt: null, // null = inherit from global
      })

      const result = store.getByUser('user-001')
      expect(result).not.toBeNull()
      expect(result?.systemPrompt).toBe('Global system prompt') // inherited
    })

    it('should use explicit systemPrompt when user override provides one', () => {
      // Create global
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'Global system prompt',
      })

      // Create user override with explicit systemPrompt
      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: true,
        systemPrompt: 'User system prompt', // explicit
      })

      const result = store.getByUser('user-001')
      expect(result).not.toBeNull()
      expect(result?.systemPrompt).toBe('User system prompt') // explicit, not inherited
    })

    it('should update inherited systemPrompt when global changes', () => {
      // Create global
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'Global prompt v1',
      })

      // Create user override with null (inherit)
      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: true,
        systemPrompt: null,
      })

      expect(store.getByUser('user-001')?.systemPrompt).toBe('Global prompt v1')

      // Update global systemPrompt
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'Global prompt v2',
      })

      const result = store.getByUser('user-001')
      expect(result?.systemPrompt).toBe('Global prompt v2') // inherited updated
    })

    it('should NOT update explicit user systemPrompt when global changes', () => {
      // Create global
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'Global prompt v1',
      })

      // Create user override with explicit systemPrompt
      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: true,
        systemPrompt: 'User prompt',
      })

      // Update global systemPrompt
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'Global prompt v2',
      })

      const result = store.getByUser('user-001')
      expect(result?.systemPrompt).toBe('User prompt') // unchanged, explicit
    })

    it('should inherit routingPrompt from global when user override has null', () => {
      // Create global
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'System prompt',
        routingPrompt: 'Global routing prompt',
      })

      // Create user override with null routingPrompt (inherit)
      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: true,
        systemPrompt: 'User system prompt',
        routingPrompt: null, // null = inherit from global
      })

      const result = store.getByUser('user-001')
      expect(result).not.toBeNull()
      expect(result?.routingPrompt).toBe('Global routing prompt') // inherited
    })

    it('should use explicit routingPrompt when user override provides one', () => {
      // Create global
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'System prompt',
        routingPrompt: 'Global routing prompt',
      })

      // Create user override with explicit routingPrompt
      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: true,
        systemPrompt: 'User system prompt',
        routingPrompt: 'User routing prompt', // explicit
      })

      const result = store.getByUser('user-001')
      expect(result).not.toBeNull()
      expect(result?.routingPrompt).toBe('User routing prompt') // explicit, not inherited
    })
  })

  describe('promptType and promptVersion', () => {
    it('should store promptType and promptVersion in config', () => {
      const result = store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'System prompt',
        promptType: 'foreground.router',
        promptVersion: 'v1',
      })

      expect(result.promptType).toBe('foreground.router')
      expect(result.promptVersion).toBe('v1')
    })

    it('should inherit promptType from global when user override has null', () => {
      // Create global
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'System prompt',
        promptType: 'foreground.router',
        promptVersion: 'v1',
      })

      // Create user override with null promptType (inherit)
      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: true,
        systemPrompt: 'User system prompt',
        promptType: null,
        promptVersion: null,
      })

      const result = store.getByUser('user-001')
      expect(result).not.toBeNull()
      expect(result?.promptType).toBe('foreground.router') // inherited
      expect(result?.promptVersion).toBe('v1') // inherited
    })

    it('should use explicit promptType when user override provides one', () => {
      // Create global
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'System prompt',
        promptType: 'foreground.router',
        promptVersion: 'v1',
      })

      // Create user override with explicit promptType
      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: true,
        systemPrompt: 'User system prompt',
        promptType: 'custom.router',
        promptVersion: 'v2',
      })

      const result = store.getByUser('user-001')
      expect(result).not.toBeNull()
      expect(result?.promptType).toBe('custom.router') // explicit
      expect(result?.promptVersion).toBe('v2') // explicit
    })
  })

  describe('searchLlmProviderId and searchLlmModel', () => {
    it('should store searchLlmProviderId and searchLlmModel in config', () => {
      const result = store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'System prompt',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      expect(result.searchLlmProviderId).toBe('provider-search')
      expect(result.searchLlmModel).toBe('gpt-4.1-mini')
    })

    it('should inherit searchLlmProviderId from global when user override has null', () => {
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'System prompt',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: true,
        systemPrompt: 'User system prompt',
        searchLlmProviderId: null,
        searchLlmModel: null,
      })

      const result = store.getByUser('user-001')
      expect(result).not.toBeNull()
      expect(result?.searchLlmProviderId).toBe('provider-search')
      expect(result?.searchLlmModel).toBe('gpt-4.1-mini')
    })

    it('should use explicit user override searchLlmProviderId when provided', () => {
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'System prompt',
        searchLlmProviderId: 'provider-global-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: true,
        systemPrompt: 'User system prompt',
        searchLlmProviderId: 'provider-user-search',
        searchLlmModel: 'gpt-4.1-nano',
      })

      const result = store.getByUser('user-001')
      expect(result).not.toBeNull()
      expect(result?.searchLlmProviderId).toBe('provider-user-search')
      expect(result?.searchLlmModel).toBe('gpt-4.1-nano')
    })

    it('should inherit search llm fields when user override omits them', () => {
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'System prompt',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: true,
        systemPrompt: 'User system prompt',
      })

      const result = store.getByUser('user-001')
      expect(result).not.toBeNull()
      expect(result?.searchLlmProviderId).toBe('provider-search')
      expect(result?.searchLlmModel).toBe('gpt-4.1-mini')
    })

    it('should update inherited search llm fields when global changes', () => {
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'System prompt',
        searchLlmProviderId: 'provider-search-v1',
        searchLlmModel: 'gpt-4.1-mini',
      })

      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: true,
        systemPrompt: 'User system prompt',
        searchLlmProviderId: null,
        searchLlmModel: null,
      })

      expect(store.getByUser('user-001')?.searchLlmProviderId).toBe('provider-search-v1')

      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'System prompt',
        searchLlmProviderId: 'provider-search-v2',
        searchLlmModel: 'gpt-4.1-nano',
      })

      const result = store.getByUser('user-001')
      expect(result?.searchLlmProviderId).toBe('provider-search-v2')
      expect(result?.searchLlmModel).toBe('gpt-4.1-nano')
    })

    it('should NOT update explicit user search llm fields when global changes', () => {
      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'System prompt',
        searchLlmProviderId: 'provider-global-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      store.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-001',
        displayName: 'User Agent',
        enabled: true,
        systemPrompt: 'User system prompt',
        searchLlmProviderId: 'provider-user-search',
        searchLlmModel: 'gpt-4.1-nano',
      })

      store.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Agent',
        enabled: true,
        systemPrompt: 'System prompt',
        searchLlmProviderId: 'provider-global-new',
        searchLlmModel: 'gpt-4.1-turbo',
      })

      const result = store.getByUser('user-001')
      expect(result?.searchLlmProviderId).toBe('provider-user-search')
      expect(result?.searchLlmModel).toBe('gpt-4.1-nano')
    })
  })
})
