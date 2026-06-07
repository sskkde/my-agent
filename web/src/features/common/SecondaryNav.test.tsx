import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SecondaryNav from './SecondaryNav'
import type { TabId } from '../../navigation/navigation-config'

describe('SecondaryNav', () => {
  const mockOnChange = vi.fn()

  const defaultItems = [
    { id: 'approvals' as TabId, label: '审批' },
    { id: 'memory' as TabId, label: '记忆' },
    { id: 'observability' as TabId, label: '可观测' },
  ]

  beforeEach(() => {
    mockOnChange.mockClear()
  })

  it('renders tab items with correct test IDs', () => {
    render(<SecondaryNav items={defaultItems} activeTabId="approvals" onTabChange={mockOnChange} />)

    expect(screen.getByTestId('secondary-nav-approvals')).toBeInTheDocument()
    expect(screen.getByTestId('secondary-nav-memory')).toBeInTheDocument()
    expect(screen.getByTestId('secondary-nav-observability')).toBeInTheDocument()
  })

  it('displays correct labels for tab items', () => {
    render(<SecondaryNav items={defaultItems} activeTabId="approvals" onTabChange={mockOnChange} />)

    expect(screen.getByText('审批')).toBeInTheDocument()
    expect(screen.getByText('记忆')).toBeInTheDocument()
    expect(screen.getByText('可观测')).toBeInTheDocument()
  })

  it('marks active tab with aria-selected true', () => {
    render(<SecondaryNav items={defaultItems} activeTabId="memory" onTabChange={mockOnChange} />)

    expect(screen.getByTestId('secondary-nav-memory')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('secondary-nav-approvals')).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByTestId('secondary-nav-observability')).toHaveAttribute('aria-selected', 'false')
  })

  it('applies active class to active tab', () => {
    render(<SecondaryNav items={defaultItems} activeTabId="observability" onTabChange={mockOnChange} />)

    const activeTab = screen.getByTestId('secondary-nav-observability')
    expect(activeTab).toHaveClass('secondary-nav__item--active')
  })

  it('calls onTabChange when tab is clicked', () => {
    render(<SecondaryNav items={defaultItems} activeTabId="approvals" onTabChange={mockOnChange} />)

    fireEvent.click(screen.getByTestId('secondary-nav-memory'))
    expect(mockOnChange).toHaveBeenCalledWith('memory')
  })

  it('supports keyboard navigation with Enter key', () => {
    render(<SecondaryNav items={defaultItems} activeTabId="approvals" onTabChange={mockOnChange} />)

    const tab = screen.getByTestId('secondary-nav-observability')
    fireEvent.keyDown(tab, { key: 'Enter', code: 'Enter' })
    expect(mockOnChange).toHaveBeenCalledWith('observability')
  })

  it('supports keyboard navigation with Space key', () => {
    render(<SecondaryNav items={defaultItems} activeTabId="approvals" onTabChange={mockOnChange} />)

    const tab = screen.getByTestId('secondary-nav-memory')
    fireEvent.keyDown(tab, { key: ' ', code: 'Space' })
    expect(mockOnChange).toHaveBeenCalledWith('memory')
  })

  it('renders empty state message when items array is empty', () => {
    render(<SecondaryNav items={[]} activeTabId="approvals" onTabChange={mockOnChange} />)

    expect(screen.getByText('暂无导航项')).toBeInTheDocument()
  })

  it('renders nav element with correct role and aria-label', () => {
    render(<SecondaryNav items={defaultItems} activeTabId="approvals" onTabChange={mockOnChange} />)

    const nav = screen.getByRole('tablist')
    expect(nav).toHaveAttribute('aria-label', '二级导航')
  })

  it('renders buttons with type="button"', () => {
    render(<SecondaryNav items={defaultItems} activeTabId="approvals" onTabChange={mockOnChange} />)

    const buttons = screen.getAllByRole('tab')
    buttons.forEach((button) => {
      expect(button).toHaveAttribute('type', 'button')
    })
  })

  it('applies custom className to nav element', () => {
    render(
      <SecondaryNav
        items={defaultItems}
        activeTabId="approvals"
        onTabChange={mockOnChange}
        className="custom-nav-class"
      />,
    )

    const nav = screen.getByRole('tablist')
    expect(nav).toHaveClass('custom-nav-class')
  })

  it('renders all tab items with button semantics', () => {
    render(<SecondaryNav items={defaultItems} activeTabId="approvals" onTabChange={mockOnChange} />)

    const buttons = screen.getAllByRole('tab')
    expect(buttons).toHaveLength(3)
    buttons.forEach((button) => {
      expect(button.tagName.toLowerCase()).toBe('button')
    })
  })
})
