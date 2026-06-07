import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import RunDetailDrawer from './RunDetailDrawer'
import * as observabilityApi from '../api/observability'

vi.mock('../api/observability', () => ({
  getRunConsole: vi.fn(),
}))

const mockConsoleData = {
  runId: 'run-123',
  status: 'completed',
  timeline: [
    { eventId: 'e1', eventType: 'run_started', timestamp: '2024-01-15T10:00:00Z', summary: 'Run started' },
    { eventId: 'e2', eventType: 'run_progress', timestamp: '2024-01-15T10:05:00Z', summary: 'Processing' },
    { eventId: 'e3', eventType: 'run_completed', timestamp: '2024-01-15T10:10:00Z', summary: 'Completed' },
  ],
  audit: [{ auditId: 'a1', action: 'created', timestamp: '2024-01-15T10:00:00Z' }],
}

describe('RunDetailDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not render when closed', () => {
    render(<RunDetailDrawer runId="run-123" isOpen={false} onClose={() => {}} />)

    expect(screen.queryByTestId('drawer-overlay')).not.toBeInTheDocument()
  })

  it('renders when open', () => {
    vi.mocked(observabilityApi.getRunConsole).mockImplementation(() => new Promise(() => {}))

    render(<RunDetailDrawer runId="run-123" isOpen onClose={() => {}} />)

    expect(screen.getByTestId('drawer-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('drawer-panel')).toBeInTheDocument()
  })

  it('fetches run details when opened', async () => {
    vi.mocked(observabilityApi.getRunConsole).mockImplementation(() => new Promise(() => {}))

    render(<RunDetailDrawer runId="run-123" isOpen onClose={() => {}} />)

    await waitFor(() => {
      expect(observabilityApi.getRunConsole).toHaveBeenCalledWith('run-123')
    })
  })

  it('shows loading state while fetching', () => {
    vi.mocked(observabilityApi.getRunConsole).mockImplementation(() => new Promise(() => {}))

    render(<RunDetailDrawer runId="run-123" isOpen onClose={() => {}} />)

    expect(screen.getByTestId('drawer-loading')).toBeInTheDocument()
  })

  it('shows error state on fetch failure', async () => {
    vi.mocked(observabilityApi.getRunConsole).mockRejectedValue(new Error('Network error'))

    render(<RunDetailDrawer runId="run-123" isOpen onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByTestId('drawer-error')).toBeInTheDocument()
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  it('displays run details after loading', async () => {
    vi.mocked(observabilityApi.getRunConsole).mockResolvedValue(mockConsoleData)

    render(<RunDetailDrawer runId="run-123" isOpen onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText('运行详情')).toBeInTheDocument()
      expect(screen.getByText('run-123')).toBeInTheDocument()
    })
  })

  it('displays timeline events', async () => {
    vi.mocked(observabilityApi.getRunConsole).mockResolvedValue(mockConsoleData)

    render(<RunDetailDrawer runId="run-123" isOpen onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText('Run started')).toBeInTheDocument()
      expect(screen.getByText('Processing')).toBeInTheDocument()
      expect(screen.getByText('Completed')).toBeInTheDocument()
    })
  })

  it('displays audit entries when present', async () => {
    vi.mocked(observabilityApi.getRunConsole).mockResolvedValue(mockConsoleData)

    render(<RunDetailDrawer runId="run-123" isOpen onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText('审计记录')).toBeInTheDocument()
      expect(screen.getByText('created')).toBeInTheDocument()
    })
  })

  it('hides audit section when no audit entries', async () => {
    vi.mocked(observabilityApi.getRunConsole).mockResolvedValue({
      ...mockConsoleData,
      audit: undefined,
    })

    render(<RunDetailDrawer runId="run-123" isOpen onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.queryByText('审计记录')).not.toBeInTheDocument()
    })
  })

  it('calls onClose when close button is clicked', async () => {
    vi.mocked(observabilityApi.getRunConsole).mockResolvedValue(mockConsoleData)
    const handleClose = vi.fn()

    render(<RunDetailDrawer runId="run-123" isOpen onClose={handleClose} />)

    await waitFor(() => {
      expect(screen.getByTestId('drawer-close')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('drawer-close'))
    expect(handleClose).toHaveBeenCalled()
  })

  it('calls onClose when overlay is clicked', async () => {
    vi.mocked(observabilityApi.getRunConsole).mockResolvedValue(mockConsoleData)
    const handleClose = vi.fn()

    render(<RunDetailDrawer runId="run-123" isOpen onClose={handleClose} />)

    await waitFor(() => {
      expect(screen.getByTestId('drawer-overlay')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('drawer-overlay'))
    expect(handleClose).toHaveBeenCalled()
  })

  it('does not call onClose when panel content is clicked', async () => {
    vi.mocked(observabilityApi.getRunConsole).mockResolvedValue(mockConsoleData)
    const handleClose = vi.fn()

    render(<RunDetailDrawer runId="run-123" isOpen onClose={handleClose} />)

    await waitFor(() => {
      expect(screen.getByTestId('drawer-panel')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('drawer-panel'))
    expect(handleClose).not.toHaveBeenCalled()
  })

  it('has correct accessibility attributes', () => {
    vi.mocked(observabilityApi.getRunConsole).mockImplementation(() => new Promise(() => {}))

    render(<RunDetailDrawer runId="run-123" isOpen onClose={() => {}} />)

    const overlay = screen.getByTestId('drawer-overlay')
    expect(overlay).toHaveAttribute('role', 'dialog')
    expect(overlay).toHaveAttribute('aria-modal', 'true')
    expect(overlay).toHaveAttribute('aria-labelledby', 'drawer-title')
  })

  it('displays status badge with correct class', async () => {
    vi.mocked(observabilityApi.getRunConsole).mockResolvedValue(mockConsoleData)

    render(<RunDetailDrawer runId="run-123" isOpen onClose={() => {}} />)

    await waitFor(() => {
      const statusBadge = screen.getByText('已完成')
      expect(statusBadge).toHaveClass('drawer-panel__status-badge--completed')
    })
  })

  it('shows empty timeline message when no events', async () => {
    vi.mocked(observabilityApi.getRunConsole).mockResolvedValue({
      runId: 'run-123',
      status: 'running',
      timeline: [],
    })

    render(<RunDetailDrawer runId="run-123" isOpen onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText('暂无时间线事件')).toBeInTheDocument()
    })
  })
})
