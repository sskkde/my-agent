import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { handleSkill, handleUsage, handleLogs, handleDebug, handleExportSession, dataHandlers } from './data.js'
import type { CommandContext } from '../types.js'
import * as client from '../../api/client.js'

vi.mock('../../api/client.js')

const createMockContext = (sessionId: string | null = null): CommandContext => ({
  sessionId,
  setSelectedSessionId: vi.fn(),
  refreshSessions: vi.fn(),
  setActiveTab: vi.fn(),
  refreshProviders: vi.fn(),
  auth: { isAuthenticated: true, logout: vi.fn() },
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
})

describe('dataHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handleSkill', () => {
    it('should list all skills when no args provided', async () => {
      const mockSkills = [
        { skillId: 'skill1', name: 'Skill One', description: 'First skill', category: 'read', sensitivity: 'low', enabled: true, source: 'builtin' },
        { skillId: 'skill2', name: 'Skill Two', description: 'Second skill', category: 'write', sensitivity: 'medium', enabled: false, source: 'user' },
      ]
      ;(client.getSkills as Mock).mockResolvedValue({ skills: mockSkills })

      const result = await handleSkill([], createMockContext())

      expect(result.success).toBe(true)
      expect((result.data as { total: number })?.total).toBe(2)
      expect(result.output?.type).toBe('structured')
    })

    it('should filter skill by skillId when provided', async () => {
      const mockSkills = [
        { skillId: 'skill1', name: 'Skill One', description: 'First skill', category: 'read', sensitivity: 'low', enabled: true, source: 'builtin' },
        { skillId: 'skill2', name: 'Skill Two', description: 'Second skill', category: 'write', sensitivity: 'medium', enabled: false, source: 'user' },
      ]
      ;(client.getSkills as Mock).mockResolvedValue({ skills: mockSkills })

      const result = await handleSkill(['skill1'], createMockContext())

      expect(result.success).toBe(true)
      expect((result.data as { skillId: string })?.skillId).toBe('skill1')
      expect(result.output?.type).toBe('structured')
    })

    it('should return error when skillId not found', async () => {
      const mockSkills = [{ skillId: 'skill1', name: 'Skill One', description: 'First skill', category: 'read', sensitivity: 'low', enabled: true, source: 'builtin' }]
      ;(client.getSkills as Mock).mockResolvedValue({ skills: mockSkills })

      const result = await handleSkill(['nonexistent'], createMockContext())

      expect(result.success).toBe(false)
      expect(result.error).toContain('Skill not found')
      expect(result.output?.type).toBe('error')
    })

    it('should return message when no skills exist', async () => {
      ;(client.getSkills as Mock).mockResolvedValue({ skills: [] })

      const result = await handleSkill([], createMockContext())

      expect(result.success).toBe(true)
      expect(result.output?.content).toBe('No skills found')
    })

    it('should handle API errors', async () => {
      ;(client.getSkills as Mock).mockRejectedValue(new Error('Network error'))

      const result = await handleSkill([], createMockContext())

      expect(result.success).toBe(false)
      expect(result.error).toContain('Network error')
    })
  })

  describe('handleUsage', () => {
    it('should show session usage when session is selected', async () => {
      const mockUsage = {
        sessionId: 'session-123',
        messageCount: 10,
        turnCount: 5,
        toolCallCount: 3,
        approvalCount: 0,
        artifactCount: 2,
        runCount: 1,
        estimatedInputTokens: 1000,
        estimatedOutputTokens: 500,
        estimatedTotalTokens: 1500,
        estimatedCostCents: 10,
        updatedAt: new Date().toISOString(),
      }
      ;(client.getSessionUsage as Mock).mockResolvedValue({ usage: mockUsage })

      const result = await handleUsage([], createMockContext('session-123'))

      expect(result.success).toBe(true)
      expect((result.data as { sessionId: string })?.sessionId).toBe('session-123')
      expect(result.output?.type).toBe('structured')
    })

    it('should show global usage with --all flag', async () => {
      const mockUsages = [
        { sessionId: 'session-1', messageCount: 10, toolCallCount: 2, estimatedTotalTokens: 1000 },
        { sessionId: 'session-2', messageCount: 20, toolCallCount: 4, estimatedTotalTokens: 2000 },
      ]
      ;(client.getUsage as Mock).mockResolvedValue({ usages: mockUsages, total: 2 })

      const result = await handleUsage(['--all'], createMockContext())

      expect(result.success).toBe(true)
      expect((result.data as { usages: unknown[] })?.usages).toHaveLength(2)
    })

    it('should show specific session with --session flag', async () => {
      const mockUsage = {
        sessionId: 'specific-session',
        messageCount: 15,
        turnCount: 8,
        toolCallCount: 5,
        approvalCount: 0,
        artifactCount: 1,
        runCount: 1,
        estimatedInputTokens: 2000,
        estimatedOutputTokens: 1000,
        estimatedTotalTokens: 3000,
        estimatedCostCents: null,
        updatedAt: new Date().toISOString(),
      }
      ;(client.getSessionUsage as Mock).mockResolvedValue({ usage: mockUsage })

      const result = await handleUsage(['--session', 'specific-session'], createMockContext())

      expect(result.success).toBe(true)
      expect((result.data as { sessionId: string })?.sessionId).toBe('specific-session')
    })

    it('should show specific session with positional arg', async () => {
      const mockUsage = {
        sessionId: 'positional-session',
        messageCount: 8,
        turnCount: 4,
        toolCallCount: 2,
        approvalCount: 0,
        artifactCount: 0,
        runCount: 1,
        estimatedInputTokens: 500,
        estimatedOutputTokens: 250,
        estimatedTotalTokens: 750,
        estimatedCostCents: 5,
        updatedAt: new Date().toISOString(),
      }
      ;(client.getSessionUsage as Mock).mockResolvedValue({ usage: mockUsage })

      const result = await handleUsage(['positional-session'], createMockContext())

      expect(result.success).toBe(true)
      expect((result.data as { sessionId: string })?.sessionId).toBe('positional-session')
    })

    it('should fall back to global usage when no session selected', async () => {
      const mockUsages = [{ sessionId: 's1', messageCount: 5, toolCallCount: 1, estimatedTotalTokens: 500 }]
      ;(client.getUsage as Mock).mockResolvedValue({ usages: mockUsages, total: 1 })

      const result = await handleUsage([], createMockContext(null))

      expect(result.success).toBe(true)
      expect(client.getUsage).toHaveBeenCalledWith(undefined, 10, 0)
    })

    it('should handle API errors', async () => {
      ;(client.getUsage as Mock).mockRejectedValue(new Error('API error'))

      const result = await handleUsage(['--all'], createMockContext())

      expect(result.success).toBe(false)
      expect(result.error).toContain('API error')
    })
  })

  describe('handleLogs', () => {
    it('should get logs with default filters', async () => {
      const mockLogs = [
        {
          eventId: 'e1',
          eventType: 'user_message',
          sourceModule: 'gateway',
          severity: 'info',
          summary: 'Test',
          createdAt: new Date().toISOString(),
        },
      ]
      ;(client.getLogs as Mock).mockResolvedValue({ logs: mockLogs, total: 1 })

      const result = await handleLogs([], createMockContext())

      expect(result.success).toBe(true)
      expect((result.data as { logs: unknown[] })?.logs).toHaveLength(1)
      expect(client.getLogs).toHaveBeenCalledWith(undefined, undefined, undefined, 10, 0)
    })

    it('should filter logs by --session flag', async () => {
      const mockLogs = [
        {
          eventId: 'e1',
          eventType: 'test',
          sourceModule: 'mod',
          severity: 'info',
          summary: 's',
          createdAt: new Date().toISOString(),
        },
      ]
      ;(client.getLogs as Mock).mockResolvedValue({ logs: mockLogs, total: 1 })

      await handleLogs(['--session', 'session-123'], createMockContext())

      expect(client.getLogs).toHaveBeenCalledWith('session-123', undefined, undefined, 10, 0)
    })

    it('should filter logs by --event-type flag', async () => {
      const mockLogs = [
        {
          eventId: 'e1',
          eventType: 'user_message',
          sourceModule: 'mod',
          severity: 'info',
          summary: 's',
          createdAt: new Date().toISOString(),
        },
      ]
      ;(client.getLogs as Mock).mockResolvedValue({ logs: mockLogs, total: 1 })

      await handleLogs(['--event-type', 'user_message'], createMockContext())

      expect(client.getLogs).toHaveBeenCalledWith(undefined, undefined, 'user_message', 10, 0)
    })

    it('should filter logs by --source flag', async () => {
      const mockLogs = [
        {
          eventId: 'e1',
          eventType: 'test',
          sourceModule: 'gateway',
          severity: 'info',
          summary: 's',
          createdAt: new Date().toISOString(),
        },
      ]
      ;(client.getLogs as Mock).mockResolvedValue({ logs: mockLogs, total: 1 })

      await handleLogs(['--source', 'gateway'], createMockContext())

      expect(client.getLogs).toHaveBeenCalledWith(undefined, 'gateway', undefined, 10, 0)
    })

    it('should limit logs with --limit flag', async () => {
      const mockLogs = [
        {
          eventId: 'e1',
          eventType: 'test',
          sourceModule: 'mod',
          severity: 'info',
          summary: 's',
          createdAt: new Date().toISOString(),
        },
      ]
      ;(client.getLogs as Mock).mockResolvedValue({ logs: mockLogs, total: 1 })

      await handleLogs(['--limit', '25'], createMockContext())

      expect(client.getLogs).toHaveBeenCalledWith(undefined, undefined, undefined, 25, 0)
    })

    it('should use selected session by default', async () => {
      const mockLogs = [
        {
          eventId: 'e1',
          eventType: 'test',
          sourceModule: 'mod',
          severity: 'info',
          summary: 's',
          createdAt: new Date().toISOString(),
        },
      ]
      ;(client.getLogs as Mock).mockResolvedValue({ logs: mockLogs, total: 1 })

      await handleLogs([], createMockContext('selected-session'))

      expect(client.getLogs).toHaveBeenCalledWith('selected-session', undefined, undefined, 10, 0)
    })

    it('should show message when no logs found', async () => {
      ;(client.getLogs as Mock).mockResolvedValue({ logs: [], total: 0 })

      const result = await handleLogs([], createMockContext())

      expect(result.success).toBe(true)
      expect(result.output?.content).toBe('No logs found')
    })

    it('should handle API errors', async () => {
      ;(client.getLogs as Mock).mockRejectedValue(new Error('Log error'))

      const result = await handleLogs([], createMockContext())

      expect(result.success).toBe(false)
      expect(result.error).toContain('Log error')
    })
  })

  describe('handleDebug', () => {
    it('should get debug replay for selected session', async () => {
      const mockDebug = {
        sessionId: 'session-123',
        eventCount: 50,
        transcriptCount: 10,
        runRefs: ['run-1', 'run-2'],
        approvalRefs: ['app-1'],
        lastEventId: 'evt-50',
      }
      ;(client.getDebugReplay as Mock).mockResolvedValue(mockDebug)

      const result = await handleDebug([], createMockContext('session-123'))

      expect(result.success).toBe(true)
      expect((result.data as { eventCount: number })?.eventCount).toBe(50)
      expect((result.data as { transcriptCount: number })?.transcriptCount).toBe(10)
      expect(client.getDebugReplay).toHaveBeenCalledWith('session-123')
    })

    it('should get debug replay for specified session ID', async () => {
      const mockDebug = {
        sessionId: 'specified-session',
        eventCount: 30,
        transcriptCount: 5,
        runRefs: [],
        approvalRefs: [],
        lastEventId: null,
      }
      ;(client.getDebugReplay as Mock).mockResolvedValue(mockDebug)

      const result = await handleDebug(['specified-session'], createMockContext('other-session'))

      expect(result.success).toBe(true)
      expect(client.getDebugReplay).toHaveBeenCalledWith('specified-session')
    })

    it('should return error when no session specified', async () => {
      const result = await handleDebug([], createMockContext(null))

      expect(result.success).toBe(false)
      expect(result.error).toBe('No session specified')
    })

    it('should handle API errors', async () => {
      ;(client.getDebugReplay as Mock).mockRejectedValue(new Error('Debug error'))

      const result = await handleDebug([], createMockContext('session-123'))

      expect(result.success).toBe(false)
      expect(result.error).toContain('Debug error')
    })
  })

  describe('handleExportSession', () => {
    beforeEach(() => {
      global.URL.createObjectURL = vi.fn(() => 'blob-url')
      global.URL.revokeObjectURL = vi.fn()
      document.createElement = vi.fn((tag: string) => {
        if (tag === 'a') {
          return {
            href: '',
            download: '',
            click: vi.fn(),
          } as unknown as HTMLAnchorElement
        }
        return document.createElement(tag)
      })
      document.body.appendChild = vi.fn()
      document.body.removeChild = vi.fn()
    })

    it('should export selected session transcripts', async () => {
      const mockTranscripts = [
        {
          turnId: 't1',
          sessionId: 'session-123',
          userId: 'u1',
          input: {},
          output: { visibleMessages: [] },
          visibility: 'public',
          createdAt: new Date().toISOString(),
        },
      ]
      ;(client.getTranscripts as Mock).mockResolvedValue({ transcripts: mockTranscripts, total: 1 })

      const result = await handleExportSession([], createMockContext('session-123'))

      expect(result.success).toBe(true)
      expect((result.data as { transcriptCount: number })?.transcriptCount).toBe(1)
      expect((result.data as { sessionId: string })?.sessionId).toBe('session-123')
    })

    it('should export specified session transcripts', async () => {
      const mockTranscripts = [
        {
          turnId: 't1',
          sessionId: 'specified',
          userId: 'u1',
          input: {},
          output: { visibleMessages: [] },
          visibility: 'public',
          createdAt: new Date().toISOString(),
        },
      ]
      ;(client.getTranscripts as Mock).mockResolvedValue({ transcripts: mockTranscripts, total: 1 })

      const result = await handleExportSession(['specified-session'], createMockContext('other-session'))

      expect(result.success).toBe(true)
      expect(client.getTranscripts).toHaveBeenCalledWith('specified-session')
    })

    it('should return error when no session specified', async () => {
      const result = await handleExportSession([], createMockContext(null))

      expect(result.success).toBe(false)
      expect(result.error).toBe('No session specified')
    })

    it('should handle API errors', async () => {
      ;(client.getTranscripts as Mock).mockRejectedValue(new Error('Export error'))

      const result = await handleExportSession([], createMockContext('session-123'))

      expect(result.success).toBe(false)
      expect(result.error).toContain('Export error')
    })
  })

  describe('dataHandlers export', () => {
    it('should export all handler functions', () => {
      expect(dataHandlers.skill).toBe(handleSkill)
      expect(dataHandlers.usage).toBe(handleUsage)
      expect(dataHandlers.logs).toBe(handleLogs)
      expect(dataHandlers.debug).toBe(handleDebug)
      expect(dataHandlers['export-session']).toBe(handleExportSession)
    })
  })
})
