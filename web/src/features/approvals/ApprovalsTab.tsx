import React, { useEffect, useState } from 'react';
import * as client from '../../api/client';
import type { ApprovalsResponse, ApprovalInfo } from '../../api/types';
import type { TabId } from '../../navigation/navigation-config';
import LoadingSpinner from '../../components/LoadingSpinner';

interface ApprovalsTabProps {
  onTabChange: (tab: TabId) => void;
}

const ApprovalsTab: React.FC<ApprovalsTabProps> = ({ onTabChange }) => {
  const [approvals, setApprovals] = useState<ApprovalsResponse | null>(null);
  const [approvalsError, setApprovalsError] = useState(false);
  const [selectedApproval, setSelectedApproval] = useState<ApprovalInfo | null>(null);
  const [reason, setReason] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchApprovals = async () => {
    try {
      const approvalsData = await client.getApprovals();
      setApprovals(approvalsData);
      setApprovalsError(false);
    } catch {
      setApprovalsError(true);
    }
  };

  useEffect(() => {
    fetchApprovals();
  }, []);

  const pendingCount = approvals?.approvals.filter((a) => a.status === 'pending').length ?? 0;

  const handleApprovalAction = async (approvalId: string, decision: 'approved' | 'rejected') => {
    setActionLoading(approvalId);
    try {
      await client.respondApproval(approvalId, decision, reason || undefined);
      await fetchApprovals();
      setSelectedApproval(null);
      setReason('');
    } catch (error) {
      console.error('Failed to respond to approval:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: '待审批',
      approved: '已批准',
      rejected: '已拒绝',
      expired: '已过期',
      cancelled: '已取消',
    };
    return labels[status] || status;
  };

  const getStatusClass = (status: string) => {
    if (status === 'pending') return 'status-pending';
    if (status === 'approved') return 'status-approved';
    if (status === 'rejected') return 'status-rejected';
    return 'status-other';
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString('zh-CN');
    } catch {
      return dateStr;
    }
  };

  return (
    <div data-testid="approvals-panel" className="approvals-panel">
      <section data-testid="approvals-summary" className="status-approvals">
        <h4>审批中心</h4>
        {approvalsError ? (
          <p className="empty-state">无法加载审批列表</p>
        ) : approvals ? (
          <div className="approvals-info">
            <div className="pending-count">
              待审批: <strong>{pendingCount}</strong>
            </div>

            {approvals.approvals.length > 0 ? (
              <div className="approvals-list">
                {approvals.approvals.map((approval) => (
                  <div
                    key={approval.id}
                    data-testid={`approval-row-${approval.id}`}
                    className={`approval-item ${getStatusClass(approval.status)}`}
                  >
                    <div className="approval-header">
                      <span className="approval-action">{approval.actionType}</span>
                      <span className={`approval-status ${getStatusClass(approval.status)}`}>
                        {getStatusLabel(approval.status)}
                      </span>
                    </div>
                    <div className="approval-meta">
                      <span>资源: {approval.resource || '-'}</span>
                      <span>请求者: {approval.requestedBy}</span>
                      <span>请求时间: {formatDate(approval.requestedAt)}</span>
                    </div>

                    <div className="approval-run-link">
                      {approval.plannerRunId ? (
                        <button
                          className="run-link-btn"
                          onClick={() => onTabChange('agent-monitor')}
                          data-testid={`view-run-${approval.id}`}
                        >
                          查看运行 →
                        </button>
                      ) : (
                        <span className="no-run-text">无关联运行</span>
                      )}
                    </div>

                    {selectedApproval?.id === approval.id && (
                      <div data-testid={`approval-detail-${approval.id}`} className="approval-detail">
                        <div className="detail-row">
                          <strong>范围:</strong> {approval.scope || '-'}
                        </div>
                        <div className="detail-row">
                          <strong>风险等级:</strong> {approval.riskLevel || '-'}
                        </div>
                        <div className="detail-row">
                          <strong>理由:</strong> {approval.justification || '-'}
                        </div>
                        {approval.status === 'pending' && (
                          <div className="approval-action-form">
                            <textarea
                              placeholder="审批意见（可选）"
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              className="reason-input"
                            />
                            <div className="action-buttons">
                              <button
                                data-testid={`approval-approve-${approval.id}`}
                                onClick={() => handleApprovalAction(approval.id, 'approved')}
                                disabled={actionLoading === approval.id}
                                className="approve-btn"
                              >
                                批准
                              </button>
                              <button
                                data-testid={`approval-reject-${approval.id}`}
                                onClick={() => handleApprovalAction(approval.id, 'rejected')}
                                disabled={actionLoading === approval.id}
                                className="reject-btn"
                              >
                                拒绝
                              </button>
                            </div>
                          </div>
                        )}
                        {approval.status !== 'pending' && (
                          <div className="resolution-info">
                            <div className="detail-row">
                              <strong>处理者:</strong> {approval.responseBy || '-'}
                            </div>
                            <div className="detail-row">
                              <strong>处理意见:</strong> {approval.responseReason || '-'}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {approval.status === 'pending' && selectedApproval?.id !== approval.id && (
                      <button
                        className="expand-btn"
                        onClick={() => setSelectedApproval(approval)}
                      >
                        查看详情
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">暂无待审批项</p>
            )}
          </div>
        ) : (
          <LoadingSpinner label="加载审批列表..." />
        )}
      </section>
    </div>
  );
};

export default ApprovalsTab;