import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import AppShell from './AppShell'
import type { TabId } from './TabNav'

const renderWithRouter = (ui: React.ReactElement) => {
  return render(<BrowserRouter>{ui}</BrowserRouter>)
}

describe('AppShell', () => {
  const mockOnTabChange = vi.fn()
  const mockOnToggleNavCollapsed = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders four navigation tabs', () => {
    renderWithRouter(
      <AppShell activeTab="dashboard" onTabChange={mockOnTabChange}>
        <div>Content</div>
      </AppShell>,
    )
    expect(screen.getByTestId('tab-dashboard')).toBeInTheDocument()
    expect(screen.getByTestId('tab-session-console')).toBeInTheDocument()
    expect(screen.getByTestId('tab-agent-monitor')).toBeInTheDocument()
    expect(screen.getByTestId('tab-status')).toBeInTheDocument()
  })

  it('displays Chinese tab labels', () => {
    renderWithRouter(
      <AppShell activeTab="dashboard" onTabChange={mockOnTabChange}>
        <div>Content</div>
      </AppShell>,
    )
    expect(screen.getByRole('tab', { name: '概览' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '会话' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '监控' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '状态' })).toBeInTheDocument()
  })

  it('has dashboard as default active tab', () => {
    renderWithRouter(
      <AppShell activeTab="dashboard" onTabChange={mockOnTabChange}>
        <div>Content</div>
      </AppShell>,
    )
    const dashboardTab = screen.getByTestId('tab-dashboard')
    expect(dashboardTab).toHaveAttribute('aria-selected', 'true')
  })

  it('renders children in content area', () => {
    renderWithRouter(
      <AppShell activeTab="dashboard" onTabChange={mockOnTabChange}>
        <div data-testid="child-content">Test Content</div>
      </AppShell>,
    )
    expect(screen.getByTestId('child-content')).toBeInTheDocument()
  })

  it('switches active tab on click', async () => {
    const MockAppShell = () => {
      const [activeTab, setActiveTab] = React.useState<TabId>('dashboard')
      return (
        <BrowserRouter>
          <AppShell activeTab={activeTab} onTabChange={setActiveTab}>
            <div>Content</div>
          </AppShell>
        </BrowserRouter>
      )
    }
    render(<MockAppShell />)

    const sessionTab = screen.getByTestId('tab-session-console')
    fireEvent.click(sessionTab)

    expect(screen.getByTestId('tab-session-console')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('tab-dashboard')).toHaveAttribute('aria-selected', 'false')
  })

  it('has sidebar with proper layout classes', () => {
    renderWithRouter(
      <AppShell activeTab="dashboard" onTabChange={mockOnTabChange}>
        <div>Content</div>
      </AppShell>,
    )
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
  })

  it('has content panel that fills remaining space', () => {
    renderWithRouter(
      <AppShell activeTab="dashboard" onTabChange={mockOnTabChange}>
        <div>Content</div>
      </AppShell>,
    )
    expect(screen.getByTestId('content-panel')).toBeInTheDocument()
  })

  it('has data-testid="app-shell" on root element', () => {
    renderWithRouter(
      <AppShell activeTab="dashboard" onTabChange={mockOnTabChange}>
        <div>Content</div>
      </AppShell>,
    )
    expect(screen.getByTestId('app-shell')).toBeInTheDocument()
  })

  it('has data-testid="sidebar" on sidebar element', () => {
    renderWithRouter(
      <AppShell activeTab="dashboard" onTabChange={mockOnTabChange}>
        <div>Content</div>
      </AppShell>,
    )
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
  })

  it('has data-testid="topbar" showing breadcrumb', () => {
    renderWithRouter(
      <AppShell activeTab="dashboard" onTabChange={mockOnTabChange}>
        <div>Content</div>
      </AppShell>,
    )
    expect(screen.getByTestId('topbar')).toBeInTheDocument()
  })

  it('has sidebar collapse toggle with aria-expanded="true" initially', () => {
    renderWithRouter(
      <AppShell
        activeTab="dashboard"
        onTabChange={mockOnTabChange}
        onToggleNavCollapsed={mockOnToggleNavCollapsed}
        isNavCollapsed={false}
      >
        <div>Content</div>
      </AppShell>,
    )
    const toggle = screen.getByTestId('sidebar-collapse-toggle')
    expect(toggle).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('has mobile nav toggle with aria-expanded="false" initially', () => {
    renderWithRouter(
      <AppShell activeTab="dashboard" onTabChange={mockOnTabChange} isNavCollapsed={false}>
        <div>Content</div>
      </AppShell>,
    )
    const toggle = screen.getByTestId('mobile-nav-toggle')
    expect(toggle).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('calls onToggleNavCollapsed when sidebar collapse toggle is clicked', () => {
    renderWithRouter(
      <AppShell
        activeTab="dashboard"
        onTabChange={mockOnTabChange}
        onToggleNavCollapsed={mockOnToggleNavCollapsed}
        isNavCollapsed={false}
      >
        <div>Content</div>
      </AppShell>,
    )
    fireEvent.click(screen.getByTestId('sidebar-collapse-toggle'))
    expect(mockOnToggleNavCollapsed).toHaveBeenCalledTimes(1)
  })
})
