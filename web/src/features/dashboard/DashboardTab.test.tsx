import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DashboardTab from './DashboardTab';
import * as client from '../../api/client';

vi.mock('../../api/client', () => ({
  getHealth: vi.fn(),
  getRuns: vi.fn(),
}));

describe('DashboardTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays health status with data-testid', async () => {
    (client.getHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      modules: { kernel: { status: 'healthy' }, gateway: { status: 'healthy' } },
    });
    (client.getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({ runs: [], total: 0 });

    render(<DashboardTab />);

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-health-status')).toBeInTheDocument();
    });
  });

  it('displays healthy status correctly', async () => {
    (client.getHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      modules: { kernel: { status: 'healthy' }, gateway: { status: 'healthy' } },
    });
    (client.getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({ runs: [], total: 0 });

    render(<DashboardTab />);

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-health-status')).toHaveTextContent('健康');
    });
  });

  it('displays degraded status correctly', async () => {
    (client.getHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      modules: {
        kernel: { status: 'healthy' },
        gateway: { status: 'degraded', message: 'High latency' },
      },
    });
    (client.getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({ runs: [], total: 0 });

    render(<DashboardTab />);

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-health-status')).toHaveTextContent('降级');
    });
  });

  it('displays module chips with data-testid', async () => {
    (client.getHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      modules: {
        kernel: { status: 'healthy' },
        gateway: { status: 'healthy' },
        planner: { status: 'degraded' },
      },
    });
    (client.getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({ runs: [], total: 0 });

    render(<DashboardTab />);

    await waitFor(() => {
      const modules = screen.getByTestId('dashboard-modules');
      expect(modules).toBeInTheDocument();
      expect(modules).toHaveTextContent('kernel');
      expect(modules).toHaveTextContent('gateway');
      expect(modules).toHaveTextContent('planner');
    });
  });

  it('displays active run count with data-testid', async () => {
    (client.getHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      modules: { kernel: { status: 'healthy' } },
    });
    (client.getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({
      runs: [
        { runId: '1', status: 'running', createdAt: new Date().toISOString() },
        { runId: '2', status: 'running', createdAt: new Date().toISOString() },
        { runId: '3', status: 'completed', createdAt: new Date().toISOString() },
      ],
      total: 3,
    });

    render(<DashboardTab />);

    await waitFor(() => {
      const runsCount = screen.getByTestId('dashboard-runs-count');
      expect(runsCount).toHaveTextContent('2');
    });
  });

  it('shows empty state when no runs', async () => {
    (client.getHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      modules: { kernel: { status: 'healthy' } },
    });
    (client.getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({ runs: [], total: 0 });

    render(<DashboardTab />);

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-empty-state')).toBeInTheDocument();
    });
  });

  it('handles API failure gracefully', async () => {
    (client.getHealth as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));
    (client.getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({ runs: [], total: 0 });

    render(<DashboardTab />);

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-health-status')).toHaveTextContent('异常');
    });
  });
});