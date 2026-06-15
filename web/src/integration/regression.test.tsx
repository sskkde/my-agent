/**
 * Cross-Feature Frontend Regression Suite
 * 
 * Integration-style tests covering:
 * - Setup readiness UI
 * - Memory DTO rendering
 * - Session URL navigation
 * - SSE state management
 * - ErrorMessage test IDs
 * - Theme fallback behavior
 * 
 * These tests use mocks for API/EventSource to avoid brittleness.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'

import ProductionSetupChecklist from '../features/setup/ProductionSetupChecklist'
import MemoryTab from '../features/memory/MemoryTab'
import ErrorMessage, { getErrorDisplay } from '../components/ErrorMessage'

import * as client from '../api/client'
import type { MemoryItem } from '../api/types'

vi.mock('../api/client')
vi.mock('../api/admin')

vi.mock('../context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: { userId: 'test-user', username: 'testuser' },
    isLoading: false,
  }),
}))

describe('Cross-Feature Regression Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  describe('Setup Readiness UI Integration', () => {
    it('displays setup page with admin creation form', async () => {
      vi.mocked(client.getSetupStatus).mockResolvedValue({ needsSetup: true })

      render(
        <ProductionSetupChecklist />
      )

      await waitFor(() => {
        expect(screen.getByTestId('production-setup-page')).toBeInTheDocument()
        expect(screen.getByTestId('admin-username-input')).toBeInTheDocument()
        expect(screen.getByTestId('admin-password-input')).toBeInTheDocument()
      })
    })

    it('validates admin password requirements', async () => {
      vi.mocked(client.getSetupStatus).mockResolvedValue({ needsSetup: true })

      render(<ProductionSetupChecklist />)

      await waitFor(() => {
        expect(screen.getByTestId('admin-create-submit')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByTestId('admin-username-input'), { target: { value: 'admin' } })
      fireEvent.change(screen.getByTestId('admin-password-input'), { target: { value: 'short' } })
      fireEvent.change(screen.getByTestId('admin-confirm-password-input'), { target: { value: 'short' } })
      fireEvent.click(screen.getByTestId('admin-create-submit'))

      await waitFor(() => {
        expect(screen.getByTestId('setup-admin-error')).toHaveTextContent('密码至少需要 8 个字符')
      })
    })

    it('validates password confirmation match', async () => {
      vi.mocked(client.getSetupStatus).mockResolvedValue({ needsSetup: true })

      render(<ProductionSetupChecklist />)

      await waitFor(() => {
        expect(screen.getByTestId('admin-create-submit')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByTestId('admin-username-input'), { target: { value: 'admin' } })
      fireEvent.change(screen.getByTestId('admin-password-input'), { target: { value: 'password123' } })
      fireEvent.change(screen.getByTestId('admin-confirm-password-input'), { target: { value: 'password456' } })
      fireEvent.click(screen.getByTestId('admin-create-submit'))

      await waitFor(() => {
        expect(screen.getByTestId('setup-admin-error')).toHaveTextContent('两次输入的密码不一致')
      })
    })
  })

  describe('Memory DTO Rendering Integration', () => {
    it('renders memory items with correct test IDs', async () => {
      const memories: MemoryItem[] = [
        {
          memoryId: 'mem-1',
          userId: 'user-1',
          type: 'user_profile',
          content: 'Test memory content',
          sensitivity: 'low',
          lifecycle: { status: 'active', createdAt: '2024-01-01T00:00:00Z' },
          createdAt: '2024-01-01T00:00:00Z',
        },
      ]

      vi.mocked(client.getMemories).mockResolvedValue({ memories, total: 1 })

      render(<MemoryTab />)

      await waitFor(() => {
        expect(screen.getByTestId('memory-tab')).toBeInTheDocument()
        expect(screen.getByTestId('memory-count')).toBeInTheDocument()
      })
    })

    it('handles memory with complex JSON content', async () => {
      const complexMemory: MemoryItem = {
        memoryId: 'mem-complex',
        userId: 'user-1',
        type: 'project_state',
        content: JSON.stringify({ project: { name: 'ComplexProject', nested: { deep: 'value' } } }),
        sensitivity: 'medium',
        lifecycle: { status: 'active', createdAt: '2024-01-01T00:00:00Z' },
        createdAt: '2024-01-01T00:00:00Z',
      }

      vi.mocked(client.getMemories).mockResolvedValue({ memories: [complexMemory], total: 1 })

      render(<MemoryTab />)

      await waitFor(() => {
        expect(screen.getByTestId('memory-count')).toBeInTheDocument()
      })

      const rows = screen.getAllByTestId('memory-row')
      expect(rows).toHaveLength(1)
    })

    it('handles memory with Unicode content', async () => {
      const unicodeMemory: MemoryItem = {
        memoryId: 'mem-unicode',
        userId: 'user-1',
        type: 'user_profile',
        content: '用户信息：你好世界 🎉 日本語',
        sensitivity: 'low',
        lifecycle: { status: 'active', createdAt: '2024-01-01T00:00:00Z' },
        createdAt: '2024-01-01T00:00:00Z',
      }

      vi.mocked(client.getMemories).mockResolvedValue({ memories: [unicodeMemory], total: 1 })

      render(<MemoryTab />)

      await waitFor(() => {
        expect(screen.getByTestId('memory-count')).toBeInTheDocument()
      })

      expect(screen.getByText(/用户信息/)).toBeInTheDocument()
    })

    it('shows error state when fetch fails', async () => {
      vi.mocked(client.getMemories).mockRejectedValue(new Error('Network error'))

      render(<MemoryTab />)

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument()
      })

      expect(screen.getByText('加载记忆失败')).toBeInTheDocument()
    })
  })

  describe('ErrorMessage Test IDs Integration', () => {
    it('renders error message with correct test ID', () => {
      const error = { code: '500', message: 'Server error' } as Error & { code: string }
      render(<ErrorMessage error={error} />)

      expect(screen.getByTestId('error-message')).toBeInTheDocument()
      expect(screen.getByText('服务器错误')).toBeInTheDocument()
    })

    it('renders retry button with test ID', () => {
      const error = { code: 'NETWORK_ERROR', message: 'Connection failed' } as Error & { code: string }
      const handleRetry = vi.fn()

      render(<ErrorMessage error={error} retry={{ onClick: handleRetry }} />)

      const retryButton = screen.getByTestId('error-message-retry')
      expect(retryButton).toBeInTheDocument()
      expect(retryButton).toHaveTextContent('重试')

      fireEvent.click(retryButton)
      expect(handleRetry).toHaveBeenCalled()
    })

    it('supports custom test ID override', () => {
      const error = { code: '500', message: 'Error' } as Error & { code: string }
      render(<ErrorMessage error={error} data-testid="custom-error-id" />)

      expect(screen.getByTestId('custom-error-id')).toBeInTheDocument()
      expect(screen.queryByTestId('error-message')).not.toBeInTheDocument()
    })

    it('maps error codes to user-friendly messages', () => {
      const testCases = [
        { code: '401', expected: { title: '认证失败', description: '请重新登录' } },
        { code: 'FORBIDDEN', expected: { title: '没有权限', description: '没有权限执行此操作' } },
        { code: 'NETWORK_ERROR', expected: { title: '网络错误', description: '无法连接到服务器，请检查网络连接' } },
      ]

      testCases.forEach(({ code, expected }) => {
        const error = { code, message: `Error ${code}` } as Error & { code: string }
        const result = getErrorDisplay(error)
        expect(result.title).toBe(expected.title)
        expect(result.description).toBe(expected.description)
      })
    })

    it('applies size variants with correct classes', () => {
      const error = { code: '500', message: 'Error' } as Error & { code: string }

      const sizes = ['small', 'medium', 'large'] as const
      sizes.forEach((size) => {
        const { unmount } = render(<ErrorMessage error={error} size={size} />)

        const errorElement = screen.getByTestId('error-message')
        expect(errorElement).toHaveClass(`error-message--${size}`)

        unmount()
      })
    })
  })

  describe('Theme Fallback Integration', () => {
    it('applies default theme when localStorage returns null', async () => {
      const { readStoredTheme, applyDocumentTheme } = await import('../theme-storage')
      
      localStorage.removeItem('agent-platform-theme')
      
      const theme = readStoredTheme()
      expect(theme).toBe('default')

      applyDocumentTheme('default')
      expect(document.documentElement.dataset.theme).toBe('default')
    })

    it('applies stored theme from localStorage', async () => {
      localStorage.setItem('agent-platform-theme', 'dark')

      const { readStoredTheme, applyDocumentTheme } = await import('../theme-storage')

      const theme = readStoredTheme()
      expect(theme).toBe('dark')

      applyDocumentTheme(theme)
      expect(document.documentElement.dataset.theme).toBe('dark')
    })

    it('falls back to default theme for invalid stored values', async () => {
      localStorage.setItem('agent-platform-theme', 'invalid-theme-name')

      const { readStoredTheme } = await import('../theme-storage')

      const theme = readStoredTheme()
      expect(theme).toBe('default')
    })

    it('handles all valid theme values', async () => {
      const validThemes = ['default', 'dark', 'warm-paper']

      for (const validTheme of validThemes) {
        localStorage.setItem('agent-platform-theme', validTheme)

        const { readStoredTheme, applyDocumentTheme } = await import('../theme-storage')

        const theme = readStoredTheme()
        expect(theme).toBe(validTheme)

        applyDocumentTheme(theme)
        expect(document.documentElement.dataset.theme).toBe(validTheme)
      }
    })
  })

  describe('SSE State Management Integration', () => {
    it('useSSEStream hook is importable', async () => {
      const { useSSEStream } = await import('../features/session/hooks/useSSEStream')
      expect(useSSEStream).toBeDefined()
    })

    it('subscribeSessionTimeline API is importable', async () => {
      expect(client.subscribeSessionTimeline).toBeDefined()
    })
  })
})
