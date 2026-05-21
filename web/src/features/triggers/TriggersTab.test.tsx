import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TriggersTab from './TriggersTab';
import * as triggersApi from '../../api/triggers';

vi.mock('../../api/triggers');

describe('TriggersTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', () => {
    vi.mocked(triggersApi.getTriggers).mockImplementation(() => new Promise(() => {}));
    render(<TriggersTab />);
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('renders schedule triggers list from mock API', async () => {
    vi.mocked(triggersApi.getTriggers).mockResolvedValue([
      {
        triggerId: 'schedule-1',
        name: 'Daily Report',
        triggerType: 'schedule',
        status: 'active',
        cronExpression: '0 9 * * *',
        createdAt: '2024-01-01T10:00:00Z',
      },
      {
        triggerId: 'schedule-2',
        name: 'Weekly Cleanup',
        triggerType: 'schedule',
        status: 'paused',
        cronExpression: '0 0 * * 0',
        createdAt: '2024-01-02T10:00:00Z',
      },
    ]);

    render(<TriggersTab />);

    await waitFor(() => {
      expect(screen.getByTestId('triggers-panel')).toBeInTheDocument();
    });

    expect(screen.getByTestId('trigger-item-schedule-1')).toBeInTheDocument();
    expect(screen.getByTestId('trigger-item-schedule-2')).toBeInTheDocument();
    expect(screen.getByText('Daily Report')).toBeInTheDocument();
    expect(screen.getByText('Weekly Cleanup')).toBeInTheDocument();
    expect(screen.getByText('Cron: 0 9 * * *')).toBeInTheDocument();
  });

  it('renders webhook triggers list from mock API', async () => {
    vi.mocked(triggersApi.getTriggers).mockResolvedValue([
      {
        triggerId: 'webhook-1',
        name: 'GitHub Webhook',
        triggerType: 'webhook',
        status: 'active',
        webhookKey: 'gh-key-123',
        webhookUrl: 'https://example.com/webhook/gh-key-123',
        createdAt: '2024-01-01T10:00:00Z',
      },
    ]);

    render(<TriggersTab />);

    await waitFor(() => {
      expect(screen.getByTestId('triggers-panel')).toBeInTheDocument();
    });

    expect(screen.getByTestId('trigger-item-webhook-1')).toBeInTheDocument();
    expect(screen.getByText('GitHub Webhook')).toBeInTheDocument();
    expect(screen.getByText('Key: gh-key-123')).toBeInTheDocument();
    expect(screen.getByText(/URL: https:\/\/example.com\/webhook\/gh-key-123/)).toBeInTheDocument();
  });

  it('status toggle calls API and updates UI', async () => {
    vi.mocked(triggersApi.getTriggers).mockResolvedValue([
      {
        triggerId: 'trigger-1',
        name: 'Test Trigger',
        triggerType: 'schedule',
        status: 'active',
        cronExpression: '0 9 * * *',
        createdAt: '2024-01-01T10:00:00Z',
      },
    ]);
    vi.mocked(triggersApi.toggleTrigger).mockResolvedValue({
      triggerId: 'trigger-1',
      name: 'Test Trigger',
      triggerType: 'schedule',
      status: 'paused',
      cronExpression: '0 9 * * *',
      createdAt: '2024-01-01T10:00:00Z',
    });

    render(<TriggersTab />);

    await waitFor(() => {
      expect(screen.getByTestId('trigger-item-trigger-1')).toBeInTheDocument();
    });

    const toggleBtn = screen.getByTestId('toggle-trigger-trigger-1');
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(triggersApi.toggleTrigger).toHaveBeenCalledWith('trigger-1', 'paused');
    });

    await waitFor(() => {
      const statusSpan = screen.getByText('Test Trigger').closest('.trigger-item')?.querySelector('.trigger-status');
      expect(statusSpan).toHaveTextContent('暂停');
    });
  });

  it('renders recent trigger log table when trigger is selected', async () => {
    vi.mocked(triggersApi.getTriggers).mockResolvedValue([
      {
        triggerId: 'trigger-1',
        name: 'Test Trigger',
        triggerType: 'schedule',
        status: 'active',
        cronExpression: '0 9 * * *',
        createdAt: '2024-01-01T10:00:00Z',
      },
    ]);
    vi.mocked(triggersApi.getTriggerLogs).mockResolvedValue({
      logs: [
        {
          logId: 'log-1',
          triggerId: 'trigger-1',
          eventType: 'execution',
          status: 'success',
          executedAt: '2024-01-01T09:00:00Z',
        },
        {
          logId: 'log-2',
          triggerId: 'trigger-1',
          eventType: 'execution',
          status: 'failed',
          executedAt: '2024-01-02T09:00:00Z',
          error: 'Connection timeout',
        },
      ],
      total: 2,
    });

    render(<TriggersTab />);

    await waitFor(() => {
      expect(screen.getByTestId('trigger-item-trigger-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('trigger-item-trigger-1'));

    await waitFor(() => {
      expect(screen.getByTestId('trigger-logs-table')).toBeInTheDocument();
    });

    expect(screen.getByTestId('log-row-log-1')).toBeInTheDocument();
    expect(screen.getByTestId('log-row-log-2')).toBeInTheDocument();
    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('Connection timeout')).toBeInTheDocument();
  });

  it('shows empty state when no triggers', async () => {
    vi.mocked(triggersApi.getTriggers).mockResolvedValue([]);

    render(<TriggersTab />);

    await waitFor(() => {
      expect(screen.getByText('暂无触发器')).toBeInTheDocument();
    });
  });

  it('shows error state with retry button', async () => {
    vi.mocked(triggersApi.getTriggers).mockRejectedValue(new Error('API error'));

    render(<TriggersTab />);

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument();
    });

    expect(screen.getByText('API error')).toBeInTheDocument();

    vi.mocked(triggersApi.getTriggers).mockResolvedValue([]);
    fireEvent.click(screen.getByTestId('error-message-retry'));

    await waitFor(() => {
      expect(triggersApi.getTriggers).toHaveBeenCalledTimes(2);
    });
  });

  it('shows empty state for schedule triggers when only webhooks exist', async () => {
    vi.mocked(triggersApi.getTriggers).mockResolvedValue([
      {
        triggerId: 'webhook-1',
        name: 'Webhook Only',
        triggerType: 'webhook',
        status: 'active',
        webhookKey: 'key-123',
        webhookUrl: 'https://example.com/webhook',
        createdAt: '2024-01-01T10:00:00Z',
      },
    ]);

    render(<TriggersTab />);

    await waitFor(() => {
      expect(screen.getByText('暂无定时触发器')).toBeInTheDocument();
    });
    expect(screen.getByTestId('trigger-item-webhook-1')).toBeInTheDocument();
  });

  it('shows empty state for webhook triggers when only schedules exist', async () => {
    vi.mocked(triggersApi.getTriggers).mockResolvedValue([
      {
        triggerId: 'schedule-1',
        name: 'Schedule Only',
        triggerType: 'schedule',
        status: 'active',
        cronExpression: '0 9 * * *',
        createdAt: '2024-01-01T10:00:00Z',
      },
    ]);

    render(<TriggersTab />);

    await waitFor(() => {
      expect(screen.getByText('暂无 Webhook 触发器')).toBeInTheDocument();
    });
    expect(screen.getByTestId('trigger-item-schedule-1')).toBeInTheDocument();
  });

  it('shows empty logs state when no logs exist', async () => {
    vi.mocked(triggersApi.getTriggers).mockResolvedValue([
      {
        triggerId: 'trigger-1',
        name: 'Test Trigger',
        triggerType: 'schedule',
        status: 'active',
        cronExpression: '0 9 * * *',
        createdAt: '2024-01-01T10:00:00Z',
      },
    ]);
    vi.mocked(triggersApi.getTriggerLogs).mockResolvedValue({ logs: [], total: 0 });

    render(<TriggersTab />);

    await waitFor(() => {
      expect(screen.getByTestId('trigger-item-trigger-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('trigger-item-trigger-1'));

    await waitFor(() => {
      expect(screen.getByText('暂无执行日志')).toBeInTheDocument();
    });
  });

  it('disables toggle button while loading', async () => {
    vi.mocked(triggersApi.getTriggers).mockResolvedValue([
      {
        triggerId: 'trigger-1',
        name: 'Test Trigger',
        triggerType: 'schedule',
        status: 'active',
        cronExpression: '0 9 * * *',
        createdAt: '2024-01-01T10:00:00Z',
      },
    ]);
    vi.mocked(triggersApi.toggleTrigger).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    render(<TriggersTab />);

    await waitFor(() => {
      expect(screen.getByTestId('toggle-trigger-trigger-1')).toBeInTheDocument();
    });

    const toggleBtn = screen.getByTestId('toggle-trigger-trigger-1');
    fireEvent.click(toggleBtn);

    expect(toggleBtn).toBeDisabled();
  });
});
