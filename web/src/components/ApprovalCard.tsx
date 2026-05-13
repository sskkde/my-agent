import React, { useState } from 'react';
import { useToast } from './Toast';
import { useApprovalActions } from '../features/approvals/ApprovalActionHandler';

export interface ApprovalCardProps {
  approvalId: string;
  actionType: string;
  resource?: string;
  justification?: string;
  riskLevel?: string;
  status: 'pending' | 'approved' | 'rejected';
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
}

const riskLevelLabels: Record<string, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
};

export const ApprovalCard: React.FC<ApprovalCardProps> = ({
  approvalId,
  actionType,
  resource,
  justification,
  riskLevel,
  status,
  onApprove,
  onReject,
}) => {
  const [actionTaken, setActionTaken] = useState<'approved' | 'rejected' | null>(null);
  const { addToast } = useToast();
  const { approve, reject, isSubmitting, error } = useApprovalActions();

  const effectiveStatus = actionTaken ?? status;
  const isPending = effectiveStatus === 'pending';

  const handleApprove = async () => {
    try {
      await approve(approvalId);
      setActionTaken('approved');
      addToast('success', '审批已通过');
      onApprove(approvalId);
    } catch (_err) {
      // Error state is surfaced by useApprovalActions.
    }
  };

  const handleReject = async () => {
    try {
      await reject(approvalId);
      setActionTaken('rejected');
      addToast('success', '审批已拒绝');
      onReject(approvalId);
    } catch (_err) {
      // Error state is surfaced by useApprovalActions.
    }
  };

  return (
    <div
      className="approval-card"
      data-testid="approval-card"
      data-status={effectiveStatus}
    >
      <div className="approval-card__header">
        <span className="approval-card__action-type">{actionType}</span>
        {riskLevel && (
          <span className={`approval-card__risk approval-card__risk--${riskLevel}`}>
            {riskLevelLabels[riskLevel] || riskLevel}
          </span>
        )}
      </div>

      {resource && (
        <div className="approval-card__row">
          <span className="approval-card__label">资源:</span>
          <span className="approval-card__value">{resource}</span>
        </div>
      )}

      {justification && (
        <div className="approval-card__row">
          <span className="approval-card__label">说明:</span>
          <span className="approval-card__value">{justification}</span>
        </div>
      )}

      {isPending && (
        <div className="approval-card__actions">
          <button
            className="approval-card__btn approval-card__btn--approve"
            data-testid={`approval-approve-${approvalId}`}
            onClick={handleApprove}
            disabled={isSubmitting}
            type="button"
          >
            {isSubmitting ? '处理中...' : '批准'}
          </button>
          <button
            className="approval-card__btn approval-card__btn--reject"
            data-testid={`approval-reject-${approvalId}`}
            onClick={handleReject}
            disabled={isSubmitting}
            type="button"
          >
            {isSubmitting ? '处理中...' : '拒绝'}
          </button>
        </div>
      )}

      {effectiveStatus === 'approved' && (
        <div className="approval-card__status approval-card__status--approved">
          <span className="approval-card__status-icon">✓</span>
          已批准
        </div>
      )}

      {effectiveStatus === 'rejected' && (
        <div className="approval-card__status approval-card__status--rejected">
          <span className="approval-card__status-icon">✕</span>
          已拒绝
        </div>
      )}

      {error && (
        <div className="approval-card__error" data-testid="approval-error">
          {error}
        </div>
      )}
    </div>
  );
};

export default ApprovalCard;
