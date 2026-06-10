import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TabNav from './TabNav'

describe('TabNav', () => {
  const mockOnChange = vi.fn()

  beforeEach(() => {
    mockOnChange.mockClear()
  })

  it('renders four tab buttons', () => {
    render(<TabNav activeTab="dashboard" onTabChange={mockOnChange} />)
    expect(screen.getByTestId('tab-dashboard')).toBeInTheDocument()
    expect(screen.getByTestId('tab-session-console')).toBeInTheDocument()
    expect(screen.getByTestId('tab-agent-monitor')).toBeInTheDocument()
    expect(screen.getByTestId('tab-status')).toBeInTheDocument()
  })

  it('displays correct Chinese labels', () => {
    render(<TabNav activeTab="dashboard" onTabChange={mockOnChange} />)
    expect(screen.getByText('概览')).toBeInTheDocument()
    expect(screen.getByText('会话')).toBeInTheDocument()
    expect(screen.getByText('监控')).toBeInTheDocument()
    expect(screen.getByText('状态')).toBeInTheDocument()
  })

  it('marks active tab with aria-selected true', () => {
    render(<TabNav activeTab="session-console" onTabChange={mockOnChange} />)
    expect(screen.getByTestId('tab-session-console')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('tab-dashboard')).toHaveAttribute('aria-selected', 'false')
  })

  it('calls onTabChange when tab is clicked', () => {
    render(<TabNav activeTab="dashboard" onTabChange={mockOnChange} />)
    fireEvent.click(screen.getByTestId('tab-status'))
    expect(mockOnChange).toHaveBeenCalledWith('status')
  })

  it('supports keyboard navigation with Enter key', () => {
    render(<TabNav activeTab="dashboard" onTabChange={mockOnChange} />)
    const tab = screen.getByTestId('tab-agent-monitor')
    fireEvent.keyDown(tab, { key: 'Enter', code: 'Enter' })
    expect(mockOnChange).toHaveBeenCalledWith('agent-monitor')
  })

  it('supports keyboard navigation with Space key', () => {
    render(<TabNav activeTab="dashboard" onTabChange={mockOnChange} />)
    const tab = screen.getByTestId('tab-session-console')
    fireEvent.keyDown(tab, { key: ' ', code: 'Space' })
    expect(mockOnChange).toHaveBeenCalledWith('session-console')
  })

  it('has nav-group-chat data-testid for Chat group section', () => {
    render(<TabNav activeTab="dashboard" onTabChange={mockOnChange} isExpanded={true} />)
    expect(screen.getByTestId('nav-group-chat')).toBeInTheDocument()
  })

  it('has nav-group-control data-testid for Control group section', () => {
    render(<TabNav activeTab="dashboard" onTabChange={mockOnChange} isExpanded={true} />)
    expect(screen.getByTestId('nav-group-control')).toBeInTheDocument()
  })

  it('has nav-group-agent data-testid for Agent group section', () => {
    render(<TabNav activeTab="dashboard" onTabChange={mockOnChange} isExpanded={true} />)
    expect(screen.getByTestId('nav-group-agent')).toBeInTheDocument()
  })

  it('renders group section labels in expanded mode', () => {
    render(<TabNav activeTab="dashboard" onTabChange={mockOnChange} isExpanded={true} />)
    expect(screen.getByText('Chat')).toBeInTheDocument()
    expect(screen.getByText('Control')).toBeInTheDocument()
    expect(screen.getByText('Agent')).toBeInTheDocument()
  })

  it('renders tab nav items with SVG icons', () => {
    render(<TabNav activeTab="dashboard" onTabChange={mockOnChange} />)
    const dashboardTab = screen.getByTestId('tab-dashboard')
    const sessionTab = screen.getByTestId('tab-session-console')
    const monitorTab = screen.getByTestId('tab-agent-monitor')
    const statusTab = screen.getByTestId('tab-status')

    expect(dashboardTab.querySelector('svg')).toBeInTheDocument()
    expect(sessionTab.querySelector('svg')).toBeInTheDocument()
    expect(monitorTab.querySelector('svg')).toBeInTheDocument()
    expect(statusTab.querySelector('svg')).toBeInTheDocument()
  })

  // =============================================================================
  // Section-Scoped Rendering Tests (Task 6 - Failing Tests)
  // These tests verify that TabNav renders ONLY tabs for the active product section
  // =============================================================================

  describe('Section-Scoped Rendering', () => {
    it('renders only chat tabs when activeSection is chat', () => {
      render(<TabNav activeTab="session-console" onTabChange={mockOnChange} activeSection="chat" />)

      // Should show chat tabs
      expect(screen.getByTestId('tab-session-console')).toBeInTheDocument()

      // Should NOT show workspace tabs
      expect(screen.queryByTestId('tab-dashboard')).not.toBeInTheDocument()
      expect(screen.queryByTestId('tab-sessions')).not.toBeInTheDocument()
      expect(screen.queryByTestId('tab-workflows')).not.toBeInTheDocument()

      // Should NOT show operations tabs
      expect(screen.queryByTestId('tab-agent-monitor')).not.toBeInTheDocument()
      expect(screen.queryByTestId('tab-skills')).not.toBeInTheDocument()

      // Should NOT show admin tabs
      expect(screen.queryByTestId('tab-settings')).not.toBeInTheDocument()
    })

    it('renders only workspace tabs when activeSection is workspace', () => {
      render(<TabNav activeTab="dashboard" onTabChange={mockOnChange} activeSection="workspace" />)

      // Should show all workspace tabs
      expect(screen.getByTestId('tab-dashboard')).toBeInTheDocument()
      expect(screen.getByTestId('tab-sessions')).toBeInTheDocument()
      expect(screen.getByTestId('tab-usage')).toBeInTheDocument()
      expect(screen.getByTestId('tab-workflows')).toBeInTheDocument()
      expect(screen.getByTestId('tab-observability')).toBeInTheDocument()

      // Should NOT show chat tabs
      expect(screen.queryByTestId('tab-session-console')).not.toBeInTheDocument()

      // Should NOT show operations tabs
      expect(screen.queryByTestId('tab-agent-monitor')).not.toBeInTheDocument()

      // Should NOT show admin tabs
      expect(screen.queryByTestId('tab-settings')).not.toBeInTheDocument()
    })

    it('renders only operations tabs when activeSection is operations', () => {
      render(<TabNav activeTab="agent-monitor" onTabChange={mockOnChange} activeSection="operations" />)

      // Should show all operations tabs
      expect(screen.getByTestId('tab-agent-monitor')).toBeInTheDocument()
      expect(screen.getByTestId('tab-skills')).toBeInTheDocument()
      expect(screen.getByTestId('tab-agents')).toBeInTheDocument()
      expect(screen.getByTestId('tab-connectors')).toBeInTheDocument()
      expect(screen.getByTestId('tab-dlq')).toBeInTheDocument()

      // Should NOT show workspace tabs
      expect(screen.queryByTestId('tab-dashboard')).not.toBeInTheDocument()
      expect(screen.queryByTestId('tab-workflows')).not.toBeInTheDocument()

      // Should NOT show chat tabs
      expect(screen.queryByTestId('tab-session-console')).not.toBeInTheDocument()

      // Should NOT show admin tabs
      expect(screen.queryByTestId('tab-settings')).not.toBeInTheDocument()
    })

    it('renders only admin tabs when activeSection is admin', () => {
      render(<TabNav activeTab="settings" onTabChange={mockOnChange} activeSection="admin" />)

      // Should show all admin tabs
      expect(screen.getByTestId('tab-settings')).toBeInTheDocument()
      expect(screen.getByTestId('tab-admin')).toBeInTheDocument()

      // Should NOT show workspace tabs
      expect(screen.queryByTestId('tab-dashboard')).not.toBeInTheDocument()

      // Should NOT show operations tabs
      expect(screen.queryByTestId('tab-agent-monitor')).not.toBeInTheDocument()

      // Should NOT show chat tabs
      expect(screen.queryByTestId('tab-session-console')).not.toBeInTheDocument()
    })

    it('tab count matches section tab count for chat (1 tab)', () => {
      render(<TabNav activeTab="session-console" onTabChange={mockOnChange} activeSection="chat" />)

      const tabs = screen.getAllByRole('tab')
      expect(tabs).toHaveLength(1)
    })

    it('tab count matches section tab count for workspace (12 tabs)', () => {
      render(<TabNav activeTab="dashboard" onTabChange={mockOnChange} activeSection="workspace" />)

      const tabs = screen.getAllByRole('tab')
      expect(tabs).toHaveLength(12)
    })

    it('tab count matches section tab count for operations (5 tabs)', () => {
      render(<TabNav activeTab="agent-monitor" onTabChange={mockOnChange} activeSection="operations" />)

      const tabs = screen.getAllByRole('tab')
      expect(tabs).toHaveLength(5)
    })

    it('tab count matches section tab count for admin (2 tabs)', () => {
      render(<TabNav activeTab="settings" onTabChange={mockOnChange} activeSection="admin" />)

      const tabs = screen.getAllByRole('tab')
      expect(tabs).toHaveLength(2)
    })

    it('updates rendered tabs when activeSection changes', () => {
      const { rerender } = render(
        <TabNav activeTab="dashboard" onTabChange={mockOnChange} activeSection="workspace" />,
      )

      // Initially shows workspace tabs
      expect(screen.getByTestId('tab-dashboard')).toBeInTheDocument()
      expect(screen.queryByTestId('tab-agent-monitor')).not.toBeInTheDocument()

      // Switch to operations section
      rerender(
        <TabNav activeTab="agent-monitor" onTabChange={mockOnChange} activeSection="operations" />,
      )

      // Now shows operations tabs
      expect(screen.queryByTestId('tab-dashboard')).not.toBeInTheDocument()
      expect(screen.getByTestId('tab-agent-monitor')).toBeInTheDocument()
      expect(screen.getByTestId('tab-skills')).toBeInTheDocument()
    })
  })
})
