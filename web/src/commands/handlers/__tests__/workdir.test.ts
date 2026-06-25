import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest'
import type { CommandContext } from '../../types.js'
import { workdirHandlers } from '../workdir.js'

describe('Workdir Command Handlers', () => {
  let mockContext: CommandContext

  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()

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

  describe('workdir (no args)', () => {
    it('should return usage help when no subcommand given', async () => {
      const result = await workdirHandlers.workdir([], mockContext)

      expect(result.success).toBe(false)
      expect(result.output?.content).toContain('Usage: /workdir <subcommand>')
      expect(result.output?.content).toContain('list')
      expect(result.output?.content).toContain('new')
      expect(result.output?.content).toContain('switch')
      expect(result.output?.content).toContain('pwd')
      expect(result.output?.content).toContain('tree')
    })

    it('should return error for unknown subcommand', async () => {
      const result = await workdirHandlers.workdir(['unknown'], mockContext)

      expect(result.success).toBe(false)
      expect(result.output?.content).toContain('Unknown workdir subcommand: unknown')
    })
  })

  describe('workdir list', () => {
    it('should list user workdirs', async () => {
      const mockWorkdirs = [
        { id: 'wd-1', userId: 'user-1', name: 'default', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
        { id: 'wd-2', userId: 'user-1', name: 'project-a', createdAt: '2025-01-02T00:00:00Z', updatedAt: '2025-01-02T00:00:00Z' },
      ]

      vi.mocked(mockContext.api.get).mockResolvedValue({
        workdirs: mockWorkdirs,
        total: 2,
      })

      const result = await workdirHandlers.workdir(['list'], mockContext)

      expect(mockContext.api.get).toHaveBeenCalledWith('/workdirs')
      expect(result.success).toBe(true)
      expect(result.output?.content).toContain('Workdirs (2)')
      expect(result.output?.content).toContain('default')
      expect(result.output?.content).toContain('project-a')
      expect((result.data as { workdirs: unknown[] }).workdirs).toHaveLength(2)
    })

    it('should return message when no workdirs exist', async () => {
      vi.mocked(mockContext.api.get).mockResolvedValue({
        workdirs: [],
        total: 0,
      })

      const result = await workdirHandlers.workdir(['list'], mockContext)

      expect(result.success).toBe(true)
      expect(result.output?.content).toContain('No workdirs found')
    })

    it('should handle API errors', async () => {
      vi.mocked(mockContext.api.get).mockRejectedValue(new Error('Network error'))

      const result = await workdirHandlers.workdir(['list'], mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Network error')
    })
  })

  describe('workdir new', () => {
    it('should create a new workdir and switch to it', async () => {
      const mockWorkdir = {
        id: 'wd-new',
        userId: 'user-1',
        name: 'my-project',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      }

      vi.mocked(mockContext.api.post).mockResolvedValue({ workdir: mockWorkdir })
      vi.mocked(mockContext.api.put).mockResolvedValue({ workdir: mockWorkdir })

      const result = await workdirHandlers.workdir(['new', 'my-project'], mockContext)

      expect(mockContext.api.post).toHaveBeenCalledWith('/workdirs', { name: 'my-project' })
      expect(mockContext.api.put).toHaveBeenCalledWith('/sessions/session-123/workdir', { workdirId: 'wd-new' })
      expect(mockContext.refreshSessions).toHaveBeenCalled()
      expect(result.success).toBe(true)
      expect(result.output?.content).toContain('Created workdir "my-project"')
      expect(result.output?.content).toContain('Switched to new workdir')
    })

    it('should return error when no session is selected', async () => {
      mockContext.sessionId = null

      const result = await workdirHandlers.workdir(['new', 'my-project'], mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('No session selected')
      expect(mockContext.api.post).not.toHaveBeenCalled()
    })

    it('should return error when name is missing', async () => {
      const result = await workdirHandlers.workdir(['new'], mockContext)

      expect(result.success).toBe(false)
      expect(result.output?.content).toContain('Usage: /workdir new <name>')
    })

    it('should handle API errors', async () => {
      vi.mocked(mockContext.api.post).mockRejectedValue(new Error('Name conflict'))

      const result = await workdirHandlers.workdir(['new', 'existing-name'], mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Name conflict')
    })
  })

  describe('workdir switch', () => {
    it('should switch workdir by id', async () => {
      const mockWorkdirs = [
        { id: 'wd-1', userId: 'user-1', name: 'default', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
        { id: 'wd-2', userId: 'user-1', name: 'project-a', createdAt: '2025-01-02T00:00:00Z', updatedAt: '2025-01-02T00:00:00Z' },
      ]

      vi.mocked(mockContext.api.get).mockResolvedValue({ workdirs: mockWorkdirs, total: 2 })
      vi.mocked(mockContext.api.put).mockResolvedValue({ workdir: mockWorkdirs[1] })

      const result = await workdirHandlers.workdir(['switch', 'wd-2'], mockContext)

      expect(mockContext.api.put).toHaveBeenCalledWith('/sessions/session-123/workdir', { workdirId: 'wd-2' })
      expect(mockContext.refreshSessions).toHaveBeenCalled()
      expect(result.success).toBe(true)
      expect(result.output?.content).toContain('Switched to workdir "project-a"')
    })

    it('should switch workdir by name', async () => {
      const mockWorkdirs = [
        { id: 'wd-1', userId: 'user-1', name: 'default', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
      ]

      vi.mocked(mockContext.api.get).mockResolvedValue({ workdirs: mockWorkdirs, total: 1 })
      vi.mocked(mockContext.api.put).mockResolvedValue({ workdir: mockWorkdirs[0] })

      const result = await workdirHandlers.workdir(['switch', 'default'], mockContext)

      expect(mockContext.api.put).toHaveBeenCalledWith('/sessions/session-123/workdir', { workdirId: 'wd-1' })
      expect(result.success).toBe(true)
    })

    it('should return error when workdir not found', async () => {
      vi.mocked(mockContext.api.get).mockResolvedValue({ workdirs: [], total: 0 })

      const result = await workdirHandlers.workdir(['switch', 'nonexistent'], mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Workdir not found: "nonexistent"')
    })

    it('should return error when no session is selected', async () => {
      mockContext.sessionId = null

      const result = await workdirHandlers.workdir(['switch', 'wd-1'], mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('No session selected')
    })

    it('should return error when identifier is missing', async () => {
      const result = await workdirHandlers.workdir(['switch'], mockContext)

      expect(result.success).toBe(false)
      expect(result.output?.content).toContain('Usage: /workdir switch <id|name>')
    })

    it('should handle API errors during switch', async () => {
      vi.mocked(mockContext.api.get).mockResolvedValue({
        workdirs: [{ id: 'wd-1', userId: 'user-1', name: 'default', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' }],
        total: 1,
      })
      vi.mocked(mockContext.api.put).mockRejectedValue(new Error('Permission denied'))

      const result = await workdirHandlers.workdir(['switch', 'wd-1'], mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Permission denied')
    })
  })

  describe('workdir pwd', () => {
    it('should show active workdir', async () => {
      const mockWorkdir = {
        id: 'wd-1',
        userId: 'user-1',
        name: 'default',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      }

      vi.mocked(mockContext.api.get).mockResolvedValue({ workdir: mockWorkdir })

      const result = await workdirHandlers.workdir(['pwd'], mockContext)

      expect(mockContext.api.get).toHaveBeenCalledWith('/sessions/session-123/workdir')
      expect(result.success).toBe(true)
      expect(result.output?.content).toContain('Active workdir: default')
      expect(result.output?.content).toContain('wd-1')
    })

    it('should show message when no active workdir', async () => {
      vi.mocked(mockContext.api.get).mockResolvedValue({ workdir: null })

      const result = await workdirHandlers.workdir(['pwd'], mockContext)

      expect(result.success).toBe(true)
      expect(result.output?.content).toContain('No active workdir for this session')
    })

    it('should return error when no session is selected', async () => {
      mockContext.sessionId = null

      const result = await workdirHandlers.workdir(['pwd'], mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('No session selected')
    })

    it('should handle API errors', async () => {
      vi.mocked(mockContext.api.get).mockRejectedValue(new Error('Server error'))

      const result = await workdirHandlers.workdir(['pwd'], mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Server error')
    })
  })

  describe('workdir tree', () => {
    it('should show directory tree for active workdir', async () => {
      const mockWorkdir = {
        id: 'wd-1',
        userId: 'user-1',
        name: 'default',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      }

      const mockTree = [
        { name: 'src', type: 'directory' as const, relativePath: 'src' },
        { name: 'package.json', type: 'file' as const, relativePath: 'package.json' },
      ]

      vi.mocked(mockContext.api.get)
        .mockResolvedValueOnce({ workdir: mockWorkdir })
        .mockResolvedValueOnce({ tree: mockTree, path: '/' })

      const result = await workdirHandlers.workdir(['tree'], mockContext)

      expect(mockContext.api.get).toHaveBeenCalledWith('/sessions/session-123/workdir')
      expect(mockContext.api.get).toHaveBeenCalledWith('/workdirs/wd-1/tree')
      expect(result.success).toBe(true)
      expect(result.output?.content).toContain('src')
      expect(result.output?.content).toContain('package.json')
      expect(result.output?.content).toContain('[dir]')
      expect(result.output?.content).toContain('[file]')
    })

    it('should show tree for subpath', async () => {
      const mockWorkdir = {
        id: 'wd-1',
        userId: 'user-1',
        name: 'default',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      }

      vi.mocked(mockContext.api.get)
        .mockResolvedValueOnce({ workdir: mockWorkdir })
        .mockResolvedValueOnce({ tree: [], path: 'src' })

      const result = await workdirHandlers.workdir(['tree', 'src'], mockContext)

      expect(mockContext.api.get).toHaveBeenCalledWith('/workdirs/wd-1/tree?path=src')
      expect(result.success).toBe(true)
    })

    it('should show empty directory message', async () => {
      const mockWorkdir = {
        id: 'wd-1',
        userId: 'user-1',
        name: 'default',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      }

      vi.mocked(mockContext.api.get)
        .mockResolvedValueOnce({ workdir: mockWorkdir })
        .mockResolvedValueOnce({ tree: [], path: '/' })

      const result = await workdirHandlers.workdir(['tree'], mockContext)

      expect(result.success).toBe(true)
      expect(result.output?.content).toContain('Empty directory')
    })

    it('should return error when no active workdir', async () => {
      vi.mocked(mockContext.api.get).mockResolvedValue({ workdir: null })

      const result = await workdirHandlers.workdir(['tree'], mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('No active workdir for this session')
    })

    it('should return error when no session is selected', async () => {
      mockContext.sessionId = null

      const result = await workdirHandlers.workdir(['tree'], mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('No session selected')
    })

    it('should handle API errors', async () => {
      const mockWorkdir = {
        id: 'wd-1',
        userId: 'user-1',
        name: 'default',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      }

      vi.mocked(mockContext.api.get)
        .mockResolvedValueOnce({ workdir: mockWorkdir })
        .mockRejectedValueOnce(new Error('Path not found'))

      const result = await workdirHandlers.workdir(['tree'], mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Path not found')
    })
  })

  describe('workdirHandlers export', () => {
    it('should export workdir handler', () => {
      expect(workdirHandlers.workdir).toBeDefined()
      expect(typeof workdirHandlers.workdir).toBe('function')
    })
  })
})
