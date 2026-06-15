import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAgentConfig, updateAgentConfig, resetAgentConfigOverride, ApiClientError } from './client'
import type {
  AgentConfig,
  AgentGlobalConfig,
  AgentUserOverride,
  AgentEffectiveConfig,
  UpdateAgentGlobalConfigRequest,
  UpdateAgentUserOverrideRequest,
} from './types'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('AgentConfig API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getAgentConfig', () => {
    it('should fetch agent config successfully', async () => {
      const mockConfig: AgentConfig = {
        agentId: 'foreground.default',
        global: {
          providerId: 'openai',
          model: 'gpt-4',
          systemPrompt: '',
          routingPrompt: '',
          allowedToolIds: ['read_file', 'write_file', 'execute_command'],
          allowedSkillIds: ['git', 'docker'],
          routingTimeoutMs: 30000,
          repairAttempts: 1,
        },
        userOverride: {
          providerId: 'ollama',
          model: 'llama2',
          systemPrompt: '',
          routingPrompt: '',
          allowedToolIds: ['read_file'],
          allowedSkillIds: ['git'],
          routingTimeoutMs: 30000,
          repairAttempts: 1,
        },
        effective: {
          providerId: 'ollama',
          model: 'llama2',
          systemPrompt: '',
          routingPrompt: '',
          allowedToolIds: ['read_file'],
          allowedSkillIds: ['git'],
          routingTimeoutMs: 30000,
          repairAttempts: 1,
        },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockConfig }),
      })

      const result = await getAgentConfig('foreground.default')

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/agents/foreground.default/config',
        expect.objectContaining({ credentials: 'include' }),
      )
      expect(result).toEqual(mockConfig)
    })

    it('should handle agent config with null user override', async () => {
      const mockConfig: AgentConfig = {
        agentId: 'foreground.default',
        global: {
          providerId: 'openai',
          model: 'gpt-4',
          systemPrompt: '',
          routingPrompt: '',
          allowedToolIds: ['read_file'],
          allowedSkillIds: [],
          routingTimeoutMs: 30000,
          repairAttempts: 1,
        },
        userOverride: null,
        effective: {
          providerId: 'openai',
          model: 'gpt-4',
          systemPrompt: '',
          routingPrompt: '',
          allowedToolIds: ['read_file'],
          allowedSkillIds: [],
          routingTimeoutMs: 30000,
          repairAttempts: 1,
        },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockConfig }),
      })

      const result = await getAgentConfig('foreground.default')

      expect(result.userOverride).toBeNull()
      expect(result.effective.providerId).toBe('openai')
    })

    it('should throw ApiClientError on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({
          error: {
            code: 'AGENT_NOT_FOUND',
            message: 'Agent not found',
          },
        }),
      })

      await expect(getAgentConfig('unknown.agent')).rejects.toThrow(ApiClientError)
    })
  })

  describe('updateAgentConfig', () => {
    it('should update global config successfully', async () => {
      const updateRequest: UpdateAgentGlobalConfigRequest = {
        providerId: 'openrouter',
        model: 'claude-3-opus',
        allowedToolIds: ['read_file', 'write_file', 'search_code'],
        allowedSkillIds: ['git'],
        routingTimeoutMs: 60000,
        repairAttempts: 1,
      }

      const mockResponse: AgentGlobalConfig = {
        providerId: 'openrouter',
        model: 'claude-3-opus',
        systemPrompt: '',
        routingPrompt: '',
        allowedToolIds: ['read_file', 'write_file', 'search_code'],
        allowedSkillIds: ['git'],
        routingTimeoutMs: 60000,
        repairAttempts: 1,
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockResponse }),
      })

      const result = await updateAgentConfig('foreground.default', 'global', updateRequest)

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/agents/foreground.default/config/global',
        expect.objectContaining({
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateRequest),
        }),
      )
      expect(result).toEqual(mockResponse)
    })

    it('should update user override successfully', async () => {
      const updateRequest: UpdateAgentUserOverrideRequest = {
        providerId: 'ollama',
        model: 'mistral',
        allowedToolIds: ['read_file'],
        allowedSkillIds: ['docker'],
        routingTimeoutMs: 30000,
        repairAttempts: 1,
      }

      const mockResponse: AgentUserOverride = {
        providerId: 'ollama',
        model: 'mistral',
        systemPrompt: '',
        routingPrompt: '',
        allowedToolIds: ['read_file'],
        allowedSkillIds: ['docker'],
        routingTimeoutMs: 30000,
        repairAttempts: 1,
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockResponse }),
      })

      const result = await updateAgentConfig('foreground.default', 'override', updateRequest)

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/agents/foreground.default/config/override',
        expect.objectContaining({
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateRequest),
        }),
      )
      expect(result).toEqual(mockResponse)
    })

    it('should handle partial updates', async () => {
      const updateRequest: UpdateAgentGlobalConfigRequest = {
        providerId: 'openai',
      }

      const mockResponse: AgentGlobalConfig = {
        providerId: 'openai',
        model: 'gpt-4',
        systemPrompt: '',
        routingPrompt: '',
        allowedToolIds: ['read_file'],
        allowedSkillIds: [],
        routingTimeoutMs: 30000,
        repairAttempts: 1,
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockResponse }),
      })

      const result = await updateAgentConfig('foreground.default', 'global', updateRequest)

      expect(result.providerId).toBe('openai')
    })

    it('should throw ApiClientError on validation failure', async () => {
      const updateRequest: UpdateAgentGlobalConfigRequest = {
        providerId: 'invalid-provider',
      }

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid provider ID',
          },
        }),
      })

      await expect(updateAgentConfig('foreground.default', 'global', updateRequest)).rejects.toThrow(ApiClientError)
    })
  })

  describe('resetAgentConfigOverride', () => {
    it('should reset user override successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { success: true } }),
      })

      const result = await resetAgentConfigOverride('foreground.default')

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/agents/foreground.default/config/override',
        expect.objectContaining({
          method: 'DELETE',
          credentials: 'include',
        }),
      )
      expect(result).toEqual({ success: true })
    })

    it('should throw ApiClientError on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to reset config',
          },
        }),
      })

      await expect(resetAgentConfigOverride('foreground.default')).rejects.toThrow(ApiClientError)
    })
  })
})

describe('AgentConfig Types', () => {
  it('should have correct AgentGlobalConfig structure', () => {
    const config: AgentGlobalConfig = {
      providerId: 'openai',
      model: 'gpt-4',
      systemPrompt: '',
      routingPrompt: '',
      allowedToolIds: ['read_file', 'write_file'],
      allowedSkillIds: ['git'],
      routingTimeoutMs: 30000,
      repairAttempts: 1,
    }

    expect(config.providerId).toBeTypeOf('string')
    expect(config.model).toBeTypeOf('string')
    expect(Array.isArray(config.allowedToolIds)).toBe(true)
    expect(Array.isArray(config.allowedSkillIds)).toBe(true)
    expect(config.routingTimeoutMs).toBeTypeOf('number')
    expect(config.repairAttempts).toBeTypeOf('number')
  })

  it('should have correct AgentUserOverride structure', () => {
    const override: AgentUserOverride = {
      providerId: 'ollama',
      model: 'llama2',
      systemPrompt: '',
      routingPrompt: '',
      allowedToolIds: ['read_file'],
      allowedSkillIds: ['docker'],
      routingTimeoutMs: 30000,
      repairAttempts: 1,
    }

    expect(override.providerId).toBe('ollama')
    expect(override.routingTimeoutMs).toBe(30000)
  })

  it('should allow inherited AgentUserOverride timing fields to be omitted', () => {
    const override: AgentUserOverride = {
      providerId: 'ollama',
      model: 'llama2',
      systemPrompt: '',
      routingPrompt: '',
      allowedToolIds: ['read_file'],
      allowedSkillIds: ['docker'],
    }

    expect(override.routingTimeoutMs).toBeUndefined()
    expect(override.repairAttempts).toBeUndefined()
  })

  it('should have correct AgentEffectiveConfig structure', () => {
    const effective: AgentEffectiveConfig = {
      providerId: 'openrouter',
      model: 'claude-3-opus',
      systemPrompt: '',
      routingPrompt: '',
      allowedToolIds: ['read_file', 'execute_command'],
      allowedSkillIds: [],
      routingTimeoutMs: 60000,
      repairAttempts: 1,
    }

    expect(effective.providerId).toBe('openrouter')
    expect(effective.allowedToolIds).toHaveLength(2)
  })

  it('should have correct AgentConfig structure with all components', () => {
    const agentConfig: AgentConfig = {
      agentId: 'foreground.default',
      global: {
        providerId: 'openai',
        model: 'gpt-4',
        systemPrompt: '',
        routingPrompt: '',
        allowedToolIds: [],
        allowedSkillIds: [],
        routingTimeoutMs: 30000,
        repairAttempts: 1,
      },
      userOverride: null,
      effective: {
        providerId: 'openai',
        model: 'gpt-4',
        systemPrompt: '',
        routingPrompt: '',
        allowedToolIds: [],
        allowedSkillIds: [],
        routingTimeoutMs: 30000,
        repairAttempts: 1,
      },
    }

    expect(agentConfig.agentId).toBe('foreground.default')
    expect(agentConfig.global).toBeDefined()
    expect(agentConfig.userOverride).toBeNull()
    expect(agentConfig.effective).toBeDefined()
  })

  it('should allow partial update requests', () => {
    const partialGlobal: UpdateAgentGlobalConfigRequest = {
      routingTimeoutMs: 60000,
    }

    const partialOverride: UpdateAgentUserOverrideRequest = {
      model: 'gpt-3.5-turbo',
    }

    expect(partialGlobal.routingTimeoutMs).toBe(60000)
    expect(partialOverride.model).toBe('gpt-3.5-turbo')
  })
})
