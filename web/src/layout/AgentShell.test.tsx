import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import AgentShell from './AgentShell';
import type { TabId } from '../components/TabNav';

const renderWithRouter = (ui: React.ReactElement) => {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
};

describe('AgentShell', () => {
  const mockOnTabChange = vi.fn();
  const mockOnToggleNavCollapsed = vi.fn();
  const mockOnLogout = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =============================================================================
  // Product Navigation Tests (Round 1)
  // =============================================================================

  describe('Product Navigation', () => {
    it('renders all four product navigation sections', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>
      );

      expect(screen.getByTestId('product-nav')).toBeInTheDocument();
      expect(screen.getByTestId('product-nav-chat')).toBeInTheDocument();
      expect(screen.getByTestId('product-nav-workspace')).toBeInTheDocument();
      expect(screen.getByTestId('product-nav-operations')).toBeInTheDocument();
      expect(screen.getByTestId('product-nav-admin')).toBeInTheDocument();
    });

    it('displays product section labels', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>
      );

      // Product section labels (English) - check they are in product nav buttons
      const productNav = screen.getByTestId('product-nav');
      expect(productNav).toHaveTextContent('Chat');
      expect(productNav).toHaveTextContent('Workspace');
      expect(productNav).toHaveTextContent('Operations');
      expect(productNav).toHaveTextContent('Admin');
    });

    it('marks active product section with aria-current="page"', () => {
      renderWithRouter(
        <AgentShell activeTab="session-console" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>
      );

      // session-console is in 'chat' section
      const chatSection = screen.getByTestId('product-nav-chat');
      expect(chatSection).toHaveAttribute('aria-current', 'page');

      // Other sections should not be marked as current
      expect(screen.getByTestId('product-nav-workspace')).not.toHaveAttribute('aria-current');
      expect(screen.getByTestId('product-nav-operations')).not.toHaveAttribute('aria-current');
      expect(screen.getByTestId('product-nav-admin')).not.toHaveAttribute('aria-current');
    });

    it('marks workspace section as active when on dashboard tab', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>
      );

      const workspaceSection = screen.getByTestId('product-nav-workspace');
      expect(workspaceSection).toHaveAttribute('aria-current', 'page');
    });

    it('marks operations section as active when on agent-monitor tab', () => {
      renderWithRouter(
        <AgentShell activeTab="agent-monitor" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>
      );

      const operationsSection = screen.getByTestId('product-nav-operations');
      expect(operationsSection).toHaveAttribute('aria-current', 'page');
    });

    it('marks admin section as active when on settings tab', () => {
      renderWithRouter(
        <AgentShell activeTab="settings" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>
      );

      const adminSection = screen.getByTestId('product-nav-admin');
      expect(adminSection).toHaveAttribute('aria-current', 'page');
    });

    it('navigates to session-console when chat section is clicked', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>
      );

      fireEvent.click(screen.getByTestId('product-nav-chat'));
      expect(mockOnTabChange).toHaveBeenCalledWith('session-console');
    });

    it('navigates to dashboard when workspace section is clicked', () => {
      renderWithRouter(
        <AgentShell activeTab="session-console" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>
      );

      fireEvent.click(screen.getByTestId('product-nav-workspace'));
      expect(mockOnTabChange).toHaveBeenCalledWith('dashboard');
    });

    it('navigates to agent-monitor when operations section is clicked', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>
      );

      fireEvent.click(screen.getByTestId('product-nav-operations'));
      expect(mockOnTabChange).toHaveBeenCalledWith('agent-monitor');
    });

    it('navigates to settings when admin section is clicked', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>
      );

      fireEvent.click(screen.getByTestId('product-nav-admin'));
      expect(mockOnTabChange).toHaveBeenCalledWith('settings');
    });
  });

  // =============================================================================
  // Agent Shell Structure Tests
  // =============================================================================

  describe('Agent Shell Structure', () => {
    it('has data-testid="agent-shell" on root container', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>
      );

      expect(screen.getByTestId('agent-shell')).toBeInTheDocument();
    });

    it('has data-testid="app-shell" on inner wrapper for backward compatibility', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>
      );

      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    });

    it('has data-testid="center-stage" on main content area', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>
      );

      expect(screen.getByTestId('center-stage')).toBeInTheDocument();
    });

    it('renders children in center-stage area', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div data-testid="child-content">Test Content</div>
        </AgentShell>
      );

      expect(screen.getByTestId('child-content')).toBeInTheDocument();
    });
  });

  // =============================================================================
  // Preserved AppShell Functionality Tests
  // =============================================================================

  describe('Preserved AppShell Functionality', () => {
    it('has data-testid="sidebar" on sidebar element', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>
      );

      expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    });

    it('has data-testid="topbar" showing breadcrumb', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>
      );

      expect(screen.getByTestId('topbar')).toBeInTheDocument();
    });

    it('displays logout button when user is provided and onLogout is available', () => {
      renderWithRouter(
        <AgentShell
          activeTab="dashboard"
          onTabChange={mockOnTabChange}
          user={{ userId: 'user-1', username: 'testuser' }}
          onLogout={mockOnLogout}
        >
          <div>Content</div>
        </AgentShell>
      );

      expect(screen.getByTestId('logout-button')).toBeInTheDocument();
      expect(screen.getByTestId('username-display')).toHaveTextContent('testuser');
    });

    it('calls onLogout when logout button is clicked', () => {
      renderWithRouter(
        <AgentShell
          activeTab="dashboard"
          onTabChange={mockOnTabChange}
          user={{ userId: 'user-1', username: 'testuser' }}
          onLogout={mockOnLogout}
        >
          <div>Content</div>
        </AgentShell>
      );

      fireEvent.click(screen.getByTestId('logout-button'));
      expect(mockOnLogout).toHaveBeenCalledTimes(1);
    });

    it('has sidebar collapse toggle', () => {
      renderWithRouter(
        <AgentShell
          activeTab="dashboard"
          onTabChange={mockOnTabChange}
          onToggleNavCollapsed={mockOnToggleNavCollapsed}
          isNavCollapsed={false}
        >
          <div>Content</div>
        </AgentShell>
      );

      const toggle = screen.getByTestId('sidebar-collapse-toggle');
      expect(toggle).toBeInTheDocument();
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });

    it('calls onToggleNavCollapsed when sidebar collapse toggle is clicked', () => {
      renderWithRouter(
        <AgentShell
          activeTab="dashboard"
          onTabChange={mockOnTabChange}
          onToggleNavCollapsed={mockOnToggleNavCollapsed}
          isNavCollapsed={false}
        >
          <div>Content</div>
        </AgentShell>
      );

      fireEvent.click(screen.getByTestId('sidebar-collapse-toggle'));
      expect(mockOnToggleNavCollapsed).toHaveBeenCalledTimes(1);
    });

    it('has mobile nav toggle', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>
      );

      const toggle = screen.getByTestId('mobile-nav-toggle');
      expect(toggle).toBeInTheDocument();
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('renders navigation tabs in sidebar', () => {
      renderWithRouter(
        <AgentShell activeTab="dashboard" onTabChange={mockOnTabChange}>
          <div>Content</div>
        </AgentShell>
      );

      // TabNav is rendered inside sidebar
      expect(screen.getByTestId('tab-dashboard')).toBeInTheDocument();
      expect(screen.getByTestId('tab-session-console')).toBeInTheDocument();
    });

    it('switches active tab on click', async () => {
      const MockAgentShell = () => {
        const [activeTab, setActiveTab] = React.useState<TabId>('dashboard');
        return (
          <BrowserRouter>
            <AgentShell activeTab={activeTab} onTabChange={setActiveTab}>
              <div>Content</div>
            </AgentShell>
          </BrowserRouter>
        );
      };
      render(<MockAgentShell />);

      const sessionTab = screen.getByTestId('tab-session-console');
      fireEvent.click(sessionTab);

      expect(screen.getByTestId('tab-session-console')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('tab-dashboard')).toHaveAttribute('aria-selected', 'false');
    });
  });
});
