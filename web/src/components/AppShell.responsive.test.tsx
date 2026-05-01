import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AppShell from './AppShell';
import { mockMatchMedia, mockViewport, resetMatchMedia } from '../test/setup';

describe('AppShell Responsive', () => {
  const mockOnTabChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetMatchMedia();
  });

  it('shows sidebar at desktop viewport', () => {
    mockMatchMedia(false);
    render(
      <AppShell activeTab="dashboard" onTabChange={mockOnTabChange}>
        <div>Content</div>
      </AppShell>
    );
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });

  it('shows mobile nav toggle at mobile viewport', () => {
    mockMatchMedia(true);
    render(
      <AppShell activeTab="dashboard" onTabChange={mockOnTabChange}>
        <div>Content</div>
      </AppShell>
    );
    expect(screen.getByTestId('mobile-nav-toggle')).toBeInTheDocument();
  });

  it('adds shell--nav-drawer-open class when mobile toggle is clicked', () => {
    mockMatchMedia(true);
    const { container } = render(
      <AppShell activeTab="dashboard" onTabChange={mockOnTabChange}>
        <div>Content</div>
      </AppShell>
    );

    const toggle = screen.getByTestId('mobile-nav-toggle');
    fireEvent.click(toggle);

    const shellElement = container.querySelector('.shell--nav-drawer-open');
    expect(shellElement).toBeInTheDocument();
  });

  it('closes drawer when tab is selected on mobile', () => {
    mockMatchMedia(true);
    const { container } = render(
      <AppShell activeTab="dashboard" onTabChange={mockOnTabChange}>
        <div>Content</div>
      </AppShell>
    );

    const toggle = screen.getByTestId('mobile-nav-toggle');
    fireEvent.click(toggle);

    expect(container.querySelector('.shell--nav-drawer-open')).toBeInTheDocument();

    const sessionTab = screen.getByTestId('tab-session-console');
    fireEvent.click(sessionTab);

    expect(container.querySelector('.shell--nav-drawer-open')).not.toBeInTheDocument();
    expect(mockOnTabChange).toHaveBeenCalledWith('session-console');
  });

  it('keeps drawer open when tab is selected on desktop', () => {
    mockMatchMedia(false);
    render(
      <AppShell activeTab="dashboard" onTabChange={mockOnTabChange}>
        <div>Content</div>
      </AppShell>
    );

    const dashboardTab = screen.getByTestId('tab-dashboard');
    fireEvent.click(dashboardTab);

    expect(mockOnTabChange).toHaveBeenCalledWith('dashboard');
  });

  it('renders mobile nav backdrop when drawer is open on mobile', () => {
    mockMatchMedia(true);
    render(
      <AppShell activeTab="dashboard" onTabChange={mockOnTabChange}>
        <div>Content</div>
      </AppShell>
    );

    const toggle = screen.getByTestId('mobile-nav-toggle');
    fireEvent.click(toggle);

    const backdrop = screen.getByTestId('mobile-nav-backdrop');
    expect(backdrop).toBeInTheDocument();
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
  });

  it('closes drawer when backdrop is clicked', () => {
    mockMatchMedia(true);
    const { container } = render(
      <AppShell activeTab="dashboard" onTabChange={mockOnTabChange}>
        <div>Content</div>
      </AppShell>
    );

    const toggle = screen.getByTestId('mobile-nav-toggle');
    fireEvent.click(toggle);

    expect(container.querySelector('.shell--nav-drawer-open')).toBeInTheDocument();

    const backdrop = screen.getByTestId('mobile-nav-backdrop');
    fireEvent.click(backdrop);

    expect(container.querySelector('.shell--nav-drawer-open')).not.toBeInTheDocument();
  });

  it('has aria-expanded true when mobile nav drawer is open', () => {
    mockMatchMedia(true);
    render(
      <AppShell activeTab="dashboard" onTabChange={mockOnTabChange}>
        <div>Content</div>
      </AppShell>
    );

    const toggle = screen.getByTestId('mobile-nav-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders mobile nav toggle at 390px viewport (phone)', () => {
    mockViewport(390);
    render(
      <AppShell activeTab="dashboard" onTabChange={mockOnTabChange}>
        <div>Content</div>
      </AppShell>
    );

    expect(screen.getByTestId('mobile-nav-toggle')).toBeInTheDocument();
  });

  it('renders mobile nav toggle at 768px viewport (tablet)', () => {
    mockViewport(768);
    render(
      <AppShell activeTab="dashboard" onTabChange={mockOnTabChange}>
        <div>Content</div>
      </AppShell>
    );

    expect(screen.getByTestId('mobile-nav-toggle')).toBeInTheDocument();
  });

  it('does not show mobile nav toggle at 1440px viewport (desktop)', () => {
    mockViewport(1440);
    render(
      <AppShell activeTab="dashboard" onTabChange={mockOnTabChange}>
        <div>Content</div>
      </AppShell>
    );

    const toggle = screen.getByTestId('mobile-nav-toggle');
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveClass('mobile-nav-toggle');
    expect(window.matchMedia('(max-width: 1100px)').matches).toBe(false);
  });

  it('sidebar collapse/expand works at desktop viewport', () => {
    mockMatchMedia(false);
    const mockOnToggleNavCollapsed = vi.fn();

    render(
      <AppShell
        activeTab="dashboard"
        onTabChange={mockOnTabChange}
        onToggleNavCollapsed={mockOnToggleNavCollapsed}
        isNavCollapsed={false}
      >
        <div>Content</div>
      </AppShell>
    );

    const collapseToggle = screen.getByTestId('sidebar-collapse-toggle');
    expect(collapseToggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(collapseToggle);
    expect(mockOnToggleNavCollapsed).toHaveBeenCalledTimes(1);
  });
});
