import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import EmptyState from './EmptyState'

describe('EmptyState', () => {
  it('renders with title only', () => {
    render(<EmptyState title="暂无数据" />)

    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument()
  })

  it('renders with icon', () => {
    render(<EmptyState title="暂无数据" icon="📭" />)

    expect(screen.getByText('📭')).toBeInTheDocument()
    expect(screen.getByText('📭')).toHaveClass('empty-state__icon')
    expect(screen.getByText('📭')).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders with description', () => {
    render(<EmptyState title="暂无数据" description="当前列表为空，请添加新项目" />)

    expect(screen.getByText('当前列表为空，请添加新项目')).toBeInTheDocument()
    expect(screen.getByText('当前列表为空，请添加新项目')).toHaveClass('empty-state__description')
  })

  it('renders with action button', () => {
    const handleClick = vi.fn()
    render(<EmptyState title="暂无数据" action={{ label: '添加项目', onClick: handleClick }} />)

    const button = screen.getByTestId('empty-state-action')
    expect(button).toBeInTheDocument()
    expect(button).toHaveTextContent('添加项目')
    expect(button).toHaveClass('empty-state__action')
  })

  it('calls action onClick when button is clicked', () => {
    const handleClick = vi.fn()
    render(<EmptyState title="暂无数据" action={{ label: '添加项目', onClick: handleClick }} />)

    fireEvent.click(screen.getByTestId('empty-state-action'))

    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('renders with all props', () => {
    const handleClick = vi.fn()
    render(
      <EmptyState
        icon="📭"
        title="暂无数据"
        description="当前列表为空"
        action={{ label: '添加项目', onClick: handleClick }}
      />,
    )

    expect(screen.getByText('📭')).toBeInTheDocument()
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
    expect(screen.getByText('当前列表为空')).toBeInTheDocument()
    expect(screen.getByTestId('empty-state-action')).toBeInTheDocument()
  })

  it('does not render icon when not provided', () => {
    render(<EmptyState title="暂无数据" />)

    const iconElement = document.querySelector('.empty-state__icon')
    expect(iconElement).not.toBeInTheDocument()
  })

  it('does not render description when not provided', () => {
    render(<EmptyState title="暂无数据" />)

    const descriptionElement = document.querySelector('.empty-state__description')
    expect(descriptionElement).not.toBeInTheDocument()
  })

  it('does not render action when not provided', () => {
    render(<EmptyState title="暂无数据" />)

    const actionElement = document.querySelector('.empty-state__action')
    expect(actionElement).not.toBeInTheDocument()
    expect(screen.queryByTestId('empty-state-action')).not.toBeInTheDocument()
  })
})
