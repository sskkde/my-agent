import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ToolCallCard } from './ToolCallCard'

describe('ToolCallCard', () => {
  const defaultProps = {
    toolName: 'file.read',
    parameters: { path: '/src/index.ts' },
    status: 'completed' as const,
  }

  it('renders tool name and status badge', () => {
    render(<ToolCallCard {...defaultProps} />)
    expect(screen.getAllByText('file.read')).toHaveLength(2)
    expect(screen.getByText('已完成')).toBeInTheDocument()
  })

  it('renders collapsed by default', () => {
    render(<ToolCallCard {...defaultProps} />)
    expect(screen.queryByText('参数')).not.toBeInTheDocument()
    expect(screen.queryByText('结果')).not.toBeInTheDocument()
  })

  it('expands to show parameters when header clicked', () => {
    render(<ToolCallCard {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('参数')).toBeInTheDocument()
    expect(screen.getByText(/"path": "\/src\/index.ts"/)).toBeInTheDocument()
  })

  it('shows result section when result is provided', () => {
    render(<ToolCallCard {...defaultProps} result="file content here" />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('结果')).toBeInTheDocument()
    expect(screen.getByText('file content here')).toBeInTheDocument()
  })

  it('does not show result section when result is undefined', () => {
    render(<ToolCallCard {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.queryByText('结果')).not.toBeInTheDocument()
  })

  it('displays duration when provided', () => {
    render(<ToolCallCard {...defaultProps} durationMs={1500} />)
    expect(screen.getByText('1.50s')).toBeInTheDocument()
  })

  it('formats milliseconds correctly', () => {
    render(<ToolCallCard {...defaultProps} durationMs={500} />)
    expect(screen.getByText('500ms')).toBeInTheDocument()
  })

  it('calls onExpand callback when expanded', () => {
    const onExpand = vi.fn()
    render(<ToolCallCard {...defaultProps} onExpand={onExpand} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(onExpand).toHaveBeenCalledTimes(1)
  })

  it('shows running status with loading spinner', () => {
    render(<ToolCallCard {...defaultProps} status="running" />)
    expect(screen.getByText('运行中')).toBeInTheDocument()
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('shows failed status', () => {
    render(<ToolCallCard {...defaultProps} status="failed" />)
    expect(screen.getByText('失败')).toBeInTheDocument()
  })

  it('does not show duration for running status', () => {
    render(<ToolCallCard {...defaultProps} status="running" durationMs={500} />)
    expect(screen.queryByText('500ms')).not.toBeInTheDocument()
  })

  it('toggles between collapsed and expanded', () => {
    render(<ToolCallCard {...defaultProps} />)
    const header = screen.getByRole('button', { expanded: false })

    fireEvent.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'false')
  })

  it('expands with Enter key', () => {
    render(<ToolCallCard {...defaultProps} />)
    const header = screen.getByRole('button', { expanded: false })
    fireEvent.keyDown(header, { key: 'Enter' })
    expect(header).toHaveAttribute('aria-expanded', 'true')
  })

  it('expands with Space key', () => {
    render(<ToolCallCard {...defaultProps} />)
    const header = screen.getByRole('button', { expanded: false })
    fireEvent.keyDown(header, { key: ' ' })
    expect(header).toHaveAttribute('aria-expanded', 'true')
  })

  it('displays complex parameters as formatted JSON', () => {
    const params = {
      path: '/src/index.ts',
      options: { encoding: 'utf-8', lines: [1, 10] },
    }
    render(<ToolCallCard {...defaultProps} parameters={params} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText(/"encoding": "utf-8"/)).toBeInTheDocument()
  })

  it('applies correct status data attribute', () => {
    const { rerender } = render(<ToolCallCard {...defaultProps} status="running" />)
    expect(screen.getByTestId('tool-call-card')).toHaveAttribute('data-status', 'running')

    rerender(<ToolCallCard {...defaultProps} status="completed" />)
    expect(screen.getByTestId('tool-call-card')).toHaveAttribute('data-status', 'completed')

    rerender(<ToolCallCard {...defaultProps} status="failed" />)
    expect(screen.getByTestId('tool-call-card')).toHaveAttribute('data-status', 'failed')
  })
})
