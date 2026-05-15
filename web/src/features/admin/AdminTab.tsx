import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import * as adminApi from '../../api/admin';
import type {
  AdminUser,
  AdminApiKey,
  ConnectorHealthStatus,
  SystemSettings,
  UserRole,
} from '../../api/types';

const AdminTab: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [apiKeys, setApiKeys] = useState<AdminApiKey[]>([]);
  const [connectors, setConnectors] = useState<ConnectorHealthStatus[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);

  const [createKeyDialogOpen, setCreateKeyDialogOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyRole, setNewKeyRole] = useState<UserRole>('service');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, keysRes, connectorsRes, settingsRes] = await Promise.all([
        adminApi.listUsers(),
        adminApi.listApiKeys(),
        adminApi.getConnectorHealth(),
        adminApi.getSystemSettings(),
      ]);
      setUsers(usersRes.users);
      setApiKeys(keysRes.keys);
      setConnectors(connectorsRes.connectors);
      setSettings(settingsRes.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRoleChange = async (userId: string, role: UserRole) => {
    setActionLoading(`role-${userId}`);
    try {
      const updated = await adminApi.updateUserRole(userId, { role });
      setUsers((prev) => prev.map((u) => (u.userId === userId ? updated : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新角色失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleStatusToggle = async (userId: string, currentStatus: 'active' | 'disabled') => {
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
    setActionLoading(`status-${userId}`);
    try {
      const updated = await adminApi.updateUserStatus(userId, { status: newStatus });
      setUsers((prev) => prev.map((u) => (u.userId === userId ? updated : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新状态失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setActionLoading('create-key');
    try {
      const result = await adminApi.createApiKey({ name: newKeyName, role: newKeyRole });
      setCreatedKey(result.key);
      setApiKeys((prev) => [
        ...prev,
        {
          id: result.id,
          name: result.name,
          prefix: result.prefix,
          role: result.role,
          status: 'active',
          userId: null,
          createdAt: result.createdAt,
          expiresAt: null,
          lastUsedAt: null,
        },
      ]);
      setNewKeyName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建密钥失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRevokeKey = async (id: string) => {
    setActionLoading(`revoke-${id}`);
    try {
      await adminApi.revokeApiKey(id);
      setApiKeys((prev) => prev.map((k) => (k.id === id ? { ...k, status: 'revoked' } : k)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '撤销密钥失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveSettings = async () => {
    if (!settings) return;
    setActionLoading('save-settings');
    try {
      const result = await adminApi.updateSystemSettings(settings);
      setSettings(result.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存设置失败');
    } finally {
      setActionLoading(null);
    }
  };

  if (!user || user.role !== 'admin') {
    return (
      <div className="admin-tab" data-testid="admin-access-denied">
        <div className="admin-denied-content">
          <h2>需要管理员权限</h2>
          <p>您没有权限访问此页面。</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="admin-tab" data-testid="admin-loading">
        <div className="loading">加载中...</div>
      </div>
    );
  }

  if (error && users.length === 0 && apiKeys.length === 0) {
    return (
      <div className="admin-tab" data-testid="admin-error">
        <div className="admin-error-content">
          <p>{error}</p>
          <button className="secondary-button" onClick={loadData}>重试</button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-tab" data-testid="admin-panel">
      <div className="content-header">
        <h2>管理控制台</h2>
      </div>

      <div className="admin-content">
        {error && (
          <div className="admin-error-toast" data-testid="admin-error-toast">
            {error}
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        <section className="admin-section" data-testid="user-management-panel">
          <h3>用户管理</h3>
          {users.length === 0 ? (
            <p className="empty-state">暂无用户</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>用户 ID</th>
                  <th>用户名</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.userId} data-testid={`user-row-${u.userId}`}>
                    <td className="mono">{u.userId.slice(0, 8)}...</td>
                    <td>{u.username}</td>
                    <td>
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.userId, e.target.value as UserRole)}
                        disabled={actionLoading === `role-${u.userId}`}
                        className="role-select"
                        data-testid={`role-select-${u.userId}`}
                      >
                        <option value="admin">管理员</option>
                        <option value="user">用户</option>
                        <option value="service">服务</option>
                      </select>
                    </td>
                    <td>
                      <span className={`status-badge status-${u.status}`}>
                        {u.status === 'active' ? '启用' : '禁用'}
                      </span>
                    </td>
                    <td>
                      <button
                        className={`toggle-btn ${u.status}`}
                        onClick={() => handleStatusToggle(u.userId, u.status)}
                        disabled={actionLoading === `status-${u.userId}`}
                        data-testid={`status-toggle-${u.userId}`}
                      >
                        {actionLoading === `status-${u.userId}` ? '处理中...' : (u.status === 'active' ? '禁用' : '启用')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="admin-section" data-testid="api-key-management-panel">
          <div className="section-header">
            <h3>API 密钥管理</h3>
            <button
              className="primary-button"
              onClick={() => setCreateKeyDialogOpen(true)}
              data-testid="create-api-key-btn"
            >
              创建密钥
            </button>
          </div>
          {apiKeys.length === 0 ? (
            <p className="empty-state">暂无 API 密钥</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>前缀</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((k) => (
                  <tr key={k.id} data-testid={`api-key-row-${k.id}`}>
                    <td>{k.name}</td>
                    <td className="mono">{k.prefix}</td>
                    <td>
                      <span className={`role-badge role-${k.role}`}>{k.role}</span>
                    </td>
                    <td>
                      <span className={`status-badge status-${k.status}`}>
                        {k.status === 'active' ? '有效' : '已撤销'}
                      </span>
                    </td>
                    <td>
                      {k.status === 'active' && (
                        <button
                          className="danger-btn"
                          onClick={() => handleRevokeKey(k.id)}
                          disabled={actionLoading === `revoke-${k.id}`}
                          data-testid={`revoke-key-${k.id}`}
                        >
                          {actionLoading === `revoke-${k.id}` ? '处理中...' : '撤销'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {createKeyDialogOpen && (
            <div className="modal-overlay" data-testid="api-key-create-dialog">
              <div className="modal-content">
                <div className="modal-header">
                  <h4>创建 API 密钥</h4>
                  <button
                    className="modal-close"
                    onClick={() => {
                      setCreateKeyDialogOpen(false);
                      setCreatedKey(null);
                    }}
                    data-testid="api-key-dialog-close"
                  >
                    ×
                  </button>
                </div>
                <div className="modal-body">
                  {createdKey ? (
                    <div className="key-created-success">
                      <p>密钥已创建！请立即复制，此密钥将不再显示：</p>
                      <code className="key-display">{createdKey}</code>
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setCreateKeyDialogOpen(false);
                          setCreatedKey(null);
                        }}
                      >
                        完成
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="form-group">
                        <label htmlFor="key-name">名称</label>
                        <input
                          id="key-name"
                          type="text"
                          value={newKeyName}
                          onChange={(e) => setNewKeyName(e.target.value)}
                          placeholder="例如: CI Pipeline"
                          className="input-field"
                          data-testid="api-key-name-input"
                        />
                      </div>
                      <div className="form-group">
                        <label htmlFor="key-role">角色</label>
                        <select
                          id="key-role"
                          value={newKeyRole}
                          onChange={(e) => setNewKeyRole(e.target.value as UserRole)}
                          className="input-field"
                          data-testid="api-key-role-select"
                        >
                          <option value="admin">管理员</option>
                          <option value="user">用户</option>
                          <option value="service">服务</option>
                        </select>
                      </div>
                      <div className="modal-actions">
                        <button
                          className="secondary-button"
                          onClick={() => setCreateKeyDialogOpen(false)}
                        >
                          取消
                        </button>
                        <button
                          className="primary-button"
                          onClick={handleCreateKey}
                          disabled={actionLoading === 'create-key' || !newKeyName.trim()}
                          data-testid="api-key-create-submit"
                        >
                          {actionLoading === 'create-key' ? '创建中...' : '创建'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="admin-section" data-testid="system-settings-panel">
          <h3>系统设置</h3>
          {settings && (
            <div className="settings-form">
              <div className="form-group">
                <label htmlFor="rate-minute">每分钟请求限制</label>
                <input
                  id="rate-minute"
                  type="number"
                  value={settings.rateLimitPerMinute}
                  onChange={(e) => setSettings({ ...settings, rateLimitPerMinute: Number(e.target.value) })}
                  className="input-field"
                  data-testid="rate-limit-per-minute"
                />
              </div>
              <div className="form-group">
                <label htmlFor="rate-hour">每小时请求限制</label>
                <input
                  id="rate-hour"
                  type="number"
                  value={settings.rateLimitPerHour}
                  onChange={(e) => setSettings({ ...settings, rateLimitPerHour: Number(e.target.value) })}
                  className="input-field"
                  data-testid="rate-limit-per-hour"
                />
              </div>
              <div className="form-group">
                <label htmlFor="token-ttl">会话令牌有效期 (小时)</label>
                <input
                  id="token-ttl"
                  type="number"
                  value={settings.sessionTokenTtlHours}
                  onChange={(e) => setSettings({ ...settings, sessionTokenTtlHours: Number(e.target.value) })}
                  className="input-field"
                  data-testid="session-token-ttl"
                />
              </div>
              <button
                className="primary-button"
                onClick={handleSaveSettings}
                disabled={actionLoading === 'save-settings'}
                data-testid="settings-save-btn"
              >
                {actionLoading === 'save-settings' ? '保存中...' : '保存设置'}
              </button>
            </div>
          )}
        </section>

        <section className="admin-section" data-testid="connector-status-panel">
          <h3>连接器状态</h3>
          {connectors.length === 0 ? (
            <p className="empty-state">暂无连接器</p>
          ) : (
            <div className="connector-grid">
              {connectors.map((c) => (
                <div
                  key={c.connectorId}
                  className="connector-card"
                  data-testid={`connector-status-${c.connectorId}`}
                >
                  <div className="connector-header">
                    <span
                      className={`connector-status-icon status-${c.status}`}
                      data-testid={`connector-status-icon-${c.connectorId}`}
                    >
                      {c.status === 'healthy' ? '✓' : c.status === 'degraded' ? '⚠' : '✗'}
                    </span>
                    <span className="connector-name">{c.displayName}</span>
                  </div>
                  <div className="connector-meta">
                    <span className="connector-type">{c.connectorType}</span>
                    <span className={`connector-status-text status-${c.status}`}>
                      {c.status === 'healthy' ? '健康' : c.status === 'degraded' ? '降级' : '异常'}
                    </span>
                  </div>
                  {c.message && <p className="connector-message">{c.message}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default AdminTab;
