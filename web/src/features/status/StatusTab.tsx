import React, { useEffect, useState } from 'react';
import * as client from '../../api/client';
import type { HealthResponse, ApprovalsResponse, ApprovalInfo } from '../../api/types';
import type { TabId } from '../../components/TabNav';
import ErrorMessage from '../../components/ErrorMessage';
import LoadingSpinner from '../../components/LoadingSpinner';

interface StatusTabProps {
  onTabChange: (tab: TabId) => void;
}

const StatusTab: React.FC<StatusTabProps> = ({ onTabChange }) => {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<Error | null>(null);
  const [approvals, setApprovals] = useState<ApprovalsResponse | null>(null);
  const [approvalsError, setApprovalsError] = useState<Error | null>(null);
  const [selectedApproval, setSelectedApproval] = useState<ApprovalInfo | null>(null);
  const [reason, setReason] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const healthData = await client.getHealth();
        setHealth(healthData);
      } catch (err) {
        setHealthError(err instanceof Error ? err : new Error('无法加载健康状态'));
      }
    };
    fetchData();
  }, []);

  const fetchApprovals = async () => {
    try {
      const approvalsData = await client.getApprovals();
      setApprovals(approvalsData);
      setApprovalsError(null);
    } catch (err) {
      setApprovalsError(err instanceof Error ? err : new Error('无法加载审批列表'));
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

  return (
    <div data-testid="status-panel" className="status-panel">
      <section className="status-intro">
        <h3>欢迎使用 Agent Platform</h3>
        <p>
          Agent Platform 是一个多智能体任务编排与执行平台，提供可扩展的、资源管理的环境来运行 AI 驱动的智能体。
          支持 LLM 提供商、后台任务处理和健壮的错误处理。
        </p>
      </section>

      <section data-testid="status-health-summary" className="status-health">
        <h4>系统健康状态</h4>
        {healthError ? (
          <ErrorMessage error={healthError} size="small" />
        ) : health ? (
          <div className="health-info">
            <div className={`health-status ${health.status}`}>
              <span className="status-label">总体状态:</span>
              <span className="status-value">
                {health.status === 'healthy' ? '健康' : '降级'}
              </span>
            </div>
            <div className="modules-list">
              {Object.entries(health.modules).map(([name, module]) => (
                <div key={name} className={`module-item ${module.status}`}>
                  <span className="module-name">{name}</span>
                  <span className="module-status">
                    {module.status === 'healthy' ? '正常' : module.status === 'degraded' ? '降级' : '异常'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <LoadingSpinner size="small" label="加载健康状态..." />
        )}
      </section>

      <section data-testid="approvals-summary" className="status-approvals">
        <h4>审批中心</h4>
        {approvalsError ? (
          <ErrorMessage error={approvalsError} retry={{ onClick: fetchApprovals }} />
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
              <p className="empty-state">暂无审批项</p>
            )}
          </div>
        ) : (
          <LoadingSpinner size="small" label="加载审批列表..." />
        )}
      </section>

      <section className="status-quick-actions">
        <h4>快速操作</h4>
        <div className="quick-actions">
          <button
            data-testid="status-open-session"
            onClick={() => onTabChange('session-console')}
            className="quick-action-btn"
          >
            打开会话控制台
          </button>
          <button
            data-testid="status-open-monitor"
            onClick={() => onTabChange('agent-monitor')}
            className="quick-action-btn"
          >
            打开 Agent 监控
          </button>
        </div>
      </section>
    </div>
  );
};

export default StatusTab;