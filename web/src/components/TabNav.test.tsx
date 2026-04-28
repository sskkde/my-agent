import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TabNav from './TabNav';

describe('TabNav', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  it('renders four tab buttons', () => {
    render(<TabNav activeTab="dashboard" onTabChange={mockOnChange} />);
    expect(screen.getByTestId('tab-dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('tab-session-console')).toBeInTheDocument();
    expect(screen.getByTestId('tab-agent-monitor')).toBeInTheDocument();
    expect(screen.getByTestId('tab-status')).toBeInTheDocument();
  });

  it('displays correct Chinese labels', () => {
    render(<TabNav activeTab="dashboard" onTabChange={mockOnChange} />);
    expect(screen.getByText('概览')).toBeInTheDocument();
    expect(screen.getByText('会话')).toBeInTheDocument();
    expect(screen.getByText('监控')).toBeInTheDocument();
    expect(screen.getByText('状态')).toBeInTheDocument();
  });

  it('marks active tab with aria-selected true', () => {
    render(<TabNav activeTab="session-console" onTabChange={mockOnChange} />);
    expect(screen.getByTestId('tab-session-console')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('tab-dashboard')).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onTabChange when tab is clicked', () => {
    render(<TabNav activeTab="dashboard" onTabChange={mockOnChange} />);
    fireEvent.click(screen.getByTestId('tab-status'));
    expect(mockOnChange).toHaveBeenCalledWith('status');
  });

  it('supports keyboard navigation with Enter key', () => {
    render(<TabNav activeTab="dashboard" onTabChange={mockOnChange} />);
    const tab = screen.getByTestId('tab-agent-monitor');
    fireEvent.keyDown(tab, { key: 'Enter', code: 'Enter' });
    expect(mockOnChange).toHaveBeenCalledWith('agent-monitor');
  });

  it('supports keyboard navigation with Space key', () => {
    render(<TabNav activeTab="dashboard" onTabChange={mockOnChange} />);
    const tab = screen.getByTestId('tab-session-console');
    fireEvent.keyDown(tab, { key: ' ', code: 'Space' });
    expect(mockOnChange).toHaveBeenCalledWith('session-console');
  });
});