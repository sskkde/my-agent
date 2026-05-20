import React, { useCallback, useEffect, useState } from 'react';
import * as triggersApi from '../../api/triggers';
import type { TriggerResponse, TriggerLogEntry } from '../../api/types';
import TriggerCreateDialog from './TriggerCreateDialog';
import LoadingSpinner from '../../components/LoadingSpinner';

const TriggersTab: React.FC = () => {
  const [triggers, setTriggers] = useState<TriggerResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTrigger, setSelectedTrigger] = useState<TriggerResponse | null>(null);
  const [logs, setLogs] = useState<TriggerLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [toggleLoading, setToggleLoading] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const loadTriggers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await triggersApi.getTriggers();
      setTriggers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载触发器失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTriggers();
  }, [loadTriggers]);

  const handleToggleStatus = async (triggerId: string, currentStatus: 'active' | 'paused') => {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    setToggleLoading(triggerId);
    try {
      const updated = await triggersApi.toggleTrigger(triggerId, newStatus);
      setTriggers((prev) =>
        prev.map((t) => (t.triggerId === triggerId ? updated : t))
      );
      if (selectedTrigger?.triggerId === triggerId) {
        setSelectedTrigger(updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换状态失败');
    } finally {
      setToggleLoading(null);
    }
  };

  const handleSelectTrigger = async (trigger: TriggerResponse) => {
    setSelectedTrigger(trigger);
    setLogs([]);
    setLogsLoading(true);
    try {
      const result = await triggersApi.getTriggerLogs(trigger.triggerId, 20);
      setLogs(result.logs);
    } catch {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  };

  const scheduleTriggers = triggers.filter((t) => t.triggerType === 'schedule');
  const webhookTriggers = triggers.filter((t) => t.triggerType === 'webhook');

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString('zh-CN');
    } catch {
      return dateStr;
    }
  };

  const getStatusLabel = (status: string) => {
    return status === 'active' ? '启用' : '暂停';
  };

  if (loading) {
    return (
      <div data-testid="triggers-panel" className="triggers-panel">
        <LoadingSpinner label="加载触发器列表..." />
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="triggers-panel" className="triggers-panel">
        <div className="triggers-error" data-testid="triggers-error">
          <p>{error}</p>
          <button className="secondary-button" onClick={loadTriggers}>重试</button>
        </div>
      </div>
    );
  }

  if (triggers.length === 0) {
    return (
      <div data-testid="triggers-panel" className="triggers-panel">
        <p className="empty-state" data-testid="triggers-empty">暂无触发器</p>
      </div>
    );
  }

  return (
    <div data-testid="triggers-panel" className="triggers-panel">
      <div className="triggers-content">
        <section className="triggers-list-section">
          <div className="triggers-section-header">
            <h4>定时触发器</h4>
            <button
              className="primary-button"
              data-testid="create-trigger-btn"
              onClick={() => setCreateDialogOpen(true)}
            >
              创建触发器
            </button>
          </div>
          {scheduleTriggers.length === 0 ? (
            <p className="empty-state">暂无定时触发器</p>
          ) : (
            <div className="triggers-list">
              {scheduleTriggers.map((trigger) => (
                <div
                  key={trigger.triggerId}
                  data-testid={`trigger-item-${trigger.triggerId}`}
                  className={`trigger-item ${selectedTrigger?.triggerId === trigger.triggerId ? 'active' : ''}`}
                  onClick={() => handleSelectTrigger(trigger)}
                >
                  <div className="trigger-header">
                    <span className="trigger-name">{trigger.name}</span>
                    <span className={`trigger-status ${trigger.status}`}>
                      {getStatusLabel(trigger.status)}
                    </span>
                  </div>
                  <div className="trigger-meta">
                    <span>Cron: {trigger.cronExpression || '-'}</span>
                    <span>创建: {formatDate(trigger.createdAt)}</span>
                  </div>
                  <button
                    className={`toggle-btn ${trigger.status}`}
                    data-testid={`toggle-trigger-${trigger.triggerId}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleStatus(trigger.triggerId, trigger.status);
                    }}
                    disabled={toggleLoading === trigger.triggerId}
                  >
                    {toggleLoading === trigger.triggerId ? '处理中...' : getStatusLabel(trigger.status)}
                  </button>
                </div>
              ))}
            </div>
          )}

          <h4 style={{ marginTop: '24px' }}>Webhook 触发器</h4>
          {webhookTriggers.length === 0 ? (
            <p className="empty-state">暂无 Webhook 触发器</p>
          ) : (
            <div className="triggers-list">
              {webhookTriggers.map((trigger) => (
                <div
                  key={trigger.triggerId}
                  data-testid={`trigger-item-${trigger.triggerId}`}
                  className={`trigger-item ${selectedTrigger?.triggerId === trigger.triggerId ? 'active' : ''}`}
                  onClick={() => handleSelectTrigger(trigger)}
                >
                  <div className="trigger-header">
                    <span className="trigger-name">{trigger.name}</span>
                    <span className={`trigger-status ${trigger.status}`}>
                      {getStatusLabel(trigger.status)}
                    </span>
                  </div>
                  <div className="trigger-meta">
                    <span>Key: {trigger.webhookKey || '-'}</span>
                    <span>URL: {trigger.webhookUrl || '-'}</span>
                  </div>
                  <button
                    className={`toggle-btn ${trigger.status}`}
                    data-testid={`toggle-trigger-${trigger.triggerId}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleStatus(trigger.triggerId, trigger.status);
                    }}
                    disabled={toggleLoading === trigger.triggerId}
                  >
                    {toggleLoading === trigger.triggerId ? '处理中...' : getStatusLabel(trigger.status)}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {selectedTrigger && (
          <section className="trigger-logs-section">
            <h4>最近执行日志</h4>
            {logsLoading ? (
              <LoadingSpinner size="small" label="加载日志..." />
            ) : logs.length === 0 ? (
              <p className="empty-state">暂无执行日志</p>
            ) : (
              <table className="logs-table" data-testid="trigger-logs-table">
                <thead>
                  <tr>
                    <th>事件类型</th>
                    <th>状态</th>
                    <th>执行时间</th>
                    <th>错误</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.logId} data-testid={`log-row-${log.logId}`}>
                      <td>{log.eventType}</td>
                      <td>{log.status}</td>
                      <td>{formatDate(log.executedAt)}</td>
                      <td className={log.error ? 'error-text' : ''}>{log.error || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>

      <TriggerCreateDialog
        isOpen={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSuccess={loadTriggers}
      />
    </div>
  );
};

export default TriggersTab;
