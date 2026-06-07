import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ApprovalDecisionModal } from './ApprovalDecisionModal';
import { ApprovalInfo } from '../../api/types';

describe('ApprovalDecisionModal', () => {
  const mockApproval: ApprovalInfo = {
    id: 'approval-1',
    sessionId: 'session-1',
    actionType: 'execute',
    resource: '/tmp/test.sh',
    scope: 'file_system',
    riskLevel: 'high',
    justification: 'Test script execution',
    requestedBy: 'agent-1',
    requestedAt: new Date().toISOString(),
    status: 'pending',
  };

  it('renders nothing when approval is null', () => {
    const { container } = render(
      <ApprovalDecisionModal
        approval={null}
        loading={false}
        error={null}
        onReject={vi.fn()}
        onApproveOnce={vi.fn()}
        onApproveAlways={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('approval-modal')).not.toBeInTheDocument();
  });

  it('accepts correct prop signature', () => {
    const props = {
      approval: null,
      loading: false,
      error: null,
      onReject: (reason?: string) => {},
      onApproveOnce: (reason?: string) => {},
      onApproveAlways: (reason?: string) => {},
      onClose: () => {},
    };

    render(<ApprovalDecisionModal {...props} />);
  });

  it('renders modal when approval is provided', () => {
    render(
      <ApprovalDecisionModal
        approval={mockApproval}
        loading={false}
        error={null}
        onReject={vi.fn()}
        onApproveOnce={vi.fn()}
        onApproveAlways={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId('approval-modal')).toBeInTheDocument();
    expect(screen.getByText('审批请求')).toBeInTheDocument();
    expect(screen.getByText('操作类型:')).toBeInTheDocument();
  });

  it('calls onApproveOnce with reason when approve-once button clicked with reason', () => {
    const onApproveOnce = vi.fn();
    render(
      <ApprovalDecisionModal
        approval={mockApproval}
        loading={false}
        error={null}
        onReject={vi.fn()}
        onApproveOnce={onApproveOnce}
        onApproveAlways={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const reasonInput = screen.getByTestId('approval-modal-reason');
    fireEvent.change(reasonInput, { target: { value: 'This looks safe' } });

    const approveOnceBtn = screen.getByTestId('approval-modal-approve-once');
    fireEvent.click(approveOnceBtn);

    expect(onApproveOnce).toHaveBeenCalledWith('This looks safe');
  });

  it('calls onReject with undefined when no reason typed', () => {
    const onReject = vi.fn();
    render(
      <ApprovalDecisionModal
        approval={mockApproval}
        loading={false}
        error={null}
        onReject={onReject}
        onApproveOnce={vi.fn()}
        onApproveAlways={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const rejectBtn = screen.getByTestId('approval-modal-reject');
    fireEvent.click(rejectBtn);

    expect(onReject).toHaveBeenCalledWith(undefined);
  });

  it('renders error message when error prop is provided', () => {
    render(
      <ApprovalDecisionModal
        approval={mockApproval}
        loading={false}
        error="Network error occurred"
        onReject={vi.fn()}
        onApproveOnce={vi.fn()}
        onApproveAlways={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Network error occurred')).toBeInTheDocument();
    expect(screen.getByText('Network error occurred')).toHaveClass('approval-error-message');
  });

  it('shows expired message and disables action buttons when approval is expired', () => {
    const expiredApproval: ApprovalInfo = {
      ...mockApproval,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };

    const onReject = vi.fn();
    const onApproveOnce = vi.fn();
    const onApproveAlways = vi.fn();

    render(
      <ApprovalDecisionModal
        approval={expiredApproval}
        loading={false}
        error={null}
        onReject={onReject}
        onApproveOnce={onApproveOnce}
        onApproveAlways={onApproveAlways}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('此审批请求已过期，无法操作。')).toBeInTheDocument();
    expect(screen.queryByTestId('approval-modal-reason')).not.toBeInTheDocument();
    expect(screen.queryByTestId('approval-modal-reject')).not.toBeInTheDocument();
    expect(screen.queryByTestId('approval-modal-approve-once')).not.toBeInTheDocument();
    expect(screen.queryByTestId('approval-modal-approve-always')).not.toBeInTheDocument();
  });

  it('disables all action buttons when loading', () => {
    render(
      <ApprovalDecisionModal
        approval={mockApproval}
        loading={true}
        error={null}
        onReject={vi.fn()}
        onApproveOnce={vi.fn()}
        onApproveAlways={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId('approval-modal-reject')).toBeDisabled();
    expect(screen.getByTestId('approval-modal-approve-once')).toBeDisabled();
    expect(screen.getByTestId('approval-modal-approve-always')).toBeDisabled();
    expect(screen.getByTestId('approval-modal-reason')).toBeDisabled();
  });

  it('resets reason state when approval.id changes', () => {
    const { rerender } = render(
      <ApprovalDecisionModal
        approval={mockApproval}
        loading={false}
        error={null}
        onReject={vi.fn()}
        onApproveOnce={vi.fn()}
        onApproveAlways={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const reasonInput = screen.getByTestId('approval-modal-reason');
    fireEvent.change(reasonInput, { target: { value: 'First reason' } });
    expect(reasonInput).toHaveValue('First reason');

    const newApproval: ApprovalInfo = {
      ...mockApproval,
      id: 'approval-2',
    };

    rerender(
      <ApprovalDecisionModal
        approval={newApproval}
        loading={false}
        error={null}
        onReject={vi.fn()}
        onApproveOnce={vi.fn()}
        onApproveAlways={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const updatedReasonInput = screen.getByTestId('approval-modal-reason');
    expect(updatedReasonInput).toHaveValue('');
  });
});

