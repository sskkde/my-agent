import { useState, useEffect } from 'react';
import { ApprovalInfo } from '../../api/types';

export interface ApprovalDecisionModalProps {
  approval: ApprovalInfo | null;
  loading: boolean;
  error: string | null;
  onReject: (reason?: string) => void;
  onApproveOnce: (reason?: string) => void;
  onApproveAlways: (reason?: string) => void;
  onClose: () => void;
}

export function ApprovalDecisionModal({
  approval,
  loading,
  error,
  onReject,
  onApproveOnce,
  onApproveAlways,
  onClose,
}: ApprovalDecisionModalProps): JSX.Element | null {
  const [reason, setReason] = useState<string>('');

  useEffect(() => {
    if (approval?.id) {
      setReason('');
    }
  }, [approval?.id]);

  if (!approval) {
    return null;
  }

  const isExpired = approval.expiresAt
    ? new Date(approval.expiresAt) < new Date()
    : false;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="modal-overlay"
      data-testid="approval-modal"
      onKeyDown={handleKeyDown}
      onClick={handleBackdropClick}
      tabIndex={-1}
    >
      <div className="modal-content approval-modal">
        <div className="modal-header">
          <h4>审批请求</h4>
          <button
            onClick={onClose}
            disabled={loading}
            className="modal-close"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="approval-details">
            <div className="detail-row">
              <strong>操作类型:</strong> {approval.actionType}
            </div>
            {approval.resource && (
              <div className="detail-row">
                <strong>资源:</strong> {approval.resource}
              </div>
            )}
            {approval.scope && (
              <div className="detail-row">
                <strong>范围:</strong> {approval.scope}
              </div>
            )}
            {approval.riskLevel && (
              <div className="detail-row">
                <strong>风险等级:</strong> {approval.riskLevel}
              </div>
            )}
            {approval.justification && (
              <div className="detail-row">
                <strong>理由:</strong> {approval.justification}
              </div>
            )}
            <div className="detail-row">
              <strong>请求者:</strong> {approval.requestedBy}
            </div>
            {approval.expiresAt && (
              <div className="detail-row">
                <strong>过期时间:</strong>{' '}
                {isExpired ? (
                  <span className="approval-expired-message">已过期</span>
                ) : (
                  new Date(approval.expiresAt).toLocaleString()
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="approval-error-message">
              {error}
            </div>
          )}

          {isExpired && (
            <div className="approval-expired-message">
              此审批请求已过期，无法操作。
            </div>
          )}

          {!isExpired && (
            <textarea
              data-testid="approval-modal-reason"
              placeholder="审批意见（可选）"
              disabled={loading}
              className="reason-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}

          <div className="approval-action-buttons">
            {isExpired ? (
              <button
                onClick={onClose}
                className="modal-close"
              >
                关闭
              </button>
            ) : (
              <>
                <button
                  data-testid="approval-modal-reject"
                  onClick={() => onReject(reason || undefined)}
                  disabled={loading}
                  className="reject-btn"
                >
                  {loading ? '处理中...' : '拒绝'}
                </button>
                <button
                  data-testid="approval-modal-approve-once"
                  onClick={() => onApproveOnce(reason || undefined)}
                  disabled={loading}
                  className="approve-once-btn"
                >
                  {loading ? '处理中...' : '批准一次'}
                </button>
                <button
                  data-testid="approval-modal-approve-always"
                  onClick={() => onApproveAlways(reason || undefined)}
                  disabled={loading}
                  className="approve-always-btn"
                >
                  {loading ? '处理中...' : '永久批准'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
