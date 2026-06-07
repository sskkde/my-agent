import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import TimelineView, { type TimelineViewEvent } from './TimelineView'

const mockEvents: TimelineViewEvent[] = [
  {
    eventId: 'e1',
    eventType: 'user_message',
    timestamp: '2024-01-15T10:00:00Z',
    description: 'User sent a message',
    status: 'completed',
    module: 'foreground',
  },
  {
    eventId: 'e2',
    eventType: 'assistant_message',
    timestamp: '2024-01-15T10:01:00Z',
    description: 'Assistant responded',
    status: 'completed',
    module: 'foreground',
  },
  {
    eventId: 'e3',
    eventType: 'tool_call',
    timestamp: '2024-01-15T10:02:00Z',
    description: 'Tool called',
    status: 'completed',
    module: 'tools',
  },
  {
    eventId: 'e4',
    eventType: 'run_started',
    timestamp: '2024-01-15T10:03:00Z',
    description: 'Run started',
    status: 'running',
    module: 'planner',
  },
  {
    eventId: 'e5',
    eventType: 'run_completed',
    timestamp: '2024-01-15T10:04:00Z',
    description: 'Run completed',
    status: 'completed',
    module: 'planner',
  },
  {
    eventId: 'e6',
    eventType: 'error',
    timestamp: '2024-01-14T15:00:00Z',
    description: 'An error occurred',
    status: 'failed',
    module: 'system',
  },
]

describe('TimelineView', () => {
  it('renders loading state', () => {
    render(<TimelineView events={[]} loading />)

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('renders empty state when no events', () => {
    render(<TimelineView events={[]} />)

    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(screen.getByText('暂无时间线事件')).toBeInTheDocument()
  })

  it('renders all events', () => {
    render(<TimelineView events={mockEvents} />)

    expect(screen.getByTestId('timeline-event-e1')).toBeInTheDocument()
    expect(screen.getByTestId('timeline-event-e2')).toBeInTheDocument()
    expect(screen.getByTestId('timeline-event-e3')).toBeInTheDocument()
    expect(screen.getByTestId('timeline-event-e4')).toBeInTheDocument()
    expect(screen.getByTestId('timeline-event-e5')).toBeInTheDocument()
    expect(screen.getByTestId('timeline-event-e6')).toBeInTheDocument()
  })

  it('displays event descriptions', () => {
    render(<TimelineView events={mockEvents} />)

    expect(screen.getByText('User sent a message')).toBeInTheDocument()
    expect(screen.getByText('Assistant responded')).toBeInTheDocument()
    expect(screen.getByText('Tool called')).toBeInTheDocument()
  })

  it('displays event type labels', () => {
    render(<TimelineView events={mockEvents} />)

    expect(screen.getByText('用户消息')).toBeInTheDocument()
    expect(screen.getByText('助手回复')).toBeInTheDocument()
    expect(screen.getByText('工具调用')).toBeInTheDocument()
    expect(screen.getByText('运行开始')).toBeInTheDocument()
    expect(screen.getByText('运行完成')).toBeInTheDocument()
    expect(screen.getByText('错误')).toBeInTheDocument()
  })

  it('displays module names', () => {
    render(<TimelineView events={mockEvents} />)

    const foregroundModules = screen.getAllByText('foreground')
    expect(foregroundModules.length).toBeGreaterThanOrEqual(2)

    expect(screen.getByText('tools')).toBeInTheDocument()

    const plannerModules = screen.getAllByText('planner')
    expect(plannerModules.length).toBeGreaterThanOrEqual(2)

    expect(screen.getByText('system')).toBeInTheDocument()
  })

  it('sorts events by timestamp descending', () => {
    render(<TimelineView events={mockEvents} />)

    const events = screen.getAllByRole('button')
    expect(events[0]).toHaveAttribute('data-testid', 'timeline-event-e5')
    expect(events[1]).toHaveAttribute('data-testid', 'timeline-event-e4')
    expect(events[2]).toHaveAttribute('data-testid', 'timeline-event-e3')
  })

  it('expands event details when clicked', () => {
    render(<TimelineView events={mockEvents} />)

    fireEvent.click(screen.getByTestId('timeline-event-e1'))

    expect(screen.getByText('事件ID')).toBeInTheDocument()
    expect(screen.getByText('e1')).toBeInTheDocument()
    expect(screen.getByText('状态')).toBeInTheDocument()
    expect(screen.getByText('completed')).toBeInTheDocument()
  })

  it('collapses expanded event when clicked again', () => {
    render(<TimelineView events={mockEvents} />)

    const eventElement = screen.getByTestId('timeline-event-e1')
    fireEvent.click(eventElement)
    expect(screen.getByText('事件ID')).toBeInTheDocument()

    fireEvent.click(eventElement)
    expect(screen.queryByText('事件ID')).not.toBeInTheDocument()
  })

  it('calls onEventClick when event is clicked', () => {
    const handleClick = vi.fn()
    render(<TimelineView events={mockEvents} onEventClick={handleClick} />)

    fireEvent.click(screen.getByTestId('timeline-event-e1'))

    expect(handleClick).toHaveBeenCalledWith('e1')
  })

  it('applies correct type badge classes', () => {
    render(<TimelineView events={mockEvents} />)

    const userBadge = screen.getByText('用户消息')
    expect(userBadge).toHaveClass('timeline-view__type-badge--user')

    const assistantBadge = screen.getByText('助手回复')
    expect(assistantBadge).toHaveClass('timeline-view__type-badge--assistant')

    const toolBadge = screen.getByText('工具调用')
    expect(toolBadge).toHaveClass('timeline-view__type-badge--tool')
  })

  it('applies correct dot classes', () => {
    const { container } = render(<TimelineView events={mockEvents} />)

    const dots = container.querySelectorAll('.timeline-view__dot')
    expect(dots.length).toBeGreaterThan(0)

    expect(dots[0]).toHaveClass('timeline-view__dot--completed')
    expect(dots[1]).toHaveClass('timeline-view__dot--run')
    expect(dots[2]).toHaveClass('timeline-view__dot--tool')
  })

  it('displays date headers for different dates', () => {
    render(<TimelineView events={mockEvents} />)

    expect(screen.getByText('1月15日')).toBeInTheDocument()
    expect(screen.getByText('1月14日')).toBeInTheDocument()
  })

  it('handles keyboard navigation', () => {
    const handleClick = vi.fn()
    render(<TimelineView events={mockEvents} onEventClick={handleClick} />)

    const eventElement = screen.getByTestId('timeline-event-e1')
    fireEvent.keyDown(eventElement, { key: 'Enter' })

    expect(handleClick).toHaveBeenCalledWith('e1')
  })

  it('handles space key for expansion', () => {
    render(<TimelineView events={mockEvents} />)

    const eventElement = screen.getByTestId('timeline-event-e1')
    fireEvent.keyDown(eventElement, { key: ' ' })

    expect(screen.getByText('事件ID')).toBeInTheDocument()
  })

  it('sets aria-expanded correctly', () => {
    render(<TimelineView events={mockEvents} />)

    const eventElement = screen.getByTestId('timeline-event-e1')
    expect(eventElement).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(eventElement)
    expect(eventElement).toHaveAttribute('aria-expanded', 'true')
  })

  it('displays unknown event type as-is', () => {
    const eventsWithUnknown: TimelineViewEvent[] = [
      {
        eventId: 'e-unknown',
        eventType: 'custom_event',
        timestamp: '2024-01-15T10:00:00Z',
        description: 'Custom event',
        status: 'completed',
        module: 'custom',
      },
    ]

    render(<TimelineView events={eventsWithUnknown} />)

    expect(screen.getByText('custom_event')).toBeInTheDocument()
    expect(screen.getByText('Custom event')).toBeInTheDocument()
  })
})
