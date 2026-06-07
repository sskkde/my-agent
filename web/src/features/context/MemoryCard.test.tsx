/**
 * Tests for MemoryCard component
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import MemoryCard from './MemoryCard'
import type { MemoryCardData } from './card-contracts'
import { loading, ready, empty, error } from './card-state'
import type { MemoryItem } from '../../api/types'

describe('MemoryCard', () => {
  const mockMemories: MemoryItem[] = [
    {
      memoryId: 'memory-1',
      userId: 'user-1',
      type: 'preference',
      content: 'User prefers dark mode',
      sensitivity: 'low',
      lifecycle: {
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
      },
      createdAt: '2024-01-01T00:00:00Z',
    },
    {
      memoryId: 'memory-2',
      userId: 'user-1',
      type: 'context',
      content: 'Working on React project',
      sensitivity: 'medium',
      lifecycle: {
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
      },
      createdAt: '2024-01-01T00:00:00Z',
    },
  ]

  describe('loading state', () => {
    it('renders loading state', () => {
      render(<MemoryCard state={loading()} />)
      
      expect(screen.getByTestId('context-card-memory')).toBeInTheDocument()
      expect(screen.getByText('加载中...')).toBeInTheDocument()
    })
  })

  describe('error state', () => {
    it('renders error state', () => {
      const errorState = error('Failed to load memories', 'MEMORY_ERROR', true)
      render(<MemoryCard state={errorState} />)
      
      expect(screen.getByText('Failed to load memories')).toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('renders empty state', () => {
      const emptyState = empty('暂无记忆条目', '系统尚未存储任何记忆')
      render(<MemoryCard state={emptyState} />)
      
      expect(screen.getByText('暂无记忆条目')).toBeInTheDocument()
      expect(screen.getByText('系统尚未存储任何记忆')).toBeInTheDocument()
    })
  })

  describe('ready state', () => {
    it('renders memory list', () => {
      const readyState = ready<MemoryCardData>({
        memories: mockMemories,
        total: 2,
      })
      
      render(<MemoryCard state={readyState} />)
      
      expect(screen.getByText('preference')).toBeInTheDocument()
      expect(screen.getByText('context')).toBeInTheDocument()
      expect(screen.getByText('User prefers dark mode')).toBeInTheDocument()
      expect(screen.getByText('Working on React project')).toBeInTheDocument()
    })

    it('respects maxItems prop', () => {
      const readyState = ready<MemoryCardData>({
        memories: mockMemories,
        total: 2,
      })
      
      render(<MemoryCard state={readyState} maxItems={1} />)
      
      expect(screen.getByText('preference')).toBeInTheDocument()
      expect(screen.queryByText('context')).not.toBeInTheDocument()
      expect(screen.getByText(/还有 1 项/)).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('has correct test ID', () => {
      render(<MemoryCard state={loading()} />)
      expect(screen.getByTestId('context-card-memory')).toBeInTheDocument()
    })
  })
})
