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

  it('marks only the active tab with aria-selected true', () => {
    render(<SecondaryNav items={defaultItems} activeTabId="memory" onTabChange={mockOnChange} />)

    expect(screen.getByTestId('secondary-nav-memory')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('secondary-nav-approvals')).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByTestId('secondary-nav-observability')).toHaveAttribute('aria-selected', 'false')
  })

  it('keeps the active tab in the tab order for keyboard accessibility', () => {
    render(<SecondaryNav items={defaultItems} activeTabId="memory" onTabChange={mockOnChange} />)

    expect(screen.getByTestId('secondary-nav-memory')).toHaveAttribute('tabindex', '0')
    expect(screen.getByTestId('secondary-nav-approvals')).toHaveAttribute('tabindex', '-1')
    expect(screen.getByTestId('secondary-nav-observability')).toHaveAttribute('tabindex', '-1')
  })

  it('applies active class only to the active tab', () => {
    render(<SecondaryNav items={defaultItems} activeTabId="observability" onTabChange={mockOnChange} />)

    const activeTab = screen.getByTestId('secondary-nav-observability')
    const inactiveTab = screen.getByTestId('secondary-nav-approvals')

    expect(activeTab).toHaveClass('secondary-nav__item--active')
    expect(inactiveTab).not.toHaveClass('secondary-nav__item--active')
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

    expect(screen.getByText('暂无导航项')).toHaveClass('secondary-nav__empty')
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })

  it('renders nav element with correct role, aria-label, and styling hook', () => {
    render(<SecondaryNav items={defaultItems} activeTabId="approvals" onTabChange={mockOnChange} />)

    const nav = screen.getByRole('tablist')
    expect(nav).toHaveAttribute('aria-label', '二级导航')
    expect(nav).toHaveClass('secondary-nav')
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
