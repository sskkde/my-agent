import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import LogsDebugTab from './LogsDebugTab'
import type { LogEntry, DebugReplayResponse } from '../../api/types'

const mockedGetLogs = vi.fn()
const mockedGetDebugReplay = vi.fn()

vi.mock('../../api/client', () => ({
  getLogs: (...args: unknown[]) => mockedGetLogs(...args),
  getDebugReplay: (...args: unknown[]) => mockedGetDebugReplay(...args),
}))

describe('LogsDebugTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the panel with data-testid', () => {
    mockedGetLogs.mockResolvedValue({ logs: [], total: 0 })

    render(<LogsDebugTab />)

    expect(screen.getByTestId('logs-debug-panel')).toBeInTheDocument()
    expect(screen.getByText('日志调试')).toBeInTheDocument()
  })

  it('displays empty state when no logs', async () => {
    mockedGetLogs.mockResolvedValue({ logs: [], total: 0 })

    render(<LogsDebugTab />)

    await waitFor(() => {
      expect(screen.getByText('暂无日志记录')).toBeInTheDocument()
    })
  })

  it('renders filter inputs with correct data-testid attributes', () => {
    mockedGetLogs.mockResolvedValue({ logs: [], total: 0 })

    render(<LogsDebugTab />)

    expect(screen.getByTestId('logs-filter-sessionId')).toBeInTheDocument()
    expect(screen.getByTestId('logs-filter-sourceModule')).toBeInTheDocument()
    expect(screen.getByTestId('logs-filter-eventType')).toBeInTheDocument()
    expect(screen.getByTestId('logs-filter-sessionId-input')).toBeInTheDocument()
    expect(screen.getByTestId('logs-filter-sourceModule-select')).toBeInTheDocument()
    expect(screen.getByTestId('logs-filter-eventType-input')).toBeInTheDocument()
    expect(screen.getByTestId('logs-filter-refresh')).toBeInTheDocument()
  })

  it('renders logs list with data-testid', async () => {
    const mockLogs: LogEntry[] = [
      {
        eventId: 'evt-001',
        eventType: 'run_started',
        sourceModule: 'planner',
        sessionId: 'sess-123',
        severity: 'info',
        summary: 'Run started successfully',
        createdAt: '2025-04-29T10:00:00Z',
        payloadPreview: 'Starting run for session',
      },
      {
        eventId: 'evt-002',
        eventType: 'tool_call',
        sourceModule: 'tools',
        sessionId: 'sess-123',
        severity: 'warn',
        summary: 'Tool executed with warnings',
        createdAt: '2025-04-29T10:05:00Z',
      },
    ]
    mockedGetLogs.mockResolvedValue({ logs: mockLogs, total: 2 })

    render(<LogsDebugTab />)

    await waitFor(() => {
      expect(screen.getByTestId('logs-list')).toBeInTheDocument()
      expect(screen.getByTestId('log-row-evt-001')).toBeInTheDocument()
      expect(screen.getByTestId('log-row-evt-002')).toBeInTheDocument()
    })
  })

  it('displays log row with event type badge', async () => {
    const mockLogs: LogEntry[] = [
      {
        eventId: 'evt-001',
        eventType: 'run_started',
        sourceModule: 'planner',
        sessionId: 'sess-123',
        severity: 'info',
        summary: 'Run started',
        createdAt: '2025-04-29T10:00:00Z',
      },
    ]
    mockedGetLogs.mockResolvedValue({ logs: mockLogs, total: 1 })

    render(<LogsDebugTab />)

    await waitFor(() => {
      expect(screen.getByTestId('log-event-type-evt-001')).toHaveTextContent('run_started')
    })
  })

  it('displays log row with source module', async () => {
    const mockLogs: LogEntry[] = [
      {
        eventId: 'evt-001',
        eventType: 'run_started',
        sourceModule: 'planner',
        sessionId: 'sess-123',
        severity: 'info',
        summary: 'Run started',
        createdAt: '2025-04-29T10:00:00Z',
      },
    ]
    mockedGetLogs.mockResolvedValue({ logs: mockLogs, total: 1 })

    render(<LogsDebugTab />)

    await waitFor(() => {
      expect(screen.getByTestId('log-source-module-evt-001')).toHaveTextContent('planner')
    })
  })

  it('displays log row with severity icon', async () => {
    const mockLogs: LogEntry[] = [
      {
        eventId: 'evt-001',
        eventType: 'run_started',
        sourceModule: 'planner',
        sessionId: 'sess-123',
        severity: 'error',
        summary: 'Run failed',
        createdAt: '2025-04-29T10:00:00Z',
      },
    ]
    mockedGetLogs.mockResolvedValue({ logs: mockLogs, total: 1 })

    render(<LogsDebugTab />)

    await waitFor(() => {
      expect(screen.getByTestId('log-severity-evt-001')).toHaveTextContent('error')
    })
  })

  it('displays log row with summary', async () => {
    const mockLogs: LogEntry[] = [
      {
        eventId: 'evt-001',
        eventType: 'run_started',
        sourceModule: 'planner',
        sessionId: 'sess-123',
        severity: 'info',
        summary: 'Run started successfully',
        createdAt: '2025-04-29T10:00:00Z',
      },
    ]
    mockedGetLogs.mockResolvedValue({ logs: mockLogs, total: 1 })

    render(<LogsDebugTab />)

    await waitFor(() => {
      expect(screen.getByTestId('log-summary-evt-001')).toHaveTextContent('Run started successfully')
    })
  })

  it('displays log row with timestamp', async () => {
    const mockLogs: LogEntry[] = [
      {
        eventId: 'evt-001',
        eventType: 'run_started',
        sourceModule: 'planner',
        sessionId: 'sess-123',
        severity: 'info',
        summary: 'Run started',
        createdAt: '2025-04-29T10:00:00Z',
      },
    ]
    mockedGetLogs.mockResolvedValue({ logs: mockLogs, total: 1 })

    render(<LogsDebugTab />)

    await waitFor(() => {
      expect(screen.getByTestId('log-timestamp-evt-001')).toBeInTheDocument()
    })
  })

  it('displays payload preview when available', async () => {
    const mockLogs: LogEntry[] = [
      {
        eventId: 'evt-001',
        eventType: 'run_started',
        sourceModule: 'planner',
        sessionId: 'sess-123',
        severity: 'info',
        summary: 'Run started',
        createdAt: '2025-04-29T10:00:00Z',
        payloadPreview: 'Preview data',
      },
    ]
    mockedGetLogs.mockResolvedValue({ logs: mockLogs, total: 1 })

    render(<LogsDebugTab />)

    await waitFor(() => {
      expect(screen.getByTestId('log-payload-evt-001')).toHaveTextContent('Preview data')
    })
  })

  it('displays redacted payload in red text', async () => {
    const mockLogs: LogEntry[] = [
      {
        eventId: 'evt-001',
        eventType: 'tool_call',
        sourceModule: 'tools',
        sessionId: 'sess-123',
        severity: 'info',
        summary: 'Tool called',
        createdAt: '2025-04-29T10:00:00Z',
        payloadPreview: '[redacted]',
      },
    ]
    mockedGetLogs.mockResolvedValue({ logs: mockLogs, total: 1 })

    render(<LogsDebugTab />)

    await waitFor(() => {
      const payloadElement = screen.getByTestId('log-payload-evt-001')
      expect(payloadElement).toHaveTextContent('[redacted]')
      expect(payloadElement.querySelector('.logs-debug-redacted')).toBeInTheDocument()
    })
  })

  it('formats JSON payload preview with indentation', async () => {
    const mockLogs: LogEntry[] = [
      {
        eventId: 'evt-json',
        eventType: 'tool_result',
        sourceModule: 'tools',
        sessionId: 'sess-123',
        severity: 'info',
        summary: 'Tool result payload',
        createdAt: '2025-04-29T10:00:00Z',
        payloadPreview: '{"status":"ok","nested":{"count":2}}',
      },
    ]
    mockedGetLogs.mockResolvedValue({ logs: mockLogs, total: 1 })

    render(<LogsDebugTab />)

    await waitFor(() => {
      const payloadElement = screen.getByTestId('log-payload-evt-json')
      expect(payloadElement.querySelector('pre.logs-debug-code-block code')?.textContent).toBe(`{
  "status": "ok",
  "nested": {
    "count": 2
  }
}`)
    })
  })

  it('expands and collapses long payload previews', async () => {
    const longPayload = `payload-${'x'.repeat(700)}-end`
    const mockLogs: LogEntry[] = [
      {
        eventId: 'evt-long',
        eventType: 'model_output',
        sourceModule: 'kernel',
        sessionId: 'sess-123',
        severity: 'info',
        summary: 'Long payload',
        createdAt: '2025-04-29T10:00:00Z',
        payloadPreview: longPayload,
      },
    ]
    mockedGetLogs.mockResolvedValue({ logs: mockLogs, total: 1 })

    render(<LogsDebugTab />)

    const toggleButton = await screen.findByRole('button', { name: '展开 payload' })
    const payloadCode = screen.getByTestId('log-payload-evt-long').querySelector('code')

    expect(payloadCode).toHaveTextContent('…')
    expect(payloadCode).not.toHaveTextContent('-end')

    await userEvent.click(toggleButton)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '收起 payload' })).toHaveAttribute('aria-expanded', 'true')
      expect(payloadCode).toHaveTextContent(longPayload)
    })

    await userEvent.click(screen.getByRole('button', { name: '收起 payload' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开 payload' })).toHaveAttribute('aria-expanded', 'false')
      expect(payloadCode).not.toHaveTextContent('-end')
    })
  })

  it('displays debug replay summary card with data-testid', async () => {
    const mockLogs: LogEntry[] = [
      {
        eventId: 'evt-001',
        eventType: 'run_started',
        sourceModule: 'planner',
        sessionId: 'sess-123',
        severity: 'info',
        summary: 'Run started',
        createdAt: '2025-04-29T10:00:00Z',
      },
    ]
    const mockReplay = {
      sessionId: 'sess-123',
      eventCount: 5,
      transcriptCount: 3,
      runRefs: ['run-001', 'run-002'],
      approvalRefs: ['app-001'],
      lastEventId: 'evt-005',
      redactedPreviews: [],
    }

    mockedGetLogs.mockResolvedValue({ logs: mockLogs, total: 1 })
    mockedGetDebugReplay.mockResolvedValue(mockReplay)

    render(<LogsDebugTab />)

    const sessionInput = screen.getByTestId('logs-filter-sessionId-input')
    await userEvent.type(sessionInput, 'sess-123')

    await waitFor(() => {
      expect(screen.getByTestId('debug-replay-summary')).toBeInTheDocument()
      expect(screen.getByText('调试回放摘要')).toBeInTheDocument()
    })
  })

  it('displays debug replay stats correctly', async () => {
    const mockLogs: LogEntry[] = []
    const mockReplay = {
      sessionId: 'sess-123',
      eventCount: 10,
      transcriptCount: 5,
      runRefs: ['run-001', 'run-002', 'run-003'],
      approvalRefs: ['app-001', 'app-002'],
      lastEventId: 'evt-010',
      redactedPreviews: [],
    }

    mockedGetLogs.mockResolvedValue({ logs: mockLogs, total: 0 })
    mockedGetDebugReplay.mockResolvedValue(mockReplay)

    render(<LogsDebugTab />)

    const sessionInput = screen.getByTestId('logs-filter-sessionId-input')
    await userEvent.type(sessionInput, 'sess-123')

    await waitFor(() => {
      expect(screen.getByTestId('debug-replay-summary')).toBeInTheDocument()
      expect(screen.getByText('10')).toBeInTheDocument()
      expect(screen.getByText('5')).toBeInTheDocument()
      expect(screen.getByText('evt-010')).toBeInTheDocument()
    })
  })

  it('displays "无" when lastEventId is null', async () => {
    const mockLogs: LogEntry[] = []
    const mockReplay = {
      sessionId: 'sess-123',
      eventCount: 5,
      transcriptCount: 2,
      runRefs: ['run-001'],
      approvalRefs: [],
      lastEventId: null,
      redactedPreviews: [],
    }

    mockedGetLogs.mockResolvedValue({ logs: mockLogs, total: 0 })
    mockedGetDebugReplay.mockResolvedValue(mockReplay)

    render(<LogsDebugTab />)

    const sessionInput = screen.getByTestId('logs-filter-sessionId-input')
    await userEvent.type(sessionInput, 'sess-123')

    await waitFor(() => {
      expect(screen.getByText('无')).toBeInTheDocument()
    })
  })

  it('does not display debug replay when sessionId is empty', async () => {
    mockedGetLogs.mockResolvedValue({ logs: [], total: 0 })

    render(<LogsDebugTab />)

    await waitFor(() => {
      expect(screen.queryByTestId('debug-replay-summary')).not.toBeInTheDocument()
    })
  })

  it('fetches logs with filter parameters', async () => {
    mockedGetLogs.mockResolvedValue({ logs: [], total: 0 })

    render(<LogsDebugTab />)

    const sessionInput = screen.getByTestId('logs-filter-sessionId-input')
    await userEvent.type(sessionInput, 'sess-123')

    const moduleSelect = screen.getByTestId('logs-filter-sourceModule-select')
    fireEvent.change(moduleSelect, { target: { value: 'planner' } })

    const eventTypeInput = screen.getByTestId('logs-filter-eventType-input')
    await userEvent.type(eventTypeInput, 'run_started')

    await waitFor(() => {
      expect(mockedGetLogs).toHaveBeenCalledWith('sess-123', 'planner', 'run_started', 50, undefined, undefined)
    })
  })

  it('refreshes logs when refresh button is clicked', async () => {
    mockedGetLogs.mockResolvedValue({ logs: [], total: 0 })

    render(<LogsDebugTab />)

    await waitFor(() => {
      expect(screen.getByTestId('logs-filter-refresh')).not.toBeDisabled()
    })

    const refreshButton = screen.getByTestId('logs-filter-refresh')
    fireEvent.click(refreshButton)

    await waitFor(() => {
      expect(mockedGetLogs).toHaveBeenCalledTimes(2)
    })
  })

  it('displays loading state', async () => {
    mockedGetLogs.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ logs: [], total: 0 }), 100)),
    )

    render(<LogsDebugTab />)

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('displays error message when fetch fails', async () => {
    mockedGetLogs.mockRejectedValue(new Error('Network error'))

    render(<LogsDebugTab />)

    await waitFor(() => {
      expect(screen.getByTestId('logs-debug-error')).toHaveTextContent('Network error')
    })
  })

  it('applies severity-based styling to rows', async () => {
    const mockLogs: LogEntry[] = [
      {
        eventId: 'evt-001',
        eventType: 'run_started',
        sourceModule: 'planner',
        sessionId: 'sess-123',
        severity: 'error',
        summary: 'Run failed',
        createdAt: '2025-04-29T10:00:00Z',
      },
    ]
    mockedGetLogs.mockResolvedValue({ logs: mockLogs, total: 1 })

    render(<LogsDebugTab />)

    await waitFor(() => {
      const row = screen.getByTestId('log-row-evt-001')
      expect(row).toHaveClass('logs-debug-row--error')
    })
  })

  it('displays total count in header', async () => {
    mockedGetLogs.mockResolvedValue({ logs: [], total: 42 })

    render(<LogsDebugTab />)

    await waitFor(() => {
      expect(screen.getByText('共 42 条记录')).toBeInTheDocument()
    })
  })

  describe('runRef Filter', () => {
    it('renders runRef filter input with correct data-testid', () => {
      mockedGetLogs.mockResolvedValue({ logs: [], total: 0 })

      render(<LogsDebugTab />)

      expect(screen.getByTestId('logs-filter-runRef')).toBeInTheDocument()
      expect(screen.getByTestId('logs-filter-runRef-input')).toBeInTheDocument()
    })

    it('updates runRef filter value on input change', async () => {
      mockedGetLogs.mockResolvedValue({ logs: [], total: 0 })

      render(<LogsDebugTab />)

      const runRefInput = screen.getByTestId('logs-filter-runRef-input')
      await userEvent.type(runRefInput, 'run-123')

      expect(runRefInput).toHaveValue('run-123')
    })

    it('passes runRef to getLogs when filtering', async () => {
      mockedGetLogs.mockResolvedValue({ logs: [], total: 0 })

      render(<LogsDebugTab />)

      const runRefInput = screen.getByTestId('logs-filter-runRef-input')
      await userEvent.type(runRefInput, 'run-456')

      await waitFor(() => {
        expect(mockedGetLogs).toHaveBeenCalledWith(undefined, undefined, undefined, 50, undefined, 'run-456')
      })
    })
  })

  describe('Replay Run Refs', () => {
    it('renders run refs with correct data-testid', async () => {
      const mockReplay: DebugReplayResponse = {
        sessionId: 'sess-123',
        eventCount: 5,
        transcriptCount: 2,
        runRefs: ['run-001', 'run-002'],
        approvalRefs: [],
        lastEventId: 'evt-005',
        redactedPreviews: [],
      }

      mockedGetLogs.mockResolvedValue({ logs: [], total: 0 })
      mockedGetDebugReplay.mockResolvedValue(mockReplay)

      render(<LogsDebugTab />)

      const sessionInput = screen.getByTestId('logs-filter-sessionId-input')
      await userEvent.type(sessionInput, 'sess-123')

      await waitFor(() => {
        expect(screen.getByTestId('debug-replay-run-ref-run-001')).toBeInTheDocument()
        expect(screen.getByTestId('debug-replay-run-ref-run-002')).toBeInTheDocument()
      })
    })

    it('displays run ref IDs in the list', async () => {
      const mockReplay: DebugReplayResponse = {
        sessionId: 'sess-123',
        eventCount: 5,
        transcriptCount: 2,
        runRefs: ['run-abc'],
        approvalRefs: [],
        lastEventId: 'evt-005',
        redactedPreviews: [],
      }

      mockedGetLogs.mockResolvedValue({ logs: [], total: 0 })
      mockedGetDebugReplay.mockResolvedValue(mockReplay)

      render(<LogsDebugTab />)

      const sessionInput = screen.getByTestId('logs-filter-sessionId-input')
      await userEvent.type(sessionInput, 'sess-123')

      await waitFor(() => {
        expect(screen.getByTestId('debug-replay-run-ref-run-abc')).toHaveTextContent('run-abc')
      })
    })
  })

  describe('Replay Approval Refs', () => {
    it('renders approval refs with correct data-testid', async () => {
      const mockReplay: DebugReplayResponse = {
        sessionId: 'sess-123',
        eventCount: 5,
        transcriptCount: 2,
        runRefs: [],
        approvalRefs: ['approval-001', 'approval-002'],
        lastEventId: 'evt-005',
        redactedPreviews: [],
      }

      mockedGetLogs.mockResolvedValue({ logs: [], total: 0 })
      mockedGetDebugReplay.mockResolvedValue(mockReplay)

      render(<LogsDebugTab />)

      const sessionInput = screen.getByTestId('logs-filter-sessionId-input')
      await userEvent.type(sessionInput, 'sess-123')

      await waitFor(() => {
        expect(screen.getByTestId('debug-replay-approval-ref-approval-001')).toBeInTheDocument()
        expect(screen.getByTestId('debug-replay-approval-ref-approval-002')).toBeInTheDocument()
      })
    })

    it('displays approval ref ID in the list', async () => {
      const mockReplay: DebugReplayResponse = {
        sessionId: 'sess-123',
        eventCount: 5,
        transcriptCount: 2,
        runRefs: [],
        approvalRefs: ['approval-xyz'],
        lastEventId: 'evt-005',
        redactedPreviews: [],
      }

      mockedGetLogs.mockResolvedValue({ logs: [], total: 0 })
      mockedGetDebugReplay.mockResolvedValue(mockReplay)

      render(<LogsDebugTab />)

      const sessionInput = screen.getByTestId('logs-filter-sessionId-input')
      await userEvent.type(sessionInput, 'sess-123')

      await waitFor(() => {
        expect(screen.getByTestId('debug-replay-approval-ref-approval-xyz')).toHaveTextContent('approval-xyz')
      })
    })
  })

  describe('Redacted Previews', () => {
    it('renders redacted previews in replay summary', async () => {
      const mockReplay: DebugReplayResponse = {
        sessionId: 'sess-123',
        eventCount: 2,
        transcriptCount: 1,
        runRefs: [],
        approvalRefs: [],
        lastEventId: 'evt-002',
        redactedPreviews: [
          { eventId: 'evt-001', eventType: 'run_started', preview: '{"message":"started"}' },
          { eventId: 'evt-002', eventType: 'approval_requested', preview: '[redacted]' },
        ],
      }

      mockedGetLogs.mockResolvedValue({ logs: [], total: 0 })
      mockedGetDebugReplay.mockResolvedValue(mockReplay)

      render(<LogsDebugTab />)

      const sessionInput = screen.getByTestId('logs-filter-sessionId-input')
      await userEvent.type(sessionInput, 'sess-123')

      await waitFor(() => {
        expect(screen.getByTestId('debug-replay-preview-evt-001')).toBeInTheDocument()
        expect(screen.getByTestId('debug-replay-preview-evt-002')).toBeInTheDocument()
      })
    })

    it('displays preview text for low sensitivity events', async () => {
      const mockReplay: DebugReplayResponse = {
        sessionId: 'sess-123',
        eventCount: 1,
        transcriptCount: 0,
        runRefs: [],
        approvalRefs: [],
        lastEventId: 'evt-001',
        redactedPreviews: [{ eventId: 'evt-001', eventType: 'run_started', preview: '{"message":"started"}' }],
      }

      mockedGetLogs.mockResolvedValue({ logs: [], total: 0 })
      mockedGetDebugReplay.mockResolvedValue(mockReplay)

      render(<LogsDebugTab />)

      const sessionInput = screen.getByTestId('logs-filter-sessionId-input')
      await userEvent.type(sessionInput, 'sess-123')

      await waitFor(() => {
        const preview = screen.getByTestId('debug-replay-preview-evt-001')
        expect(preview).toHaveTextContent('run_started')
        expect(preview).toHaveTextContent('{"message":"started"}')
      })
    })

    it('displays [redacted] for high sensitivity events', async () => {
      const mockReplay: DebugReplayResponse = {
        sessionId: 'sess-123',
        eventCount: 1,
        transcriptCount: 0,
        runRefs: [],
        approvalRefs: [],
        lastEventId: 'evt-001',
        redactedPreviews: [{ eventId: 'evt-001', eventType: 'approval_requested', preview: '[redacted]' }],
      }

      mockedGetLogs.mockResolvedValue({ logs: [], total: 0 })
      mockedGetDebugReplay.mockResolvedValue(mockReplay)

      render(<LogsDebugTab />)

      const sessionInput = screen.getByTestId('logs-filter-sessionId-input')
      await userEvent.type(sessionInput, 'sess-123')

      await waitFor(() => {
        const preview = screen.getByTestId('debug-replay-preview-evt-001')
        expect(preview).toHaveTextContent('[redacted]')
      })
    })
  })

  describe('No Mutation Buttons', () => {
    it('should not contain any rerun/replay/execute buttons', async () => {
      mockedGetLogs.mockResolvedValue({ logs: [], total: 0 })

      render(<LogsDebugTab />)

      await waitFor(() => {
        expect(screen.getByTestId('logs-debug-panel')).toBeInTheDocument()
      })

      const buttons = screen.getAllByRole('button')
      const buttonTexts = buttons.map((btn) => btn.textContent?.toLowerCase() || '')

      const mutationKeywords = [
        'rerun',
        're-run',
        'replay',
        'execute',
        'retry',
        'restart',
        '重试',
        '重新运行',
        '回放执行',
      ]
      for (const keyword of mutationKeywords) {
        for (const text of buttonTexts) {
          expect(text).not.toContain(keyword)
        }
      }
    })
  })
})
