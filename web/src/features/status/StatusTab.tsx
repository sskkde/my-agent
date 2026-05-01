import React, { useEffect, useState } from 'react';
import * as client from '../../api/client';
import type { HealthResponse, ApprovalsResponse } from '../../api/types';
import type { TabId } from '../../components/TabNav';

interface StatusTabProps {
  onTabChange: (tab: TabId) => void;
}

const StatusTab: React.FC<StatusTabProps> = ({ onTabChange }) => {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [approvals, setApprovals] = useState<ApprovalsResponse | null>(null);
  const [approvalsError, setApprovalsError] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const healthData = await client.getHealth();
        setHealth(healthData);
      } catch {
        setHealthError(true);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    const fetchApprovals = async () => {
      try {
        const approvalsData = await client.getApprovals();
        setApprovals(approvalsData);
      } catch {
        setApprovalsError(true);
      }
    };
    fetchApprovals();
  }, []);

  const pendingCount = approvals?.approvals.filter((a) => a.status === 'pending').length ?? 0;

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
          <p className="empty-state">无法加载健康状态</p>
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
          <div className="loading">加载中...</div>
        )}
      </section>

      <section data-testid="approvals-summary" className="status-approvals">
        <h4>审批概览</h4>
        {approvalsError ? (
          <p className="empty-state">暂无待审批项</p>
        ) : approvals ? (
          <div className="approvals-info">
            <div className="pending-count">
              待审批: <strong>{pendingCount}</strong>
            </div>
            {pendingCount === 0 && (
              <p className="empty-state">暂无待审批项</p>
            )}
          </div>
        ) : (
          <div className="loading">加载中...</div>
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