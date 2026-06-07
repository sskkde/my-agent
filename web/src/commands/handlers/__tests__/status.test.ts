import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleStatus, handleDiagnostics, handleTools, handleModels, handleModel, handleLogout } from '../status.js'
import type { CommandContext } from '../../types.js'
import * as apiClient from '../../../api/client.js'

vi.mock('../../../api/client.js')

const mockContext: CommandContext = {
  sessionId: 'test-session-123',
  setSelectedSessionId: vi.fn(),
  refreshSessions: vi.fn().mockResolvedValue(undefined),
  setActiveTab: vi.fn(),
  refreshProviders: vi.fn().mockResolvedValue(undefined),
  auth: {
    isAuthenticated: true,
    logout: vi.fn(),
  },
  api: {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },
}

describe('status handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handleStatus', () => {
    it('should return formatted health status', async () => {
      vi.mocked(apiClient.getHealth).mockResolvedValue({
        status: 'healthy',
        modules: {
          api: { status: 'healthy' },
          database: { status: 'healthy' },
          llmGateway: { status: 'healthy' },
        },
        timestamp: new Date().toISOString(),
      })

      const result = await handleStatus([], mockContext)

      expect(result.success).toBe(true)
      expect(result.commandName).toBe('status')
      expect(result.output?.content).toContain('System Status:')
      expect(result.output?.content).toContain('healthy')
      expect(result.output?.content).toContain('API:')
      expect(result.output?.content).toContain('Database:')
      expect(result.output?.content).toContain('LLM Gateway:')
    })

    it('should handle health check error', async () => {
      vi.mocked(apiClient.getHealth).mockRejectedValue(new Error('API Error'))

      const result = await handleStatus([], mockContext)

      expect(result.success).toBe(false)
      expect(result.commandName).toBe('status')
      expect(result.error).toContain('Failed to get system status')
    })
  })

  describe('handleDiagnostics', () => {
    it('should return combined diagnostics info', async () => {
      vi.mocked(apiClient.getHealth).mockResolvedValue({
        status: 'healthy',
        modules: {
          api: { status: 'healthy' },
          database: { status: 'healthy' },
          llmGateway: { status: 'healthy' },
        },
        timestamp: new Date().toISOString(),
      })

      vi.mocked(apiClient.getProviders).mockResolvedValue([
        {
          providerId: 'test-provider',
          displayName: 'Test Provider',
          providerType: 'openai',
          enabled: true,
          configured: true,
          apiKeyLast4: '1234',
          baseUrl: null,
          selectedModel: 'gpt-4',
          source: 'database',
          lastTestStatus: null,
          lastTestedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ])

      const result = await handleDiagnostics([], mockContext)

      expect(result.success).toBe(true)
      expect(result.commandName).toBe('diagnostics')
      expect(result.output?.content).toContain('System Diagnostics:')
      expect(result.output?.content).toContain('Health Status:')
      expect(result.output?.content).toContain('Authentication:')
      expect(result.output?.content).toContain('Providers:')
      expect(result.output?.content).toContain('Test Provider')
      expect(result.output?.content).toContain('Session:')
      expect(result.output?.content).toContain('test-session-123')
    })

    it('should handle providers fetch failure gracefully', async () => {
      vi.mocked(apiClient.getHealth).mockResolvedValue({
        status: 'healthy',
        modules: {
          api: { status: 'healthy' },
          database: { status: 'healthy' },
          llmGateway: { status: 'healthy' },
        },
        timestamp: new Date().toISOString(),
      })

      vi.mocked(apiClient.getProviders).mockRejectedValue(new Error('Provider Error'))

      const result = await handleDiagnostics([], mockContext)

      expect(result.success).toBe(true)
      expect(result.output?.content).toContain('Providers: Unable to fetch provider list')
    })
  })

  describe('handleTools', () => {
    it('should return formatted tools list', async () => {
      vi.mocked(apiClient.getTools).mockResolvedValue({
        tools: [
          {
            name: 'read_file',
            description: 'Read file contents',
            category: 'read',
            sensitivity: 'low',
          },
          {
            name: 'write_file',
            description: 'Write to file',
            category: 'write',
            sensitivity: 'high',
          },
        ],
        total: 2,
      })

      const result = await handleTools([], mockContext)

      expect(result.success).toBe(true)
      expect(result.commandName).toBe('tools')
      expect(result.output?.content).toContain('Available Tools:')
      expect(result.output?.content).toContain('read_file')
      expect(result.output?.content).toContain('write_file')
      expect(result.output?.content).toContain('Total: 2 tools')
    })

    it('should handle empty tools list', async () => {
      vi.mocked(apiClient.getTools).mockResolvedValue({
        tools: [],
        total: 0,
      })

      const result = await handleTools([], mockContext)

      expect(result.success).toBe(true)
      expect(result.output?.content).toBe('No tools available.')
    })

    it('should handle tools fetch error', async () => {
      vi.mocked(apiClient.getTools).mockRejectedValue(new Error('API Error'))

      const result = await handleTools([], mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Failed to get tools')
    })
  })

  describe('handleModels', () => {
    it('should return formatted models list grouped by provider', async () => {
      vi.mocked(apiClient.getProviders).mockResolvedValue([
        {
          providerId: 'provider-1',
          displayName: 'OpenAI',
          providerType: 'openai',
          enabled: true,
          configured: true,
          apiKeyLast4: '1234',
          baseUrl: null,
          selectedModel: 'gpt-4',
          source: 'database',
          lastTestStatus: null,
          lastTestedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          providerId: 'provider-2',
          displayName: 'Ollama',
          providerType: 'ollama',
          enabled: false,
          configured: true,
          apiKeyLast4: null,
          baseUrl: 'http://localhost:11434',
          selectedModel: null,
          source: 'database',
          lastTestStatus: null,
          lastTestedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ])

      const result = await handleModels([], mockContext)

      expect(result.success).toBe(true)
      expect(result.commandName).toBe('models')
      expect(result.output?.content).toContain('Available Models by Provider:')
      expect(result.output?.content).toContain('OpenAI')
      expect(result.output?.content).toContain('Ollama')
      expect(result.output?.content).toContain('gpt-4')
      expect(result.output?.content).toContain('Enabled')
      expect(result.output?.content).toContain('Disabled')
    })

    it('should return message when no providers configured', async () => {
      vi.mocked(apiClient.getProviders).mockResolvedValue([])

      const result = await handleModels([], mockContext)

      expect(result.success).toBe(true)
      expect(result.output?.content).toContain('No providers configured')
    })

    it('should handle providers fetch error', async () => {
      vi.mocked(apiClient.getProviders).mockRejectedValue(new Error('API Error'))

      const result = await handleModels([], mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Failed to get models')
    })
  })

  describe('handleModel', () => {
    it('should show current model when no args provided', async () => {
      const result = await handleModel([], mockContext)

      expect(result.success).toBe(true)
      expect(result.commandName).toBe('model')
      expect(result.output?.content).toContain('No model currently selected')
    })

    it('should return error when model selection attempted', async () => {
      const result = await handleModel(['openai/gpt-4'], mockContext)

      expect(result.success).toBe(false)
      expect(result.commandName).toBe('model')
      expect(result.error).toContain('not yet implemented')
      expect(result.error).toContain('openai/gpt-4')
    })
  })

  describe('handleLogout', () => {
    it('should call logout API and auth context logout', async () => {
      vi.mocked(apiClient.logout).mockResolvedValue({ success: true })

      const result = await handleLogout([], mockContext)

      expect(apiClient.logout).toHaveBeenCalled()
      expect(mockContext.auth.logout).toHaveBeenCalled()
      expect(result.success).toBe(true)
      expect(result.commandName).toBe('logout')
      expect(result.output?.content).toContain('Successfully logged out')
      expect(result.showToast).toBe(true)
      expect(result.toastType).toBe('success')
    })

    it('should handle logout error', async () => {
      vi.mocked(apiClient.logout).mockRejectedValue(new Error('Logout failed'))

      const result = await handleLogout([], mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Logout failed')
      expect(result.showToast).toBe(true)
      expect(result.toastType).toBe('error')
    })
  })
})
