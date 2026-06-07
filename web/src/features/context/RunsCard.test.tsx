/**
 * Tests for RunsCard component
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import RunsCard from './RunsCard'
import type { RunsCardData } from './card-contracts'
import { loading, ready, empty, error } from './card-state'
import type { RunInfo } from '../../api/types'

describe('RunsCard', () => {
  const mockRuns: RunInfo[] = [
    {
      runId: 'run-1',
      status: 'running',
      objective: 'Test objective 1',
      progress: 50,
      createdAt: '2024-01-01T00:00:00Z',
    },
    {
      runId: 'run-2',
      status: 'completed',
      objective: 'Test objective 2',
      progress: 100,
      createdAt: '2024-01-01T00:00:00Z',
    },
    {
      runId: 'run-3',
      status: 'pending',
      objective: 'Test objective 3',
      createdAt: '2024-01-01T00:00:00Z',
    },
  ]

  describe('loading state', () => {
    it('renders loading state', () => {
      render(<RunsCard state={loading()} />)
      
      expect(screen.getByTestId('context-card-runs')).toBeInTheDocument()
      expect(screen.getByText('加载中...')).toBeInTheDocument()
    })
  })

  describe('error state', () => {
    it('renders error state', () => {
      const errorState = error('Failed to load runs', 'RUNS_ERROR', true)
      render(<RunsCard state={errorState} />)
      
      expect(screen.getByText('Failed to load runs')).toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('renders empty state', () => {
      const emptyState = empty('暂无运行记录', '没有后台任务正在运行')
      render(<RunsCard state={emptyState} />)
      
      expect(screen.getByText('暂无运行记录')).toBeInTheDocument()
      expect(screen.getByText('没有后台任务正在运行')).toBeInTheDocument()
    })
  })

  describe('ready state', () => {
    it('renders runs list', () => {
      const readyState = ready<RunsCardData>({
        runs: mockRuns,
        total: 3,
        sessionId: 'session-1',
        streaming: false,
      })
      
      render(<RunsCard state={readyState} />)
      
      expect(screen.getByText('Test objective 1')).toBeInTheDocument()
      expect(screen.getByText('Test objective 2')).toBeInTheDocument()
      expect(screen.getByText('Test objective 3')).toBeInTheDocument()
      expect(screen.getByText('running')).toBeInTheDocument()
      expect(screen.getByText('completed')).toBeInTheDocument()
      expect(screen.getByText('pending')).toBeInTheDocument()
    })

    it('respects maxItems prop', () => {
      const readyState = ready<RunsCardData>({
        runs: mockRuns,
        total: 3,
        sessionId: 'session-1',
        streaming: false,
      })
      
      render(<RunsCard state={readyState} maxItems={2} />)
      
      expect(screen.getByText('Test objective 1')).toBeInTheDocument()
      expect(screen.getByText('Test objective 2')).toBeInTheDocument()
      expect(screen.queryByText('Test objective 3')).not.toBeInTheDocument()
      expect(screen.getByText(/还有 1 项/)).toBeInTheDocument()
    })

    it('displays run ID when objective is missing', () => {
      const runWithoutObjective: RunInfo = {
        runId: 'run-abc123def',
        status: 'running',
        createdAt: '2024-01-01T00:00:00Z',
      }
      
      const readyState = ready<RunsCardData>({
        runs: [runWithoutObjective],
        total: 1,
        sessionId: 'session-1',
        streaming: false,
      })
      
      render(<RunsCard state={readyState} />)
      
      // Should display first 8 characters of run ID
      expect(screen.getByText('run-abc1')).toBeInTheDocument()
    })

    it('displays progress bar when progress > 0', () => {
      const readyState = ready<RunsCardData>({
        runs: mockRuns,
        total: 3,
        sessionId: 'session-1',
        streaming: false,
      })
      
      const { container } = render(<RunsCard state={readyState} />)
      
      // Progress bars should be rendered for runs with progress
      const progressBars = container.querySelectorAll('.context-card__progress-bar')
      expect(progressBars.length).toBeGreaterThan(0)
    })
  })

  describe('accessibility', () => {
    it('has correct test ID', () => {
      render(<RunsCard state={loading()} />)
      expect(screen.getByTestId('context-card-runs')).toBeInTheDocument()
    })
  })
})
