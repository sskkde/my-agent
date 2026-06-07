import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { BackgroundTaskCard } from './BackgroundTaskCard'

describe('BackgroundTaskCard', () => {
  const defaultProps = {
    taskId: 'task-123',
    label: 'Processing data',
    status: 'running' as const,
  }

  it('renders task label and status badge', () => {
    render(<BackgroundTaskCard {...defaultProps} />)
    expect(screen.getByText('Processing data')).toBeInTheDocument()
    expect(screen.getByText('运行中')).toBeInTheDocument()
  })

  it('shows progress bar for running status with progress', () => {
    render(<BackgroundTaskCard {...defaultProps} progress={50} />)
    const progressBar = screen.getByRole('progressbar')
    expect(progressBar).toBeInTheDocument()
    expect(progressBar).toHaveAttribute('aria-valuenow', '50')
  })

  it('shows progress percentage text', () => {
    render(<BackgroundTaskCard {...defaultProps} progress={75} />)
    expect(screen.getByText('75%')).toBeInTheDocument()
  })

  it('clamps progress to 0-100 range', () => {
    const { container } = render(<BackgroundTaskCard {...defaultProps} progress={150} />)
    const progressBar = container.querySelector('.bg-task-card__progress-bar')
    expect(progressBar).toHaveStyle({ width: '100%' })
  })

  it('clamps negative progress to 0', () => {
    const { container } = render(<BackgroundTaskCard {...defaultProps} progress={-10} />)
    const progressBar = container.querySelector('.bg-task-card__progress-bar')
    expect(progressBar).toHaveStyle({ width: '0%' })
  })

  it('does not show progress bar when progress is undefined', () => {
    render(<BackgroundTaskCard {...defaultProps} />)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('does not show progress bar for completed status', () => {
    render(<BackgroundTaskCard {...defaultProps} status="completed" progress={100} />)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('does not show progress bar for failed status', () => {
    render(<BackgroundTaskCard {...defaultProps} status="failed" progress={50} />)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('does not show progress bar for cancelled status', () => {
    render(<BackgroundTaskCard {...defaultProps} status="cancelled" progress={50} />)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows message when provided', () => {
    render(<BackgroundTaskCard {...defaultProps} message="Processing file 3 of 10" />)
    expect(screen.getByText('Processing file 3 of 10')).toBeInTheDocument()
  })

  it('does not show message when undefined', () => {
    const { container } = render(<BackgroundTaskCard {...defaultProps} />)
    expect(screen.queryByText('Processing file 3 of 10')).not.toBeInTheDocument()
    expect(container.querySelector('.bg-task-card__message')).not.toBeInTheDocument()
  })

  it('shows completed status', () => {
    render(<BackgroundTaskCard {...defaultProps} status="completed" />)
    expect(screen.getByText('已完成')).toBeInTheDocument()
  })

  it('shows failed status', () => {
    render(<BackgroundTaskCard {...defaultProps} status="failed" />)
    expect(screen.getByText('失败')).toBeInTheDocument()
  })

  it('shows cancelled status', () => {
    render(<BackgroundTaskCard {...defaultProps} status="cancelled" />)
    expect(screen.getByText('已取消')).toBeInTheDocument()
  })

  it('shows loading spinner for running status', () => {
    render(<BackgroundTaskCard {...defaultProps} />)
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('does not show loading spinner for completed status', () => {
    render(<BackgroundTaskCard {...defaultProps} status="completed" />)
    expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument()
  })

  it('applies correct status data attribute', () => {
    const { rerender } = render(<BackgroundTaskCard {...defaultProps} status="running" />)
    expect(screen.getByTestId('bg-task-card')).toHaveAttribute('data-status', 'running')

    rerender(<BackgroundTaskCard {...defaultProps} status="completed" />)
    expect(screen.getByTestId('bg-task-card')).toHaveAttribute('data-status', 'completed')

    rerender(<BackgroundTaskCard {...defaultProps} status="failed" />)
    expect(screen.getByTestId('bg-task-card')).toHaveAttribute('data-status', 'failed')

    rerender(<BackgroundTaskCard {...defaultProps} status="cancelled" />)
    expect(screen.getByTestId('bg-task-card')).toHaveAttribute('data-status', 'cancelled')
  })

  it('applies task id data attribute', () => {
    render(<BackgroundTaskCard {...defaultProps} taskId="custom-task-id" />)
    expect(screen.getByTestId('bg-task-card')).toHaveAttribute('data-task-id', 'custom-task-id')
  })
})
