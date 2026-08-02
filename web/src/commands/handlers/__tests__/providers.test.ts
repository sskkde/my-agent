import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CommandContext } from '../../types.js'
import { handleProviderConnect, handleProviders } from '../providers.js'

describe('Provider Command Handlers', () => {
  let mockContext: CommandContext

  beforeEach(() => {
    vi.clearAllMocks()
    mockContext = {
      sessionId: 'session-123',
      setSelectedSessionId: vi.fn(),
      refreshSessions: vi.fn().mockResolvedValue(undefined),
      setActiveTab: vi.fn(),
      refreshProviders: vi.fn().mockResolvedValue(undefined),
      auth: {
        isAuthenticated: true,
        logout: vi.fn(),
      },
      api: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
      },
    }
  })

  describe('handleProviderConnect', () => {
    it('returns success with settings-provider modal intent for a valid provider type', async () => {
      const result = await handleProviderConnect(['openai'], mockContext)

      expect(result.success).toBe(true)
      expect(result.commandName).toBe('provider connect')
      expect(result.output?.type).toBe('text')
      expect(result.output?.content).toContain('Opening settings to configure openai provider')
      expect(result.navigateTo).toBe('settings')
      expect(result.modalDestination).toBe('settings-provider')
    })

    it('normalizes provider type casing to lowercase', async () => {
      const result = await handleProviderConnect(['OpenRouter'], mockContext)

      expect(result.success).toBe(true)
      expect(result.output?.content).toContain('configure openrouter provider')
      expect(result.modalDestination).toBe('settings-provider')
    })

    it('returns usage error without modal intent when no provider type is given', async () => {
      const result = await handleProviderConnect([], mockContext)

      expect(result.success).toBe(false)
      expect(result.commandName).toBe('provider connect')
      expect(result.output?.type).toBe('error')
      expect(result.output?.content).toContain('Usage: /provider connect <provider-type>')
      expect(result.navigateTo).toBeUndefined()
      expect(result.modalDestination).toBeUndefined()
    })

    it('returns error without modal intent for an invalid provider type', async () => {
      const result = await handleProviderConnect(['not-a-provider'], mockContext)

      expect(result.success).toBe(false)
      expect(result.commandName).toBe('provider connect')
      expect(result.output?.type).toBe('error')
      expect(result.output?.content).toContain('Invalid provider type "not-a-provider"')
      expect(result.output?.content).toContain('Valid types:')
      expect(result.navigateTo).toBeUndefined()
      expect(result.modalDestination).toBeUndefined()
    })
  })

  describe('handleProviders', () => {
    it('lists providers and carries no modal intent', async () => {
      ;(mockContext.api.get as ReturnType<typeof vi.fn>).mockResolvedValue([
        { providerId: 'p-1', providerType: 'openai', displayName: 'OpenAI', enabled: true },
      ])

      const result = await handleProviders([], mockContext)

      expect(result.success).toBe(true)
      expect(result.output?.content).toContain('OpenAI (openai)')
      expect(result.output?.content).toContain('Total: 1 provider(s)')
      expect(result.navigateTo).toBeUndefined()
      expect(result.modalDestination).toBeUndefined()
    })

    it('returns error output when the providers fetch fails', async () => {
      ;(mockContext.api.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'))

      const result = await handleProviders([], mockContext)

      expect(result.success).toBe(false)
      expect(result.output?.type).toBe('error')
      expect(result.output?.content).toContain('Failed to fetch providers: network down')
      expect(result.modalDestination).toBeUndefined()
    })
  })
})
