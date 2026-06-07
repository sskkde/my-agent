import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import MemoryTab from './MemoryTab'
import type { MemoryItem } from '../../api/types'

vi.mock('../../api/client', () => ({
  getMemories: vi.fn(),
  deleteMemory: vi.fn(),
}))

import { getMemories, deleteMemory } from '../../api/client'

const mockMemories: MemoryItem[] = [
  {
    memoryId: 'mem-1',
    userId: 'user-1',
    type: 'user_profile',
    content: 'This is the first memory content with some user profile information.',
    sensitivity: 'low',
    lifecycle: { status: 'active', createdAt: '2024-01-01T00:00:00Z' },
    keywords: ['profile', 'user'],
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    memoryId: 'mem-2',
    userId: 'user-1',
    type: 'user_preference',
    content: 'This is the second memory content with user preferences.',
    sensitivity: 'medium',
    lifecycle: { status: 'active', createdAt: '2024-01-02T00:00:00Z' },
    keywords: ['preference', 'settings'],
    createdAt: '2024-01-02T00:00:00Z',
  },
  {
    memoryId: 'mem-3',
    userId: 'user-1',
    type: 'project_state',
    content: 'This is the third memory content with project state.',
    sensitivity: 'high',
    lifecycle: { status: 'archived', createdAt: '2024-01-03T00:00:00Z' },
    createdAt: '2024-01-03T00:00:00Z',
  },
]

describe('MemoryTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getMemories as ReturnType<typeof vi.fn>).mockResolvedValue({ memories: [], total: 0 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders memory management tab with testid', () => {
    render(<MemoryTab />)
    expect(screen.getByTestId('memory-tab')).toBeDefined()
  })

  it('renders search input', () => {
    render(<MemoryTab />)
    expect(screen.getByTestId('memory-search-input')).toBeDefined()
  })

  it('renders loading state initially', () => {
    render(<MemoryTab />)
    expect(screen.getByTestId('memory-loading')).toBeDefined()
  })

  it('shows empty state when no memories', async () => {
    ;(getMemories as ReturnType<typeof vi.fn>).mockResolvedValue({ memories: [], total: 0 })

    render(<MemoryTab />)

    await waitFor(() => {
      expect(screen.getByTestId('memory-count')).toBeInTheDocument()
    })

    expect(screen.getByText('暂无记忆')).toBeInTheDocument()
  })

  it('shows error state on fetch failure', async () => {
    ;(getMemories as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'))

    render(<MemoryTab />)

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument()
    })

    expect(screen.getByText('加载记忆失败')).toBeInTheDocument()
  })

  it('renders memory list after loading', async () => {
    ;(getMemories as ReturnType<typeof vi.fn>).mockResolvedValue({ memories: mockMemories, total: 3 })

    render(<MemoryTab />)

    await waitFor(() => {
      expect(screen.getByTestId('memory-count')).toBeInTheDocument()
    })

    expect(screen.getByText('共 3 条记忆')).toBeInTheDocument()
    const rows = screen.getAllByTestId('memory-row')
    expect(rows).toHaveLength(3)
  })

  it('searches memories when clicking search button', async () => {
    ;(getMemories as ReturnType<typeof vi.fn>).mockResolvedValue({ memories: mockMemories, total: 3 })

    render(<MemoryTab />)

    await waitFor(() => {
      expect(screen.getByTestId('memory-count')).toBeInTheDocument()
    })

    const searchInput = screen.getByTestId('memory-search-input')
    fireEvent.change(searchInput, { target: { value: 'profile' } })
    fireEvent.click(screen.getByText('搜索'))

    await waitFor(() => {
      expect(getMemories).toHaveBeenCalledWith({ query: 'profile', limit: 50 })
    })
  })

  it('searches memories when pressing Enter key', async () => {
    ;(getMemories as ReturnType<typeof vi.fn>).mockResolvedValue({ memories: mockMemories, total: 3 })

    render(<MemoryTab />)

    await waitFor(() => {
      expect(screen.getByTestId('memory-count')).toBeInTheDocument()
    })

    const searchInput = screen.getByTestId('memory-search-input')
    fireEvent.change(searchInput, { target: { value: 'preference' } })
    fireEvent.keyDown(searchInput, { key: 'Enter' })

    await waitFor(() => {
      expect(getMemories).toHaveBeenCalledWith({ query: 'preference', limit: 50 })
    })
  })

  it('expands detail when clicking memory row', async () => {
    ;(getMemories as ReturnType<typeof vi.fn>).mockResolvedValue({ memories: mockMemories, total: 3 })

    render(<MemoryTab />)

    await waitFor(() => {
      expect(screen.getByTestId('memory-count')).toBeInTheDocument()
    })

    const rows = screen.getAllByTestId('memory-row')
    fireEvent.click(rows[0])

    await waitFor(() => {
      expect(screen.getByText('记忆详情')).toBeInTheDocument()
    })

    // Detail view shows memory ID
    expect(screen.getByText('mem-1')).toBeInTheDocument()
    // Type and sensitivity labels appear in both list row and detail, so use getAllByText
    expect(screen.getAllByText('用户画像').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('低').length).toBeGreaterThanOrEqual(1)
  })

  it('shows full content and keywords in detail view', async () => {
    ;(getMemories as ReturnType<typeof vi.fn>).mockResolvedValue({ memories: mockMemories, total: 3 })

    render(<MemoryTab />)

    await waitFor(() => {
      expect(screen.getByTestId('memory-count')).toBeInTheDocument()
    })

    const rows = screen.getAllByTestId('memory-row')
    fireEvent.click(rows[0])

    await waitFor(() => {
      expect(screen.getByText('记忆详情')).toBeInTheDocument()
    })

    // Content appears in both list row (truncated) and detail view (full), so use getAllByText
    expect(
      screen.getAllByText('This is the first memory content with some user profile information.').length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('profile')).toBeInTheDocument()
    expect(screen.getByText('user')).toBeInTheDocument()
  })

  it('deletes memory after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    ;(getMemories as ReturnType<typeof vi.fn>).mockResolvedValue({ memories: mockMemories, total: 3 })
    ;(deleteMemory as ReturnType<typeof vi.fn>).mockResolvedValue({ deleted: true, memoryId: 'mem-1' })

    render(<MemoryTab />)

    await waitFor(() => {
      expect(screen.getByTestId('memory-count')).toBeInTheDocument()
    })

    const deleteButtons = screen.getAllByTestId('memory-delete-mem-1')
    fireEvent.click(deleteButtons[0])

    expect(window.confirm).toHaveBeenCalledWith('确定要删除这条记忆吗？')

    await waitFor(() => {
      expect(deleteMemory).toHaveBeenCalledWith('mem-1')
    })

    await waitFor(() => {
      expect(screen.getByTestId('memory-toast')).toBeInTheDocument()
    })

    expect(screen.getByText('记忆已删除')).toBeInTheDocument()
  })

  it('does not delete memory when confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    ;(getMemories as ReturnType<typeof vi.fn>).mockResolvedValue({ memories: mockMemories, total: 3 })

    render(<MemoryTab />)

    await waitFor(() => {
      expect(screen.getByTestId('memory-count')).toBeInTheDocument()
    })

    const deleteButtons = screen.getAllByTestId('memory-delete-mem-1')
    fireEvent.click(deleteButtons[0])

    expect(window.confirm).toHaveBeenCalledWith('确定要删除这条记忆吗？')
    expect(deleteMemory).not.toHaveBeenCalled()
  })

  it('shows error toast when delete fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    ;(getMemories as ReturnType<typeof vi.fn>).mockResolvedValue({ memories: mockMemories, total: 3 })
    ;(deleteMemory as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Delete failed'))

    render(<MemoryTab />)

    await waitFor(() => {
      expect(screen.getByTestId('memory-count')).toBeInTheDocument()
    })

    const deleteButtons = screen.getAllByTestId('memory-delete-mem-1')
    fireEvent.click(deleteButtons[0])

    await waitFor(() => {
      expect(screen.getByTestId('memory-toast')).toBeInTheDocument()
    })

    expect(screen.getByText('删除失败，请重试')).toBeInTheDocument()
  })
})
