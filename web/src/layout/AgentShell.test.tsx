import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import AgentShell from './AgentShell'
import type { TabId } from '../components/TabNav'
import { ready, loading, empty, error } from '../features/context/card-state'

const renderWithRouter = (ui: React.ReactElement) => {
  return render(<BrowserRouter>{ui}</BrowserRouter>)
}

describe('AgentShell', () => {
  const mockOnTabChange = vi.fn()
  const mockOnToggleNavCollapsed = vi.fn()
  const mockOnLogout = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // =============================================================================
  // Product Navigation Tests (Round 1)
  // =============================================================================

  describe('Product Navigation', () => {
    it('renders all four product navigation sections', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      expect(screen.getByTestId('product-nav')).toBeInTheDocument()
      expect(screen.getByTestId('product-nav-chat')).toBeInTheDocument()
      expect(screen.getByTestId('product-nav-workspace')).toBeInTheDocument()
      expect(screen.getByTestId('product-nav-operations')).toBeInTheDocument()
      expect(screen.getByTestId('product-nav-admin')).toBeInTheDocument()
    })

    it('displays product section labels', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      // Product section labels (Chinese) - check they are in product nav buttons
      const productNav = screen.getByTestId('product-nav')
      expect(productNav).toHaveTextContent('会话')
      expect(productNav).toHaveTextContent('工作区')
      expect(productNav).toHaveTextContent('运维')
      expect(productNav).toHaveTextContent('管理')
    })

    it('marks active product section with aria-current="page"', () => {
      renderWithRouter(
        <AgentShell activeTab="session-console" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      // session-console is in 'chat' section
      const chatSection = screen.getByTestId('product-nav-chat')
      expect(chatSection).toHaveAttribute('aria-current', 'page')

      // Other sections should not be marked as current
      expect(screen.getByTestId('product-nav-workspace')).not.toHaveAttribute('aria-current')
      expect(screen.getByTestId('product-nav-operations')).not.toHaveAttribute('aria-current')
      expect(screen.getByTestId('product-nav-admin')).not.toHaveAttribute('aria-current')
    })

    it('marks workspace section as active when on dashboard tab', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      const workspaceSection = screen.getByTestId('product-nav-workspace')
      expect(workspaceSection).toHaveAttribute('aria-current', 'page')
    })

    it('marks operations section as active when on agent-monitor tab', () => {
      renderWithRouter(
        <AgentShell activeTab="agent-monitor" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      const operationsSection = screen.getByTestId('product-nav-operations')
      expect(operationsSection).toHaveAttribute('aria-current', 'page')
    })

    it('marks admin section as active when on settings tab', () => {
      renderWithRouter(
        <AgentShell activeTab="settings" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      const adminSection = screen.getByTestId('product-nav-admin')
      expect(adminSection).toHaveAttribute('aria-current', 'page')
    })

    it('navigates to session-console when chat section is clicked', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      fireEvent.click(screen.getByTestId('product-nav-chat'))
      expect(mockOnTabChange).toHaveBeenCalledWith('session-console')
    })

    it('navigates to dashboard when workspace section is clicked', () => {
      renderWithRouter(
        <AgentShell activeTab="session-console" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      fireEvent.click(screen.getByTestId('product-nav-workspace'))
      expect(mockOnTabChange).toHaveBeenCalledWith('dashboard')
    })

    it('navigates to agent-monitor when operations section is clicked', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      fireEvent.click(screen.getByTestId('product-nav-operations'))
      expect(mockOnTabChange).toHaveBeenCalledWith('agent-monitor')
    })

    it('navigates to settings when admin section is clicked', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      fireEvent.click(screen.getByTestId('product-nav-admin'))
      expect(mockOnTabChange).toHaveBeenCalledWith('settings')
    })
  })

  // =============================================================================
  // Agent Shell Structure Tests
  // =============================================================================

  describe('Agent Shell Structure', () => {
    it('has data-testid="agent-shell" on root container', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      expect(screen.getByTestId('agent-shell')).toBeInTheDocument()
    })

    it('has data-testid="app-shell" on inner wrapper for backward compatibility', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      expect(screen.getByTestId('app-shell')).toBeInTheDocument()
    })

    it('has data-testid="center-stage" on main content area', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      expect(screen.getByTestId('center-stage')).toBeInTheDocument()
    })

    it('adds chat overflow guard class on the center-stage for chat tabs only', () => {
      const { rerender } = renderWithRouter(
        <AgentShell activeTab="session-console" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      expect(screen.getByTestId('center-stage')).toHaveClass('shell__content--chat')

      rerender(
        <BrowserRouter>
          <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
            <div>Content</div>
          </AgentShell>
        </BrowserRouter>,
      )

      expect(screen.getByTestId('center-stage')).not.toHaveClass('shell__content--chat')
    })

    it('renders children in center-stage area', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div data-testid="child-content">Test Content</div>
        </AgentShell>,
      )

      expect(screen.getByTestId('child-content')).toBeInTheDocument()
    })
  })

  // =============================================================================
  // Preserved AppShell Functionality Tests
  // =============================================================================

  describe('Preserved AppShell Functionality', () => {
    it('has data-testid="sidebar" on sidebar element', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    })

    it('has data-testid="topbar" showing breadcrumb', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      expect(screen.getByTestId('topbar')).toBeInTheDocument()
    })

    it('displays logout button when user is provided and onLogout is available', () => {
      renderWithRouter(
        <AgentShell
          activeTab="dashboard"
          onTabChange={mockOnTabChange}
          user={{ userId: 'user-1', username: 'testuser' }}
          onLogout={mockOnLogout}
        >
          <div>Content</div>
        </AgentShell>,
      )

      expect(screen.getByTestId('logout-button')).toBeInTheDocument()
      expect(screen.getByTestId('username-display')).toHaveTextContent('testuser')
    })

    it('calls onLogout when logout button is clicked', () => {
      renderWithRouter(
        <AgentShell
          activeTab="dashboard"
          onTabChange={mockOnTabChange}
          user={{ userId: 'user-1', username: 'testuser' }}
          onLogout={mockOnLogout}
        >
          <div>Content</div>
        </AgentShell>,
      )

      fireEvent.click(screen.getByTestId('logout-button'))
      expect(mockOnLogout).toHaveBeenCalledTimes(1)
    })

    it('has sidebar collapse toggle', () => {
      renderWithRouter(
        <AgentShell
          activeTab="dashboard"
          onTabChange={mockOnTabChange}
          onToggleNavCollapsed={mockOnToggleNavCollapsed}
          isNavCollapsed={false}
        >
          <div>Content</div>
        </AgentShell>,
      )

      const toggle = screen.getByTestId('sidebar-collapse-toggle')
      expect(toggle).toBeInTheDocument()
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
    })

    it('calls onToggleNavCollapsed when sidebar collapse toggle is clicked', () => {
      renderWithRouter(
        <AgentShell
          activeTab="dashboard"
          onTabChange={mockOnTabChange}
          onToggleNavCollapsed={mockOnToggleNavCollapsed}
          isNavCollapsed={false}
        >
          <div>Content</div>
        </AgentShell>,
      )

      fireEvent.click(screen.getByTestId('sidebar-collapse-toggle'))
      expect(mockOnToggleNavCollapsed).toHaveBeenCalledTimes(1)
    })

    it('has mobile nav toggle', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      const toggle = screen.getByTestId('mobile-nav-toggle')
      expect(toggle).toBeInTheDocument()
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    })

    it('renders navigation tabs in sidebar', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      // TabNav is rendered inside sidebar with section-scoped tabs
      // When activeTab is dashboard (workspace section), only workspace tabs are shown
      expect(screen.getByTestId('tab-dashboard')).toBeInTheDocument()
      expect(screen.getByTestId('tab-sessions')).toBeInTheDocument()
      // session-console is in chat section, not visible when workspace is active
      expect(screen.queryByTestId('tab-session-console')).not.toBeInTheDocument()
    })

    it('switches active tab on click', async () => {
      const MockAgentShell = () => {
        const [activeTab, setActiveTab] = React.useState<TabId>('dashboard')
        return (
          <BrowserRouter>
            <AgentShell activeTab={activeTab} onTabChange={setActiveTab}>
              <div>Content</div>
            </AgentShell>
          </BrowserRouter>
        )
      }
      render(<MockAgentShell />)

      // When dashboard is active (workspace section), only workspace tabs are visible
      const sessionsTab = screen.getByTestId('tab-sessions')
      fireEvent.click(sessionsTab)

      expect(screen.getByTestId('tab-sessions')).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByTestId('tab-dashboard')).toHaveAttribute('aria-selected', 'false')
    })
  })

  // =============================================================================
  // Context Desk Tests (Task 7)
  // =============================================================================

  describe('Context Desk Integration', () => {
    it('has context desk toggle button', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      const toggle = screen.getByTestId('context-desk-toggle')
      expect(toggle).toBeInTheDocument()
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    })

    it('opens context desk panel when toggle is clicked', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      const toggle = screen.getByTestId('context-desk-toggle')
      fireEvent.click(toggle)

      expect(screen.getByTestId('context-desk-panel')).toBeInTheDocument()
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
    })

    it('has close button inside context desk panel', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      fireEvent.click(screen.getByTestId('context-desk-toggle'))
      expect(screen.getByTestId('context-desk-close')).toBeInTheDocument()
    })

    it('closes context desk when close button is clicked', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      const toggle = screen.getByTestId('context-desk-toggle')
      fireEvent.click(toggle)
      expect(screen.getByTestId('context-desk-panel')).toBeInTheDocument()

      const closeButton = screen.getByTestId('context-desk-close')
      fireEvent.click(closeButton)

      expect(screen.queryByTestId('context-desk-panel')).not.toBeInTheDocument()
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    })

    it('toggles context desk open and closed', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      const toggle = screen.getByTestId('context-desk-toggle')

      fireEvent.click(toggle)
      expect(screen.getByTestId('context-desk-panel')).toBeInTheDocument()
      expect(toggle).toHaveAttribute('aria-expanded', 'true')

      fireEvent.click(toggle)
      expect(screen.queryByTestId('context-desk-panel')).not.toBeInTheDocument()
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    })

    it('renders ContextDeskPanel with default loading states when no cards provided', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      fireEvent.click(screen.getByTestId('context-desk-toggle'))
      expect(screen.getByTestId('context-desk-panel')).toBeInTheDocument()
    })

    it('renders ContextDeskPanel with provided card states', () => {
      const contextDeskCards = {
        approvalState: ready({ approvals: [], totalCount: 0, sessionScope: 'none' }),
        memoryState: ready({ memories: [], totalCount: 0 }),
        runsState: ready({ runs: [], totalCount: 0, sessionScope: 'none', streaming: false }),
        toolActivityState: ready({ events: [], totalCount: 0, sessionId: 'test-session', streaming: false }),
      }

      renderWithRouter(
        <AgentShell
          activeTab="dashboard"
          onTabChange={mockOnTabChange}
          contextDeskCards={contextDeskCards}
          sessionId="test-session"
        >
          <div>Content</div>
        </AgentShell>,
      )

      fireEvent.click(screen.getByTestId('context-desk-toggle'))
      expect(screen.getByTestId('context-desk-panel')).toBeInTheDocument()
      expect(screen.getByTestId('context-card-approvals')).toBeInTheDocument()
      expect(screen.getByTestId('context-card-memory')).toBeInTheDocument()
      expect(screen.getByTestId('context-card-runs')).toBeInTheDocument()
      expect(screen.getByTestId('context-card-tools')).toBeInTheDocument()
    })

    it('passes sessionId to ContextDeskPanel', () => {
      const contextDeskCards = {
        approvalState: loading(),
        memoryState: loading(),
        runsState: loading(),
        toolActivityState: loading(),
      }

      renderWithRouter(
        <AgentShell
          activeTab="session-console"
          onTabChange={mockOnTabChange}
          contextDeskCards={contextDeskCards}
          sessionId="session-123"
        >
          <div>Content</div>
        </AgentShell>,
      )

      fireEvent.click(screen.getByTestId('context-desk-toggle'))
      expect(screen.getByTestId('context-desk-panel')).toBeInTheDocument()
    })

    it('handles missing sessionId gracefully', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      fireEvent.click(screen.getByTestId('context-desk-toggle'))
      expect(screen.getByTestId('context-desk-panel')).toBeInTheDocument()
    })

    it('preserves existing shell selectors when context desk is open', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      fireEvent.click(screen.getByTestId('context-desk-toggle'))

      expect(screen.getByTestId('agent-shell')).toBeInTheDocument()
      expect(screen.getByTestId('app-shell')).toBeInTheDocument()
      expect(screen.getByTestId('center-stage')).toBeInTheDocument()
      expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    })

    it('does not break non-Chat pages when context desk is opened', () => {
      const contextDeskCards = {
        approvalState: empty('No approval requests', 'Approvals will appear here when tools require permission'),
        memoryState: empty('No memory entries', 'Memory will be populated as sessions progress'),
        runsState: empty('No runs', 'Background runs will appear here'),
        toolActivityState: error('Session context unavailable'),
      }

      renderWithRouter(
        <AgentShell activeTab="settings" onTabChange={mockOnTabChange} contextDeskCards={contextDeskCards}>
          <div>Settings Content</div>
        </AgentShell>,
      )

      fireEvent.click(screen.getByTestId('context-desk-toggle'))
      expect(screen.getByTestId('context-desk-panel')).toBeInTheDocument()
      expect(screen.getByText('Settings Content')).toBeInTheDocument()
    })
  })

  // =============================================================================
  // Primary Menu and Secondary Navigation Tests (Task 6 - Failing Tests)
  // =============================================================================

  describe('Primary Menu Structure', () => {
    it('product-nav is the primary top-level navigation', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      const productNav = screen.getByTestId('product-nav')
      expect(productNav).toBeInTheDocument()
      expect(productNav).toHaveAttribute('role', 'navigation')
      expect(productNav).toHaveAttribute('aria-label', 'Product sections')
    })

    it('product-nav contains exactly 4 sections in correct order', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      const productNav = screen.getByTestId('product-nav')
      const buttons = productNav.querySelectorAll('button')

      expect(buttons).toHaveLength(4)
      expect(buttons[0]).toHaveAttribute('data-testid', 'product-nav-chat')
      expect(buttons[1]).toHaveAttribute('data-testid', 'product-nav-workspace')
      expect(buttons[2]).toHaveAttribute('data-testid', 'product-nav-operations')
      expect(buttons[3]).toHaveAttribute('data-testid', 'product-nav-admin')
    })

    it('product-nav is rendered outside sidebar', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      const productNav = screen.getByTestId('product-nav')
      const sidebar = screen.getByTestId('sidebar')

      expect(productNav).not.toContainElement(sidebar)
      expect(sidebar).not.toContainElement(productNav)
    })
  })

  describe('Secondary Navigation Scope', () => {
    it('sidebar shows only chat tabs when chat section is active', () => {
      renderWithRouter(
        <AgentShell activeTab="session-console" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      const sidebar = screen.getByTestId('sidebar')

      expect(screen.getByTestId('tab-session-console')).toBeInTheDocument()

      expect(sidebar).not.toContainElement(screen.queryByTestId('tab-dashboard'))
      expect(sidebar).not.toContainElement(screen.queryByTestId('tab-agent-monitor'))
      expect(sidebar).not.toContainElement(screen.queryByTestId('tab-settings'))
    })

    it('sidebar shows only workspace tabs when workspace section is active', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      const sidebar = screen.getByTestId('sidebar')

      expect(screen.getByTestId('tab-dashboard')).toBeInTheDocument()
      expect(screen.getByTestId('tab-sessions')).toBeInTheDocument()
      expect(screen.getByTestId('tab-workflows')).toBeInTheDocument()

      expect(sidebar).not.toContainElement(screen.queryByTestId('tab-session-console'))
      expect(sidebar).not.toContainElement(screen.queryByTestId('tab-agent-monitor'))
      expect(sidebar).not.toContainElement(screen.queryByTestId('tab-settings'))
    })

    it('sidebar shows only operations tabs when operations section is active', () => {
      renderWithRouter(
        <AgentShell activeTab="agent-monitor" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      const sidebar = screen.getByTestId('sidebar')

      expect(screen.getByTestId('tab-agent-monitor')).toBeInTheDocument()
      expect(screen.getByTestId('tab-skills')).toBeInTheDocument()
      expect(screen.getByTestId('tab-connectors')).toBeInTheDocument()

      expect(sidebar).not.toContainElement(screen.queryByTestId('tab-dashboard'))
      expect(sidebar).not.toContainElement(screen.queryByTestId('tab-session-console'))
      expect(sidebar).not.toContainElement(screen.queryByTestId('tab-settings'))
    })

    it('sidebar shows only admin tabs when admin section is active', () => {
      renderWithRouter(
        <AgentShell activeTab="settings" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      const sidebar = screen.getByTestId('sidebar')

      expect(screen.getByTestId('tab-settings')).toBeInTheDocument()
      expect(screen.getByTestId('tab-admin')).toBeInTheDocument()

      expect(sidebar).not.toContainElement(screen.queryByTestId('tab-dashboard'))
      expect(sidebar).not.toContainElement(screen.queryByTestId('tab-agent-monitor'))
      expect(sidebar).not.toContainElement(screen.queryByTestId('tab-session-console'))
    })

    it('sidebar tab count matches active section tab count', () => {
      const { rerender } = renderWithRouter(
        <AgentShell activeTab="session-console" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      expect(screen.getAllByRole('tab')).toHaveLength(1)

      rerender(
        <BrowserRouter>
          <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
            <div>Content</div>
          </AgentShell>
        </BrowserRouter>,
      )

      expect(screen.getAllByRole('tab')).toHaveLength(12)
    })

    it('sidebar updates tabs when product section changes', async () => {
      const MockAgentShell = () => {
        const [activeTab, setActiveTab] = React.useState<TabId>('dashboard')
        return (
          <BrowserRouter>
            <AgentShell activeTab={activeTab} onTabChange={setActiveTab}>
              <div>Content</div>
            </AgentShell>
          </BrowserRouter>
        )
      }
      render(<MockAgentShell />)

      expect(screen.getByTestId('tab-dashboard')).toBeInTheDocument()
      expect(screen.queryByTestId('tab-agent-monitor')).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('product-nav-operations'))

      await vi.waitFor(() => {
        expect(screen.getByTestId('tab-agent-monitor')).toBeInTheDocument()
        expect(screen.queryByTestId('tab-dashboard')).not.toBeInTheDocument()
      })
    })
  })

  describe('Navigation Hierarchy', () => {
    it('product nav click updates sidebar content', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      expect(screen.getByTestId('tab-dashboard')).toBeInTheDocument()
      expect(screen.queryByTestId('tab-agent-monitor')).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('product-nav-operations'))
      expect(mockOnTabChange).toHaveBeenCalledWith('agent-monitor')
    })

    it('sidebar tab click does not change product nav active state', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      const workspaceButton = screen.getByTestId('product-nav-workspace')
      expect(workspaceButton).toHaveAttribute('aria-current', 'page')

      fireEvent.click(screen.getByTestId('tab-sessions'))

      expect(workspaceButton).toHaveAttribute('aria-current', 'page')
    })

    it('product nav sections are top-level, sidebar tabs are secondary', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>,
      )

      const productNav = screen.getByTestId('product-nav')
      const sidebar = screen.getByTestId('sidebar')

      const productNavButtons = productNav.querySelectorAll('button.product-nav__item')
      expect(productNavButtons).toHaveLength(4)

      const sidebarTabs = sidebar.querySelectorAll('button[role="tab"]')
      expect(sidebarTabs.length).toBeGreaterThan(4)
      expect(sidebarTabs.length).toBe(12)
    })
  })
})
