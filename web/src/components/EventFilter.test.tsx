import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import EventFilter, { type EventTypeOption } from './EventFilter'

const mockEventTypes: EventTypeOption[] = [
  { type: 'user_message', label: '用户消息', count: 10 },
  { type: 'assistant_message', label: '助手回复', count: 8 },
  { type: 'tool_call', label: '工具调用', count: 5 },
  { type: 'error', label: '错误', count: 2 },
]

describe('EventFilter', () => {
  it('renders all event type chips', () => {
    render(<EventFilter eventTypes={mockEventTypes} selectedTypes={[]} onChange={() => {}} />)

    expect(screen.getByText('用户消息')).toBeInTheDocument()
    expect(screen.getByText('助手回复')).toBeInTheDocument()
    expect(screen.getByText('工具调用')).toBeInTheDocument()
    expect(screen.getByText('错误')).toBeInTheDocument()
  })

  it('renders event counts', () => {
    render(<EventFilter eventTypes={mockEventTypes} selectedTypes={[]} onChange={() => {}} />)

    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders all option by default', () => {
    render(<EventFilter eventTypes={mockEventTypes} selectedTypes={[]} onChange={() => {}} />)

    expect(screen.getByText('全部')).toBeInTheDocument()
  })

  it('hides all option when showAllOption is false', () => {
    render(<EventFilter eventTypes={mockEventTypes} selectedTypes={[]} onChange={() => {}} showAllOption={false} />)

    expect(screen.queryByText('全部')).not.toBeInTheDocument()
  })

  it('marks all chips as selected when selectedTypes is empty', () => {
    render(<EventFilter eventTypes={mockEventTypes} selectedTypes={[]} onChange={() => {}} />)

    expect(screen.getByTestId('filter-chip-all')).toHaveClass('event-filter__chip--selected')
    expect(screen.getByTestId('filter-chip-user_message')).toHaveClass('event-filter__chip--selected')
  })

  it('marks specific chips as selected based on selectedTypes', () => {
    render(
      <EventFilter eventTypes={mockEventTypes} selectedTypes={['user_message', 'tool_call']} onChange={() => {}} />,
    )

    expect(screen.getByTestId('filter-chip-user_message')).toHaveClass('event-filter__chip--selected')
    expect(screen.getByTestId('filter-chip-tool_call')).toHaveClass('event-filter__chip--selected')
    expect(screen.getByTestId('filter-chip-assistant_message')).not.toHaveClass('event-filter__chip--selected')
    expect(screen.getByTestId('filter-chip-all')).not.toHaveClass('event-filter__chip--selected')
  })

  it('calls onChange with empty array when all is clicked', () => {
    const handleChange = vi.fn()
    render(<EventFilter eventTypes={mockEventTypes} selectedTypes={['user_message']} onChange={handleChange} />)

    fireEvent.click(screen.getByTestId('filter-chip-all'))

    expect(handleChange).toHaveBeenCalledWith([])
  })

  it('adds type to selection when chip is clicked (multi-select)', () => {
    const handleChange = vi.fn()
    render(<EventFilter eventTypes={mockEventTypes} selectedTypes={['user_message']} onChange={handleChange} />)

    fireEvent.click(screen.getByTestId('filter-chip-tool_call'))

    expect(handleChange).toHaveBeenCalledWith(['user_message', 'tool_call'])
  })

  it('removes type from selection when selected chip is clicked', () => {
    const handleChange = vi.fn()
    render(
      <EventFilter eventTypes={mockEventTypes} selectedTypes={['user_message', 'tool_call']} onChange={handleChange} />,
    )

    fireEvent.click(screen.getByTestId('filter-chip-user_message'))

    expect(handleChange).toHaveBeenCalledWith(['tool_call'])
  })

  it('selects only one type in single-select mode', () => {
    const handleChange = vi.fn()
    render(
      <EventFilter
        eventTypes={mockEventTypes}
        selectedTypes={['user_message']}
        onChange={handleChange}
        multiSelect={false}
      />,
    )

    fireEvent.click(screen.getByTestId('filter-chip-tool_call'))

    expect(handleChange).toHaveBeenCalledWith(['tool_call'])
  })

  it('has correct accessibility attributes', () => {
    render(<EventFilter eventTypes={mockEventTypes} selectedTypes={[]} onChange={() => {}} />)

    const filter = screen.getByTestId('event-filter')
    expect(filter).toHaveAttribute('role', 'group')
    expect(filter).toHaveAttribute('aria-label', '事件类型过滤')
  })

  it('has aria-pressed on chips', () => {
    render(<EventFilter eventTypes={mockEventTypes} selectedTypes={['user_message']} onChange={() => {}} />)

    expect(screen.getByTestId('filter-chip-user_message')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('filter-chip-assistant_message')).toHaveAttribute('aria-pressed', 'false')
  })

  it('handles empty event types', () => {
    render(<EventFilter eventTypes={[]} selectedTypes={[]} onChange={() => {}} />)

    expect(screen.getByTestId('filter-chip-all')).toBeInTheDocument()
  })

  it('counts wrap in correct element', () => {
    render(<EventFilter eventTypes={mockEventTypes} selectedTypes={[]} onChange={() => {}} />)

    const count = screen.getByText('10')
    expect(count).toHaveClass('event-filter__count')
  })
})
