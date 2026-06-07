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
})
