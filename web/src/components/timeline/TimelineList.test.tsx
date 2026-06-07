import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TimelineList } from './TimelineList'
import { TimelineEventCard } from './TimelineEventCard'
import type { ConsoleTimelineEvent } from '../../api/types'
import { ToastProvider } from '../Toast'

vi.mock('../../api/client', () => ({
  respondApproval: vi.fn(),
}))

import * as api from '../../api/client'

const mockRespondApproval = api.respondApproval as ReturnType<typeof vi.fn>

const renderWithToast = (ui: React.ReactElement) => {
  return render(<ToastProvider>{ui}</ToastProvider>)
}

const createMockEvent = (
  eventId: string,
  eventType: ConsoleTimelineEvent['eventType'],
  content?: string,
): ConsoleTimelineEvent => ({
  eventId,
  eventType,
  sessionId: 'test-session',
  timestamp: new Date().toISOString(),
  content,
  actor: eventType === 'user_message' ? 'user' : 'system',
})

describe('TimelineList', () => {
  it('renders loading state', () => {
    render(<TimelineList events={[]} loading={true} />)
    expect(screen.getByTestId('timeline-loading')).toBeInTheDocument()
  })

  it('renders error state', () => {
    render(<TimelineList events={[]} loading={false} error="Something went wrong" />)
    expect(screen.getByTestId('timeline-error')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('renders empty state when no events', () => {
    render(<TimelineList events={[]} loading={false} />)
    expect(screen.getByTestId('timeline-empty-state')).toBeInTheDocument()
  })

  it('renders list of events', () => {
    const events: ConsoleTimelineEvent[] = [
      createMockEvent('event-1', 'user_message', 'Hello'),
      createMockEvent('event-2', 'assistant_message', 'Hi there!'),
    ]
    render(<TimelineList events={events} loading={false} />)
    expect(screen.getByTestId('timeline-event-event-1')).toBeInTheDocument()
    expect(screen.getByTestId('timeline-event-event-2')).toBeInTheDocument()
  })
})

describe('TimelineEventCard', () => {
  const eventTypes: ConsoleTimelineEvent['eventType'][] = [
    'user_message',
    'assistant_message',
    'thinking_summary',
    'tool_call',
    'tool_result',
    'approval_request',
    'approval_decision',
    'artifact_created',
    'run_started',
    'run_progress',
    'run_completed',
    'run_failed',
    'run_cancelled',
    'system_status',
    'error',
  ]

  eventTypes.forEach((eventType) => {
    it(`renders ${eventType} event with correct data-testid`, () => {
      const event = createMockEvent(`test-${eventType}`, eventType, 'Test content')
      render(<TimelineEventCard event={event} />)
      expect(screen.getByTestId(`timeline-event-test-${eventType}`)).toBeInTheDocument()
    })

    it(`renders ${eventType} event with correct label`, () => {
      const event = createMockEvent(`test-${eventType}`, eventType, 'Test content')
      render(<TimelineEventCard event={event} />)
      const labelMap: Record<string, string> = {
        user_message: 'User',
        assistant_message: 'Assistant',
        thinking_summary: 'Thinking',
        tool_call: 'Tool Call',
        tool_result: 'Tool Result',
        approval_request: 'Approval Request',
        approval_decision: 'Approval Decision',
        artifact_created: 'Artifact',
        run_started: 'Run Started',
        run_progress: 'Run Progress',
        run_completed: 'Run Complete',
        run_failed: 'Run Failed',
        run_cancelled: 'Run Cancelled',
        system_status: 'Status',
        error: 'Error',
      }
      expect(screen.getByText(labelMap[eventType])).toBeInTheDocument()
    })
  })

  it('renders user_message with right-aligned styling', () => {
    const event = createMockEvent('user-msg', 'user_message', 'User says hello')
    const { container } = render(<TimelineEventCard event={event} />)
    const card = container.querySelector('.timeline-event-card--user_message')
    expect(card).toBeInTheDocument()
  })

  it('renders assistant_message with left-aligned styling', () => {
    const event = createMockEvent('assistant-msg', 'assistant_message', 'Assistant replies')
    const { container } = render(<TimelineEventCard event={event} />)
    const card = container.querySelector('.timeline-event-card--assistant_message')
    expect(card).toBeInTheDocument()
  })

  it('renders thinking_summary as collapsed by default', () => {
    const event = createMockEvent('thinking-1', 'thinking_summary', 'Thinking content')
    render(<TimelineEventCard event={event} />)
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
    expect(screen.queryByText('Thinking content')).not.toBeInTheDocument()
  })

  it('expands thinking_summary when clicked', () => {
    const event = createMockEvent('thinking-1', 'thinking_summary', 'Thinking content')
    render(<TimelineEventCard event={event} />)
    const toggle = screen.getByRole('button', { expanded: false })
    fireEvent.click(toggle)
    expect(screen.getByText('思考中...')).toBeInTheDocument()
    expect(screen.getByText('Thinking content')).toBeInTheDocument()
  })

  it('renders tool_call in code block', () => {
    const event = createMockEvent('tool-1', 'tool_call', 'console.log("test")')
    const { container } = render(<TimelineEventCard event={event} />)
    const codeBlock = container.querySelector('.timeline-code-block')
    expect(codeBlock).toBeInTheDocument()
    expect(screen.getByText('console.log("test")')).toBeInTheDocument()
  })

  it('renders tool_result in code block', () => {
    const event = createMockEvent('tool-result-1', 'tool_result', '{"result": true}')
    const { container } = render(<TimelineEventCard event={event} />)
    const codeBlock = container.querySelector('.timeline-code-block')
    expect(codeBlock).toBeInTheDocument()
    expect(screen.getByText('{"result": true}')).toBeInTheDocument()
  })

  it('renders approval_request with yellow styling', () => {
    const event = createMockEvent('approval-1', 'approval_request', 'Please approve this action')
    const { container } = render(<TimelineEventCard event={event} />)
    const card = container.querySelector('.timeline-event-card--approval_request')
    expect(card).toBeInTheDocument()
  })

  it('renders approval_decision with yellow styling', () => {
    const event = createMockEvent('approval-2', 'approval_decision', 'Approved')
    const { container } = render(<TimelineEventCard event={event} />)
    const card = container.querySelector('.timeline-event-card--approval_decision')
    expect(card).toBeInTheDocument()
  })

  it('renders artifact_created with green styling', () => {
    const event = createMockEvent('artifact-1', 'artifact_created', 'Created new artifact')
    const { container } = render(<TimelineEventCard event={event} />)
    const card = container.querySelector('.timeline-event-card--artifact_created')
    expect(card).toBeInTheDocument()
  })

  it('renders run_started with status badge styling', () => {
    const event = createMockEvent('run-1', 'run_started', 'Run started')
    const { container } = render(<TimelineEventCard event={event} />)
    const card = container.querySelector('.timeline-event-card--run_started')
    expect(card).toBeInTheDocument()
  })

  it('renders run_progress with status badge styling', () => {
    const event = createMockEvent('run-2', 'run_progress', '50% complete')
    const { container } = render(<TimelineEventCard event={event} />)
    const card = container.querySelector('.timeline-event-card--run_progress')
    expect(card).toBeInTheDocument()
  })

  it('renders run_completed with status badge styling', () => {
    const event = createMockEvent('run-3', 'run_completed', 'Run finished')
    const { container } = render(<TimelineEventCard event={event} />)
    const card = container.querySelector('.timeline-event-card--run_completed')
    expect(card).toBeInTheDocument()
  })

  it('renders run_failed with status badge styling', () => {
    const event = createMockEvent('run-4', 'run_failed', 'Run failed')
    const { container } = render(<TimelineEventCard event={event} />)
    const card = container.querySelector('.timeline-event-card--run_failed')
    expect(card).toBeInTheDocument()
  })

  it('renders run_cancelled with status badge styling', () => {
    const event = createMockEvent('run-5', 'run_cancelled', 'Run cancelled')
    const { container } = render(<TimelineEventCard event={event} />)
    const card = container.querySelector('.timeline-event-card--run_cancelled')
    expect(card).toBeInTheDocument()
  })

  it('renders system_status with muted styling', () => {
    const event = createMockEvent('status-1', 'system_status', 'System is healthy')
    const { container } = render(<TimelineEventCard event={event} />)
    const card = container.querySelector('.timeline-event-card--system_status')
    expect(card).toBeInTheDocument()
  })

  it('renders error with red alert styling', () => {
    const event = createMockEvent('error-1', 'error', 'Something went wrong')
    const { container } = render(<TimelineEventCard event={event} />)
    const card = container.querySelector('.timeline-event-card--error')
    expect(card).toBeInTheDocument()
  })

  it('sanitizes HTML content to prevent XSS', () => {
    const event = createMockEvent('xss-1', 'user_message', '<script>alert("xss")</script>Hello')
    render(<TimelineEventCard event={event} />)
    expect(screen.queryByText('<script>alert("xss")</script>Hello')).not.toBeInTheDocument()
    expect(screen.getByText('alert("xss")Hello')).toBeInTheDocument()
  })

  it('displays actor when present', () => {
    const event = createMockEvent('actor-1', 'user_message', 'Hello')
    event.actor = 'testuser'
    render(<TimelineEventCard event={event} />)
    expect(screen.getByText('@testuser')).toBeInTheDocument()
  })

  it('displays timestamp', () => {
    const event = createMockEvent('time-1', 'user_message', 'Hello')
    event.timestamp = '2024-01-15T10:30:00.000Z'
    render(<TimelineEventCard event={event} />)
    expect(screen.getByText(/\d{2}:\d{2}:\d{2}/)).toBeInTheDocument()
  })
})

describe('TimelineEventCard Approval Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createApprovalEvent = (
    eventId: string,
    approvalRequestId: string | undefined,
    approvalStatus: string | undefined,
    actionType?: string,
    metadata?: Record<string, unknown>,
  ): ConsoleTimelineEvent => ({
    eventId,
    eventType: 'approval_request',
    sessionId: 'test-session',
    timestamp: new Date().toISOString(),
    content: undefined,
    actor: 'system',
    metadata: {
      approvalRequestId,
      approvalStatus,
      actionType: actionType ?? 'file.write',
      ...metadata,
    },
  })

  it('renders approval_request without metadata as plain content', () => {
    const event = createMockEvent('approval-no-meta', 'approval_request', 'Please approve')
    renderWithToast(<TimelineEventCard event={event} />)
    expect(screen.getByText('Please approve')).toBeInTheDocument()
    expect(screen.queryByTestId(/approval-approve-/)).not.toBeInTheDocument()
    expect(screen.queryByTestId(/approval-reject-/)).not.toBeInTheDocument()
  })

  it('renders approve/reject buttons for pending approval', () => {
    const event = createApprovalEvent('approval-pending', 'appr-123', 'pending')
    renderWithToast(<TimelineEventCard event={event} />)
    expect(screen.getByText('file.write')).toBeInTheDocument()
    expect(screen.getByTestId('approval-approve-appr-123')).toBeInTheDocument()
    expect(screen.getByTestId('approval-reject-appr-123')).toBeInTheDocument()
  })

  it('shows approved status without buttons for approved approval', () => {
    const event = createApprovalEvent('approval-approved', 'appr-456', 'approved')
    renderWithToast(<TimelineEventCard event={event} />)
    expect(screen.getByText('file.write')).toBeInTheDocument()
    expect(screen.getByText('已批准')).toBeInTheDocument()
    expect(screen.queryByTestId(/approval-approve-/)).not.toBeInTheDocument()
    expect(screen.queryByTestId(/approval-reject-/)).not.toBeInTheDocument()
  })

  it('shows rejected status without buttons for rejected approval', () => {
    const event = createApprovalEvent('approval-rejected', 'appr-789', 'rejected')
    renderWithToast(<TimelineEventCard event={event} />)
    expect(screen.getByText('file.write')).toBeInTheDocument()
    expect(screen.getByText('已拒绝')).toBeInTheDocument()
    expect(screen.queryByTestId(/approval-approve-/)).not.toBeInTheDocument()
    expect(screen.queryByTestId(/approval-reject-/)).not.toBeInTheDocument()
  })

  it('shows buttons for pending approval', () => {
    const event = createApprovalEvent('approval-same-user', 'appr-same', 'pending')
    renderWithToast(<TimelineEventCard event={event} />)
    expect(screen.getByTestId('approval-approve-appr-same')).toBeInTheDocument()
    expect(screen.getByTestId('approval-reject-appr-same')).toBeInTheDocument()
  })

  it('calls approve API when approve button clicked', async () => {
    mockRespondApproval.mockResolvedValue({ success: true, approvalId: 'appr-approve', status: 'approved' })

    const event = createApprovalEvent('approval-click', 'appr-click', 'pending')
    renderWithToast(<TimelineEventCard event={event} />)

    fireEvent.click(screen.getByTestId('approval-approve-appr-click'))

    await waitFor(() => {
      expect(mockRespondApproval).toHaveBeenCalledWith('appr-click', 'approve_once');
    });

    await waitFor(() => {
      expect(screen.getByText('已批准')).toBeInTheDocument()
    })
  })

  it('calls reject API when reject button clicked', async () => {
    mockRespondApproval.mockResolvedValue({ success: true, approvalId: 'appr-reject', status: 'rejected' })

    const event = createApprovalEvent('approval-reject-click', 'appr-reject-click', 'pending')
    renderWithToast(<TimelineEventCard event={event} />)

    fireEvent.click(screen.getByTestId('approval-reject-appr-reject-click'))

    await waitFor(() => {
      expect(mockRespondApproval).toHaveBeenCalledWith('appr-reject-click', 'reject', undefined);
    });

    await waitFor(() => {
      expect(screen.getByText('已拒绝')).toBeInTheDocument()
    })
  })

  it('shows loading state while action is in progress', async () => {
    let resolveApproval: (value: { success: boolean }) => void = () => {}
    const pendingPromise = new Promise<{ success: boolean }>((resolve) => {
      resolveApproval = resolve
    })
    mockRespondApproval.mockReturnValue(pendingPromise)

    const event = createApprovalEvent('approval-loading', 'appr-loading', 'pending')
    renderWithToast(<TimelineEventCard event={event} />)

    const approveBtn = screen.getByTestId('approval-approve-appr-loading')
    expect(approveBtn).toHaveTextContent('批准')

    fireEvent.click(approveBtn)

    await waitFor(() => {
      expect(screen.getByTestId('approval-approve-appr-loading')).toHaveTextContent('处理中...')
    })

    await waitFor(() => {
      resolveApproval({ success: true })
    })

    await waitFor(() => {
      expect(screen.getByText('已批准')).toBeInTheDocument()
    })
  })

  it('shows error message on API failure', async () => {
    mockRespondApproval.mockRejectedValue(new Error('Network error'))

    const event = createApprovalEvent('approval-error', 'appr-error', 'pending')
    renderWithToast(<TimelineEventCard event={event} />)

    fireEvent.click(screen.getByTestId('approval-approve-appr-error'))

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })

    expect(screen.getByTestId('approval-approve-appr-error')).toBeInTheDocument()
  })
})
