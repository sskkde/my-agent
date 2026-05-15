import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DLQTab from './DLQTab';
import * as dlqApi from '../../api/dlq';

vi.mock('../../api/dlq');

describe('DLQTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', () => {
    vi.mocked(dlqApi.getDlqEntries).mockImplementation(() => new Promise(() => {}));
    render(<DLQTab />);
    expect(screen.getByTestId('dlq-loading')).toBeInTheDocument();
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  it('renders DLQ list with event type, source, error, and time', async () => {
    vi.mocked(dlqApi.getDlqEntries).mockResolvedValue({
      entries: [
        {
          eventId: 'dlq-1',
          sourceModule: 'trigger',
          sourceId: 'trigger-123',
          reason: 'Connection timeout',
          status: 'pending',
          failureCount: 3,
          enqueuedAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:30:00Z',
        },
        {
          eventId: 'dlq-2',
          sourceModule: 'workflow',
          sourceId: 'workflow-456',
          reason: 'Invalid payload schema',
          status: 'pending',
          failureCount: 1,
          enqueuedAt: '2024-01-02T08:00:00Z',
          updatedAt: '2024-01-02T08:15:00Z',
        },
      ],
      total: 2,
    });

    render(<DLQTab />);

    await waitFor(() => {
      expect(screen.getByTestId('dlq-panel')).toBeInTheDocument();
    });

    expect(screen.getByTestId('dlq-entry-dlq-1')).toBeInTheDocument();
    expect(screen.getByTestId('dlq-entry-dlq-2')).toBeInTheDocument();
    expect(screen.getByText('trigger')).toBeInTheDocument();
    expect(screen.getByText('trigger-123')).toBeInTheDocument();
    expect(screen.getByText('Connection timeout')).toBeInTheDocument();
    expect(screen.getByText('workflow')).toBeInTheDocument();
    expect(screen.getByText('workflow-456')).toBeInTheDocument();
  });

  it('retry button triggers reprocessing and removes entry on success', async () => {
    vi.mocked(dlqApi.getDlqEntries).mockResolvedValue({
      entries: [
        {
          eventId: 'dlq-1',
          sourceModule: 'trigger',
          sourceId: 'trigger-123',
          reason: 'Connection timeout',
          status: 'pending',
          failureCount: 3,
          enqueuedAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:30:00Z',
        },
      ],
      total: 1,
    });
    vi.mocked(dlqApi.retryDlqEntry).mockResolvedValue({
      success: true,
      eventId: 'dlq-1',
    });

    render(<DLQTab />);

    await waitFor(() => {
      expect(screen.getByTestId('dlq-entry-dlq-1')).toBeInTheDocument();
    });

    const retryBtn = screen.getByTestId('retry-dlq-1');
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(dlqApi.retryDlqEntry).toHaveBeenCalledWith('dlq-1');
    });

    await waitFor(() => {
      expect(screen.queryByTestId('dlq-entry-dlq-1')).not.toBeInTheDocument();
    });
  });

  it('discard button permanently deletes entry', async () => {
    vi.mocked(dlqApi.getDlqEntries).mockResolvedValue({
      entries: [
        {
          eventId: 'dlq-1',
          sourceModule: 'trigger',
          sourceId: 'trigger-123',
          reason: 'Connection timeout',
          status: 'pending',
          failureCount: 3,
          enqueuedAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:30:00Z',
        },
      ],
      total: 1,
    });
    vi.mocked(dlqApi.discardDlqEntry).mockResolvedValue({
      success: true,
      eventId: 'dlq-1',
    });

    render(<DLQTab />);

    await waitFor(() => {
      expect(screen.getByTestId('dlq-entry-dlq-1')).toBeInTheDocument();
    });

    const discardBtn = screen.getByTestId('discard-dlq-1');
    fireEvent.click(discardBtn);

    await waitFor(() => {
      expect(dlqApi.discardDlqEntry).toHaveBeenCalledWith('dlq-1');
    });

    await waitFor(() => {
      expect(screen.queryByTestId('dlq-entry-dlq-1')).not.toBeInTheDocument();
    });
  });

  it('checkbox selection enables batch operations toolbar', async () => {
    vi.mocked(dlqApi.getDlqEntries).mockResolvedValue({
      entries: [
        {
          eventId: 'dlq-1',
          sourceModule: 'trigger',
          sourceId: 'trigger-123',
          reason: 'Error 1',
          status: 'pending',
          failureCount: 1,
          enqueuedAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:30:00Z',
        },
        {
          eventId: 'dlq-2',
          sourceModule: 'workflow',
          sourceId: 'workflow-456',
          reason: 'Error 2',
          status: 'pending',
          failureCount: 1,
          enqueuedAt: '2024-01-02T08:00:00Z',
          updatedAt: '2024-01-02T08:15:00Z',
        },
      ],
      total: 2,
    });

    render(<DLQTab />);

    await waitFor(() => {
      expect(screen.getByTestId('dlq-entry-dlq-1')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('batch-toolbar')).not.toBeInTheDocument();

    const checkbox1 = screen.getByTestId('select-dlq-1');
    fireEvent.click(checkbox1);

    await waitFor(() => {
      expect(screen.getByTestId('batch-toolbar')).toBeInTheDocument();
    });

    expect(screen.getByText('已选择 1 项')).toBeInTheDocument();

    const checkbox2 = screen.getByTestId('select-dlq-2');
    fireEvent.click(checkbox2);

    await waitFor(() => {
      expect(screen.getByText('已选择 2 项')).toBeInTheDocument();
    });
  });

  it('batch retry all selected entries', async () => {
    vi.mocked(dlqApi.getDlqEntries).mockResolvedValue({
      entries: [
        {
          eventId: 'dlq-1',
          sourceModule: 'trigger',
          sourceId: 'trigger-123',
          reason: 'Error 1',
          status: 'pending',
          failureCount: 1,
          enqueuedAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:30:00Z',
        },
        {
          eventId: 'dlq-2',
          sourceModule: 'workflow',
          sourceId: 'workflow-456',
          reason: 'Error 2',
          status: 'pending',
          failureCount: 1,
          enqueuedAt: '2024-01-02T08:00:00Z',
          updatedAt: '2024-01-02T08:15:00Z',
        },
      ],
      total: 2,
    });
    vi.mocked(dlqApi.batchRetryDlqEntries).mockResolvedValue({
      results: [
        { eventId: 'dlq-1', success: true },
        { eventId: 'dlq-2', success: true },
      ],
      successCount: 2,
      failedCount: 0,
    });

    render(<DLQTab />);

    await waitFor(() => {
      expect(screen.getByTestId('dlq-entry-dlq-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('select-dlq-1'));
    fireEvent.click(screen.getByTestId('select-dlq-2'));

    await waitFor(() => {
      expect(screen.getByTestId('batch-retry-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('batch-retry-btn'));

    await waitFor(() => {
      expect(dlqApi.batchRetryDlqEntries).toHaveBeenCalledWith(['dlq-1', 'dlq-2']);
    });
  });

  it('batch discard all selected entries', async () => {
    vi.mocked(dlqApi.getDlqEntries).mockResolvedValue({
      entries: [
        {
          eventId: 'dlq-1',
          sourceModule: 'trigger',
          sourceId: 'trigger-123',
          reason: 'Error 1',
          status: 'pending',
          failureCount: 1,
          enqueuedAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:30:00Z',
        },
        {
          eventId: 'dlq-2',
          sourceModule: 'workflow',
          sourceId: 'workflow-456',
          reason: 'Error 2',
          status: 'pending',
          failureCount: 1,
          enqueuedAt: '2024-01-02T08:00:00Z',
          updatedAt: '2024-01-02T08:15:00Z',
        },
      ],
      total: 2,
    });
    vi.mocked(dlqApi.batchDiscardDlqEntries).mockResolvedValue({
      results: [
        { eventId: 'dlq-1', success: true },
        { eventId: 'dlq-2', success: true },
      ],
      successCount: 2,
    });

    render(<DLQTab />);

    await waitFor(() => {
      expect(screen.getByTestId('dlq-entry-dlq-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('select-dlq-1'));
    fireEvent.click(screen.getByTestId('select-dlq-2'));

    await waitFor(() => {
      expect(screen.getByTestId('batch-discard-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('batch-discard-btn'));

    await waitFor(() => {
      expect(dlqApi.batchDiscardDlqEntries).toHaveBeenCalledWith(['dlq-1', 'dlq-2']);
    });
  });

  it('expandable row shows full error and original event payload', async () => {
    vi.mocked(dlqApi.getDlqEntries).mockResolvedValue({
      entries: [
        {
          eventId: 'dlq-1',
          sourceModule: 'trigger',
          sourceId: 'trigger-123',
          reason: 'Connection timeout after 30s',
          status: 'pending',
          failureCount: 3,
          lastError: 'Error: ETIMEDOUT\n    at Socket.<anonymous>\n    at TCP.onread',
          payload: { eventType: 'webhook', data: { url: 'https://api.example.com' } },
          enqueuedAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:30:00Z',
        },
      ],
      total: 1,
    });

    render(<DLQTab />);

    await waitFor(() => {
      expect(screen.getByTestId('dlq-entry-dlq-1')).toBeInTheDocument();
    });

    const expandBtn = screen.getByTestId('expand-dlq-1');
    fireEvent.click(expandBtn);

    await waitFor(() => {
      expect(screen.getByTestId('dlq-detail-dlq-1')).toBeInTheDocument();
    });

    expect(screen.getByText(/ETIMEDOUT/)).toBeInTheDocument();
    expect(screen.getByText(/webhook/)).toBeInTheDocument();
  });

  it('shows empty state when no entries', async () => {
    vi.mocked(dlqApi.getDlqEntries).mockResolvedValue({
      entries: [],
      total: 0,
    });

    render(<DLQTab />);

    await waitFor(() => {
      expect(screen.getByTestId('dlq-empty')).toBeInTheDocument();
    });

    expect(screen.getByText('暂无死信事件')).toBeInTheDocument();
  });

  it('shows error state with retry button', async () => {
    vi.mocked(dlqApi.getDlqEntries).mockRejectedValue(new Error('API error'));

    render(<DLQTab />);

    await waitFor(() => {
      expect(screen.getByTestId('dlq-error')).toBeInTheDocument();
    });

    expect(screen.getByText('API error')).toBeInTheDocument();

    vi.mocked(dlqApi.getDlqEntries).mockResolvedValue({ entries: [], total: 0 });
    fireEvent.click(screen.getByText('重试'));

    await waitFor(() => {
      expect(dlqApi.getDlqEntries).toHaveBeenCalledTimes(2);
    });
  });

  it('status filter filters entries by status', async () => {
    vi.mocked(dlqApi.getDlqEntries).mockResolvedValue({
      entries: [
        {
          eventId: 'dlq-1',
          sourceModule: 'trigger',
          sourceId: 'trigger-123',
          reason: 'Error',
          status: 'pending',
          failureCount: 1,
          enqueuedAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:30:00Z',
        },
      ],
      total: 1,
    });

    render(<DLQTab />);

    await waitFor(() => {
      expect(screen.getByTestId('dlq-panel')).toBeInTheDocument();
    });

    const statusFilter = screen.getByTestId('status-filter');
    fireEvent.change(statusFilter, { target: { value: 'pending' } });

    await waitFor(() => {
      expect(dlqApi.getDlqEntries).toHaveBeenCalledWith('pending');
    });
  });

  it('disables action buttons while loading', async () => {
    vi.mocked(dlqApi.getDlqEntries).mockResolvedValue({
      entries: [
        {
          eventId: 'dlq-1',
          sourceModule: 'trigger',
          sourceId: 'trigger-123',
          reason: 'Error',
          status: 'pending',
          failureCount: 1,
          enqueuedAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:30:00Z',
        },
      ],
      total: 1,
    });
    vi.mocked(dlqApi.retryDlqEntry).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ success: true, eventId: 'dlq-1' }), 100))
    );

    render(<DLQTab />);

    await waitFor(() => {
      expect(screen.getByTestId('retry-dlq-1')).toBeInTheDocument();
    });

    const retryBtn = screen.getByTestId('retry-dlq-1');
    fireEvent.click(retryBtn);

    expect(retryBtn).toBeDisabled();
  });

  it('select all checkbox selects all entries', async () => {
    vi.mocked(dlqApi.getDlqEntries).mockResolvedValue({
      entries: [
        {
          eventId: 'dlq-1',
          sourceModule: 'trigger',
          sourceId: 'trigger-123',
          reason: 'Error 1',
          status: 'pending',
          failureCount: 1,
          enqueuedAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:30:00Z',
        },
        {
          eventId: 'dlq-2',
          sourceModule: 'workflow',
          sourceId: 'workflow-456',
          reason: 'Error 2',
          status: 'pending',
          failureCount: 1,
          enqueuedAt: '2024-01-02T08:00:00Z',
          updatedAt: '2024-01-02T08:15:00Z',
        },
      ],
      total: 2,
    });

    render(<DLQTab />);

    await waitFor(() => {
      expect(screen.getByTestId('dlq-entry-dlq-1')).toBeInTheDocument();
    });

    const selectAllCheckbox = screen.getByTestId('select-all');
    fireEvent.click(selectAllCheckbox);

    await waitFor(() => {
      expect(screen.getByText('已选择 2 项')).toBeInTheDocument();
    });
  });

  it('clear selection button clears all selections', async () => {
    vi.mocked(dlqApi.getDlqEntries).mockResolvedValue({
      entries: [
        {
          eventId: 'dlq-1',
          sourceModule: 'trigger',
          sourceId: 'trigger-123',
          reason: 'Error 1',
          status: 'pending',
          failureCount: 1,
          enqueuedAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:30:00Z',
        },
      ],
      total: 1,
    });

    render(<DLQTab />);

    await waitFor(() => {
      expect(screen.getByTestId('dlq-entry-dlq-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('select-dlq-1'));

    await waitFor(() => {
      expect(screen.getByTestId('batch-toolbar')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('clear-selection'));

    await waitFor(() => {
      expect(screen.queryByTestId('batch-toolbar')).not.toBeInTheDocument();
    });
  });
});
