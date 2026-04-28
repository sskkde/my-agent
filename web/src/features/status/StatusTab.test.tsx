import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import StatusTab from './StatusTab';
import * as client from '../../api/client';

vi.mock('../../api/client');

describe('StatusTab', () => {
  const mockOnTabChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders status panel with platform introduction', async () => {
    vi.mocked(client.getHealth).mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      modules: { api: { status: 'healthy' } },
    });
    vi.mocked(client.getApprovals).mockResolvedValue({
      approvals: [],
      total: 0,
    });

    render(<StatusTab onTabChange={mockOnTabChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('status-panel')).toBeInTheDocument();
    });
  });

  it('shows health summary', async () => {
    vi.mocked(client.getHealth).mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      modules: {
        api: { status: 'healthy' },
        database: { status: 'healthy' },
      },
    });
    vi.mocked(client.getApprovals).mockResolvedValue({
      approvals: [],
      total: 0,
    });

    render(<StatusTab onTabChange={mockOnTabChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('status-health-summary')).toBeInTheDocument();
    });
  });

  it('shows pending approvals count', async () => {
    vi.mocked(client.getHealth).mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      modules: { api: { status: 'healthy' } },
    });
    vi.mocked(client.getApprovals).mockResolvedValue({
      approvals: [
        { id: '1', userId: 'user1', sessionId: 's1', status: 'pending', actionType: 'test', requestedBy: 'user1', requestedAt: new Date().toISOString() },
        { id: '2', userId: 'user2', sessionId: 's2', status: 'pending', actionType: 'test2', requestedBy: 'user2', requestedAt: new Date().toISOString() },
      ],
      total: 2,
    });

    render(<StatusTab onTabChange={mockOnTabChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('approvals-summary')).toBeInTheDocument();
    });
  });

  it('shows empty approval state', async () => {
    vi.mocked(client.getHealth).mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      modules: { api: { status: 'healthy' } },
    });
    vi.mocked(client.getApprovals).mockResolvedValue({
      approvals: [],
      total: 0,
    });

    render(<StatusTab onTabChange={mockOnTabChange} />);

    await waitFor(() => {
      expect(screen.getByText(/暂无待审批项/)).toBeInTheDocument();
    });
  });

  it('quick action button switches to session console', async () => {
    vi.mocked(client.getHealth).mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      modules: { api: { status: 'healthy' } },
    });
    vi.mocked(client.getApprovals).mockResolvedValue({
      approvals: [],
      total: 0,
    });

    render(<StatusTab onTabChange={mockOnTabChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('status-open-session')).toBeInTheDocument();
    });

    screen.getByTestId('status-open-session').click();
    expect(mockOnTabChange).toHaveBeenCalledWith('session-console');
  });

  it('quick action button switches to agent monitor', async () => {
    vi.mocked(client.getHealth).mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      modules: { api: { status: 'healthy' } },
    });
    vi.mocked(client.getApprovals).mockResolvedValue({
      approvals: [],
      total: 0,
    });

    render(<StatusTab onTabChange={mockOnTabChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('status-open-monitor')).toBeInTheDocument();
    });

    screen.getByTestId('status-open-monitor').click();
    expect(mockOnTabChange).toHaveBeenCalledWith('agent-monitor');
  });

  it('handles API error for approvals without hiding health summary', async () => {
    vi.mocked(client.getHealth).mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      modules: { api: { status: 'healthy' } },
    });
    vi.mocked(client.getApprovals).mockRejectedValue(new Error('API error'));

    render(<StatusTab onTabChange={mockOnTabChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('status-health-summary')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText(/暂无待审批项/)).toBeInTheDocument();
    });
  });
});