import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import AgentMonitorTab from './AgentMonitorTab'
import type { RunInfo, SseRunEvent } from '../../api/types'

vi.mock('../../api/client', () => ({
  getRuns: vi.fn(),
  subscribeRuns: vi.fn(),
}))

import { getRuns, subscribeRuns } from '../../api/client'

const mockRuns: RunInfo[] = [
  { runId: 'run-1', status: 'running', objective: 'Test run 1', progress: 50, createdAt: '2024-01-01T00:00:00Z' },
  { runId: 'run-2', status: 'pending', objective: 'Test run 2', createdAt: '2024-01-01T01:00:00Z' },
  { runId: 'run-3', status: 'completed', objective: 'Test run 3', createdAt: '2024-01-01T02:00:00Z' },
  { runId: 'run-4', status: 'failed', objective: 'Test run 4', createdAt: '2024-01-01T03:00:00Z' },
]

describe('AgentMonitorTab', () => {
  let mockUnsubscribe: ReturnType<typeof vi.fn>
  let subscribedCallback: ((event: SseRunEvent) => void) | null

  beforeEach(() => {
    vi.clearAllMocks()
    mockUnsubscribe = vi.fn()
    subscribedCallback = null
    ;(getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({ runs: [], total: 0 })
    ;(subscribeRuns as ReturnType<typeof vi.fn>).mockImplementation(((onEvent: (event: SseRunEvent) => void) => {
      subscribedCallback = onEvent
      return mockUnsubscribe
    }) as typeof subscribeRuns)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows empty state when no runs', async () => {
    ;(getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({ runs: [], total: 0 })

    render(<AgentMonitorTab />)

    await waitFor(() => {
      expect(screen.getByTestId('runs-list')).toBeInTheDocument()
    })

    expect(screen.getByText('暂无运行中的任务')).toBeInTheDocument()
  })

  it('renders runs list with data-testid="runs-list"', async () => {
    ;(getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({ runs: mockRuns, total: mockRuns.length })

    render(<AgentMonitorTab />)

    await waitFor(() => {
      expect(screen.getByTestId('runs-list')).toBeInTheDocument()
    })

    expect(screen.getByText('run-1')).toBeInTheDocument()
    expect(screen.getByText('run-2')).toBeInTheDocument()
  })

  it('groups runs by status (active/waiting/terminal)', async () => {
    ;(getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({ runs: mockRuns, total: mockRuns.length })

    render(<AgentMonitorTab />)

    await waitFor(() => {
      expect(screen.getByText('运行中')).toBeInTheDocument()
      expect(screen.getByText('等待中')).toBeInTheDocument()
      expect(screen.getByText('已完成')).toBeInTheDocument()
    })
  })

  it('shows connected SSE status', async () => {
    ;(getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({ runs: [], total: 0 })

    render(<AgentMonitorTab />)

    await waitFor(() => {
      expect(screen.getByTestId('sse-status')).toBeInTheDocument()
    })

    expect(screen.getByTestId('sse-status')).toHaveTextContent('已连接')
  })

  it('updates run list after SSE event', async () => {
    ;(getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({ runs: [], total: 0 })

    render(<AgentMonitorTab />)

    await waitFor(() => {
      expect(screen.getByText('暂无运行中的任务')).toBeInTheDocument()
    })

    const sseEvent: SseRunEvent = {
      type: 'run_started',
      runId: 'new-run',
      data: { objective: 'New run' },
      timestamp: '2024-01-01T00:00:00Z',
    }

    subscribedCallback?.(sseEvent)

    await waitFor(() => {
      expect(screen.getByText('new-run')).toBeInTheDocument()
    })
  })

  it('shows disconnected status on SSE error', async () => {
    ;(getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({ runs: [], total: 0 })
    ;(subscribeRuns as ReturnType<typeof vi.fn>).mockImplementation(((
      _onEvent: (event: SseRunEvent) => void,
      onError?: (error: Error) => void,
    ) => {
      setTimeout(() => {
        onError?.(new Error('SSE connection failed'))
      }, 0)
      return mockUnsubscribe
    }) as typeof subscribeRuns)

    render(<AgentMonitorTab />)

    await waitFor(
      () => {
        expect(screen.getByTestId('sse-status')).toBeInTheDocument()
      },
      { timeout: 2000 },
    )

    await waitFor(
      () => {
        expect(screen.getByTestId('sse-status')).toHaveTextContent('已断开')
      },
      { timeout: 2000 },
    )
  })

  it('shows retry button on disconnect', async () => {
    ;(getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({ runs: [], total: 0 })
    ;(subscribeRuns as ReturnType<typeof vi.fn>).mockImplementation(((
      _onEvent: (event: SseRunEvent) => void,
      onError?: (error: Error) => void,
    ) => {
      setTimeout(() => {
        onError?.(new Error('SSE connection failed'))
      }, 0)
      return mockUnsubscribe
    }) as typeof subscribeRuns)

    render(<AgentMonitorTab />)

    await waitFor(
      () => {
        expect(screen.getByTestId('sse-retry-button')).toBeInTheDocument()
      },
      { timeout: 2000 },
    )

    expect(screen.getByTestId('sse-retry-button')).toHaveTextContent('重试')
  })

  it('has data-testid="agent-monitor-stream" on main container', async () => {
    ;(getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({ runs: [], total: 0 })

    render(<AgentMonitorTab />)

    await waitFor(() => {
      expect(screen.getByTestId('agent-monitor-stream')).toBeInTheDocument()
    })
  })
})
