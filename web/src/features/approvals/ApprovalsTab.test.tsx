import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ApprovalsTab from './ApprovalsTab';
import * as client from '../../api/client';

vi.mock('../../api/client');

describe('ApprovalsTab', () => {
  const mockOnTabChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders pending approvals from mock API response', async () => {
    vi.mocked(client.getApprovals).mockResolvedValue({
      approvals: [
        { id: 'approval-1', userId: 'user1', sessionId: 's1', status: 'pending', actionType: 'file.read', resource: '/path/to/file', requestedBy: 'user1', requestedAt: '2024-01-01T10:00:00Z' },
        { id: 'approval-2', userId: 'user2', sessionId: 's2', status: 'approved', actionType: 'web.search', resource: 'search query', requestedBy: 'user2', requestedAt: '2024-01-01T11:00:00Z' },
      ],
      total: 2,
    });

    render(<ApprovalsTab onTabChange={mockOnTabChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('approvals-panel')).toBeInTheDocument();
    });

    expect(screen.getByTestId('approval-row-approval-1')).toBeInTheDocument();
    expect(screen.getByTestId('approval-row-approval-2')).toBeInTheDocument();
    expect(screen.getByText('file.read')).toBeInTheDocument();
    expect(screen.getByText('web.search')).toBeInTheDocument();
  });

  it('click approve calls respondApproval with approved', async () => {
    vi.mocked(client.getApprovals).mockResolvedValue({
      approvals: [
        { id: 'approval-1', userId: 'user1', sessionId: 's1', status: 'pending', actionType: 'test', resource: 'resource-1', requestedBy: 'user1', requestedAt: new Date().toISOString() },
      ],
      total: 1,
    });
    vi.mocked(client.respondApproval).mockResolvedValue({
      success: true,
      approvalId: 'approval-1',
      status: 'approved',
    });

    render(<ApprovalsTab onTabChange={mockOnTabChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('approval-row-approval-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('查看详情'));

    await waitFor(() => {
      expect(screen.getByTestId('approval-approve-approval-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('approval-approve-approval-1'));

    await waitFor(() => {
      expect(client.respondApproval).toHaveBeenCalledWith('approval-1', 'approved', undefined);
    });
  });

  it('click reject calls respondApproval with rejected', async () => {
    vi.mocked(client.getApprovals).mockResolvedValue({
      approvals: [
        { id: 'approval-1', userId: 'user1', sessionId: 's1', status: 'pending', actionType: 'test', resource: 'resource-1', requestedBy: 'user1', requestedAt: new Date().toISOString() },
      ],
      total: 1,
    });
    vi.mocked(client.respondApproval).mockResolvedValue({
      success: true,
      approvalId: 'approval-1',
      status: 'rejected',
    });

    render(<ApprovalsTab onTabChange={mockOnTabChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('approval-row-approval-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('查看详情'));

    await waitFor(() => {
      expect(screen.getByTestId('approval-reject-approval-1')).toBeInTheDocument();
    });

    const reasonInput = screen.getByPlaceholderText('审批意见（可选）');
    fireEvent.change(reasonInput, { target: { value: 'not authorized' } });

    fireEvent.click(screen.getByTestId('approval-reject-approval-1'));

    await waitFor(() => {
      expect(client.respondApproval).toHaveBeenCalledWith('approval-1', 'rejected', 'not authorized');
    });
  });

  it('shows empty state when list is empty', async () => {
    vi.mocked(client.getApprovals).mockResolvedValue({
      approvals: [],
      total: 0,
    });

    render(<ApprovalsTab onTabChange={mockOnTabChange} />);

    await waitFor(() => {
      expect(screen.getByText(/暂无待审批项/)).toBeInTheDocument();
    });
  });

  it('shows error message when API fails', async () => {
    vi.mocked(client.getApprovals).mockRejectedValue(new Error('API error'));

    render(<ApprovalsTab onTabChange={mockOnTabChange} />);

    await waitFor(() => {
      expect(screen.getByText(/无法加载审批列表/)).toBeInTheDocument();
    });
  });

  it('shows loading state initially', () => {
    vi.mocked(client.getApprovals).mockImplementation(() => new Promise(() => {}));

    render(<ApprovalsTab onTabChange={mockOnTabChange} />);

    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  it('shows pending count correctly', async () => {
    vi.mocked(client.getApprovals).mockResolvedValue({
      approvals: [
        { id: '1', userId: 'user1', sessionId: 's1', status: 'pending', actionType: 'test', requestedBy: 'user1', requestedAt: new Date().toISOString() },
        { id: '2', userId: 'user2', sessionId: 's2', status: 'pending', actionType: 'test2', requestedBy: 'user2', requestedAt: new Date().toISOString() },
        { id: '3', userId: 'user3', sessionId: 's3', status: 'approved', actionType: 'test3', requestedBy: 'user3', requestedAt: new Date().toISOString() },
      ],
      total: 3,
    });

    render(<ApprovalsTab onTabChange={mockOnTabChange} />);

    await waitFor(() => {
      expect(screen.getByText('待审批:')).toBeInTheDocument();
    });

    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows resolution info for resolved approvals', async () => {
    vi.mocked(client.getApprovals).mockResolvedValue({
      approvals: [
        { id: 'approval-1', userId: 'user1', sessionId: 's1', status: 'approved', actionType: 'test', resource: 'resource-1', requestedBy: 'user1', requestedAt: new Date().toISOString(), responseBy: 'admin', responseReason: 'looks good' },
      ],
      total: 1,
    });

    render(<ApprovalsTab onTabChange={mockOnTabChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('approval-row-approval-1')).toBeInTheDocument();
    });

    expect(screen.getByText('已批准')).toBeInTheDocument();
  });

  it('refreshes list after approval action', async () => {
    vi.mocked(client.getApprovals)
      .mockResolvedValueOnce({
        approvals: [
          { id: 'approval-1', userId: 'user1', sessionId: 's1', status: 'pending', actionType: 'test', resource: 'resource-1', requestedBy: 'user1', requestedAt: new Date().toISOString() },
        ],
        total: 1,
      })
      .mockResolvedValueOnce({
        approvals: [
          { id: 'approval-1', userId: 'user1', sessionId: 's1', status: 'approved', actionType: 'test', resource: 'resource-1', requestedBy: 'user1', requestedAt: new Date().toISOString(), responseBy: 'admin', responseReason: '' },
        ],
        total: 1,
      });

    vi.mocked(client.respondApproval).mockResolvedValue({
      success: true,
      approvalId: 'approval-1',
      status: 'approved',
    });

    render(<ApprovalsTab onTabChange={mockOnTabChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('approval-row-approval-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('查看详情'));

    await waitFor(() => {
      expect(screen.getByTestId('approval-approve-approval-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('approval-approve-approval-1'));

    await waitFor(() => {
      expect(client.respondApproval).toHaveBeenCalledWith('approval-1', 'approved', undefined);
    });

    // Verify getApprovals was called again after approval
    expect(client.getApprovals).toHaveBeenCalledTimes(2);
  });

  it('shows "查看运行 →" link when plannerRunId is present', async () => {
    vi.mocked(client.getApprovals).mockResolvedValue({
      approvals: [
        { id: 'approval-1', userId: 'user1', sessionId: 's1', status: 'pending', actionType: 'test', resource: 'resource-1', requestedBy: 'user1', requestedAt: new Date().toISOString(), plannerRunId: 'pl_run_123' },
      ],
      total: 1,
    });

    render(<ApprovalsTab onTabChange={mockOnTabChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('approval-row-approval-1')).toBeInTheDocument();
    });

    expect(screen.getByTestId('view-run-approval-1')).toBeInTheDocument();
    expect(screen.getByText('查看运行 →')).toBeInTheDocument();
  });

  it('clicking "查看运行 →" navigates to agent-monitor tab', async () => {
    vi.mocked(client.getApprovals).mockResolvedValue({
      approvals: [
        { id: 'approval-1', userId: 'user1', sessionId: 's1', status: 'pending', actionType: 'test', resource: 'resource-1', requestedBy: 'user1', requestedAt: new Date().toISOString(), plannerRunId: 'pl_run_123' },
      ],
      total: 1,
    });

    render(<ApprovalsTab onTabChange={mockOnTabChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('view-run-approval-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('view-run-approval-1'));

    expect(mockOnTabChange).toHaveBeenCalledWith('agent-monitor');
  });

  it('shows "无关联运行" when plannerRunId is not present', async () => {
    vi.mocked(client.getApprovals).mockResolvedValue({
      approvals: [
        { id: 'approval-1', userId: 'user1', sessionId: 's1', status: 'pending', actionType: 'test', resource: 'resource-1', requestedBy: 'user1', requestedAt: new Date().toISOString() },
      ],
      total: 1,
    });

    render(<ApprovalsTab onTabChange={mockOnTabChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('approval-row-approval-1')).toBeInTheDocument();
    });

    expect(screen.getByText('无关联运行')).toBeInTheDocument();
    expect(screen.queryByTestId('view-run-approval-1')).not.toBeInTheDocument();
  });
});