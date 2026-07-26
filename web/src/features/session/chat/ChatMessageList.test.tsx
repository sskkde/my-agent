import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatMessageList from './ChatMessageList'
import type { ConsoleTimelineEvent, ConsoleTimelineEventType } from '../../../api/types'

const makeEvent = (
  overrides: Partial<ConsoleTimelineEvent> & {
    eventId: string
    eventType: ConsoleTimelineEventType
  },
): ConsoleTimelineEvent => ({
  sessionId: 's1',
  timestamp: new Date().toISOString(),
  ...overrides,
})

const renderList = (
  events: ConsoleTimelineEvent[],
  options: { loading?: boolean; error?: string } = {},
) =>
  render(
    <ChatMessageList
      events={events}
      loading={options.loading ?? false}
      error={options.error}
      onPromptSelect={() => {}}
      onRetryStream={() => {}}
    />,
  )

describe('ChatMessageList', () => {
  it('renders welcome screen when no events', () => {
    renderList([])
    expect(screen.getByTestId('chat-welcome')).toBeInTheDocument()
  })

  it('renders messages from events', () => {
    const events: ConsoleTimelineEvent[] = [
      makeEvent({
        eventId: '1',
        eventType: 'user_message',
        content: 'hi',
        actor: 'user',
      }),
      makeEvent({
        eventId: '2',
        eventType: 'assistant_message',
        content: 'hello',
        actor: 'assistant',
      }),
    ]
    renderList(events)
    expect(screen.getByText('hi')).toBeInTheDocument()
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('renders merged tool card between user and assistant messages (S1)', () => {
    const events: ConsoleTimelineEvent[] = [
      makeEvent({
        eventId: 'user-1',
        eventType: 'user_message',
        content: 'read index',
        actor: 'user',
      }),
      makeEvent({
        eventId: 'call-1',
        eventType: 'tool_call',
        content: 'file.read: running',
        metadata: {
          toolCallId: 'tc-1',
          toolName: 'file.read',
          status: 'running',
          parameters: { path: '/src/index.ts' },
        },
      }),
      makeEvent({
        eventId: 'result-1',
        eventType: 'tool_result',
        content: 'export default 1',
        metadata: {
          toolCallId: 'tc-1',
          toolName: 'file.read',
          status: 'completed',
          result: 'export default 1',
        },
      }),
      makeEvent({
        eventId: 'asst-1',
        eventType: 'assistant_message',
        content: 'Here is the file.',
        actor: 'assistant',
      }),
    ]

    renderList(events)

    expect(screen.getByText('read index')).toBeInTheDocument()
    expect(screen.getByText('Here is the file.')).toBeInTheDocument()

    const cards = screen.getAllByTestId('tool-call-card')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveAttribute('data-status', 'completed')

    const list = screen.getByTestId('chat-message-list')
    const userPos = list.textContent?.indexOf('read index') ?? -1
    const toolPos = list.textContent?.indexOf('file.read') ?? -1
    const asstPos = list.textContent?.indexOf('Here is the file.') ?? -1
    expect(userPos).toBeGreaterThanOrEqual(0)
    expect(toolPos).toBeGreaterThan(userPos)
    expect(asstPos).toBeGreaterThan(toolPos)
  })

  it('expands merged tool card to show parameters and result', async () => {
    const user = userEvent.setup()
    const events: ConsoleTimelineEvent[] = [
      makeEvent({
        eventId: 'call-1',
        eventType: 'tool_call',
        metadata: {
          toolCallId: 'tc-1',
          toolName: 'file.read',
          status: 'completed',
          parameters: { path: '/src/index.ts' },
        },
      }),
      makeEvent({
        eventId: 'result-1',
        eventType: 'tool_result',
        content: 'file body here',
        metadata: {
          toolCallId: 'tc-1',
          toolName: 'file.read',
          status: 'completed',
          result: 'file body here',
        },
      }),
    ]

    renderList(events)

    const card = screen.getByTestId('tool-call-card')
    await user.click(within(card).getByRole('button', { expanded: false }))

    expect(within(card).getByText('参数')).toBeInTheDocument()
    expect(within(card).getByText(/"path": "\/src\/index.ts"/)).toBeInTheDocument()
    expect(within(card).getByText('结果')).toBeInTheDocument()
    expect(within(card).getByText('file body here')).toBeInTheDocument()
  })

  it('shows failed status on merged card when result failed', () => {
    const events: ConsoleTimelineEvent[] = [
      makeEvent({
        eventId: 'call-1',
        eventType: 'tool_call',
        metadata: { toolCallId: 'tc-f', toolName: 'bash', status: 'running' },
      }),
      makeEvent({
        eventId: 'result-1',
        eventType: 'tool_result',
        content: 'error output',
        metadata: {
          toolCallId: 'tc-f',
          toolName: 'bash',
          status: 'failed',
          result: 'error output',
        },
      }),
    ]

    renderList(events)
    expect(screen.getByTestId('tool-call-card')).toHaveAttribute('data-status', 'failed')
  })

  it('renders orphan tool_call with running status', () => {
    const events: ConsoleTimelineEvent[] = [
      makeEvent({
        eventId: 'call-only',
        eventType: 'tool_call',
        metadata: { toolName: 'web_fetch', status: 'running' },
      }),
    ]

    renderList(events)
    const card = screen.getByTestId('tool-call-card')
    expect(card).toHaveAttribute('data-status', 'running')
    expect(within(card).getByText('运行中')).toBeInTheDocument()
  })

  it('renders orphan tool_result as completed card', () => {
    const events: ConsoleTimelineEvent[] = [
      makeEvent({
        eventId: 'result-only',
        eventType: 'tool_result',
        content: 'payload',
        metadata: { toolName: 'status_query', result: 'payload' },
      }),
    ]

    renderList(events)
    expect(screen.getByTestId('tool-call-card')).toHaveAttribute('data-status', 'completed')
  })

  it('renders Unknown tool when toolName is missing', () => {
    const events: ConsoleTimelineEvent[] = [
      makeEvent({
        eventId: 'no-name',
        eventType: 'tool_call',
        metadata: { status: 'running' },
      }),
    ]

    renderList(events)
    const card = screen.getByTestId('tool-call-card')
    expect(within(card).getAllByText('Unknown tool').length).toBeGreaterThan(0)
  })

  it('does not render tool cards for pure chat streams (S3)', () => {
    const events: ConsoleTimelineEvent[] = [
      makeEvent({
        eventId: '1',
        eventType: 'user_message',
        content: 'hi',
        actor: 'user',
      }),
      makeEvent({
        eventId: '2',
        eventType: 'assistant_message',
        content: 'hello',
        actor: 'assistant',
      }),
    ]

    renderList(events)
    expect(screen.queryByTestId('tool-call-card')).not.toBeInTheDocument()
    expect(screen.getByText('hi')).toBeInTheDocument()
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('still renders streaming draft and suppresses typing indicator', () => {
    const events: ConsoleTimelineEvent[] = [
      makeEvent({
        eventId: 'user-1',
        eventType: 'user_message',
        content: 'hi',
        actor: 'user',
      }),
      makeEvent({
        eventId: 'draft-1',
        eventType: 'assistant_message',
        content: 'streaming...',
        metadata: { streamingDraft: true, attemptId: 'a1' },
        actor: 'assistant',
      }),
    ]

    renderList(events, { loading: true })
    expect(screen.getByText('streaming...')).toBeInTheDocument()
    expect(screen.queryByLabelText('正在输入')).not.toBeInTheDocument()
  })

  it('still renders assistant placeholder', () => {
    const events: ConsoleTimelineEvent[] = [
      makeEvent({
        eventId: 'user-1',
        eventType: 'user_message',
        content: 'hi',
        actor: 'user',
      }),
      makeEvent({
        eventId: 'ph-1',
        eventType: 'assistant_message',
        metadata: { assistantPlaceholder: true, attemptId: 'p1' },
        actor: 'assistant',
      }),
    ]

    renderList(events)
    expect(screen.getByLabelText('正在输入')).toBeInTheDocument()
  })

  it('shows typing indicator when loading with normal messages and no streaming draft', () => {
    const events: ConsoleTimelineEvent[] = [
      makeEvent({
        eventId: 'user-1',
        eventType: 'user_message',
        content: 'hi',
        actor: 'user',
      }),
      makeEvent({
        eventId: 'asst-1',
        eventType: 'assistant_message',
        content: 'hello',
        actor: 'assistant',
      }),
    ]

    renderList(events, { loading: true })
    expect(screen.getByLabelText('正在输入')).toBeInTheDocument()
  })

  it('renders thinking_summary as a first-class message when present (T6 opt-in contract)', () => {
    const events: ConsoleTimelineEvent[] = [
      makeEvent({
        eventId: 'th-1',
        eventType: 'thinking_summary',
        content: 'REASONING_FIXTURE_12345',
      }),
      makeEvent({
        eventId: 'u-1',
        eventType: 'user_message',
        content: 'hi',
      }),
    ]

    renderList(events)
    // Opt-in: thinking_summary content renders when present in the event list.
    expect(screen.getByText('REASONING_FIXTURE_12345')).toBeInTheDocument()
    expect(screen.getByText('hi')).toBeInTheDocument()
  })

  it('renders error event as a system error bubble with Chinese prefix', () => {
    const events: ConsoleTimelineEvent[] = [
      makeEvent({
        eventId: 'err-1',
        eventType: 'error',
        content: '[PROCESSING_ERROR] pipeline timeout',
      }),
    ]

    renderList(events)

    const errorBubble = screen.getByTestId('chat-message-error')
    expect(errorBubble).toBeInTheDocument()
    expect(errorBubble.textContent).toContain('系统')
    expect(errorBubble.textContent).toContain('处理出错：')
    expect(errorBubble.textContent).toContain('[PROCESSING_ERROR] pipeline timeout')
  })

  it('renders thinking_summary content when present as a message item (T6 opt-in)', () => {
    const events: ConsoleTimelineEvent[] = [
      makeEvent({
        eventId: 'th-1',
        eventType: 'thinking_summary',
        content: 'REASONING_FIXTURE_12345',
      }),
      makeEvent({
        eventId: 'u-1',
        eventType: 'user_message',
        content: 'hi',
      }),
    ]

    renderList(events)
    // Opt-in contract: thinking_summary renders when present in the event list.
    expect(screen.getByText('hi')).toBeInTheDocument()
    expect(screen.getByText('REASONING_FIXTURE_12345')).toBeInTheDocument()
  })
})
