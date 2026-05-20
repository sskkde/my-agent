import React, { useCallback, useEffect, useState } from 'react';
import * as connectorsApi from '../../api/connectors';
import type { ConnectorDefinition, ConnectorInstance } from '../../api/connectors';
import LoadingSpinner from '../../components/LoadingSpinner';

const ConnectorsTab: React.FC = () => {
  const [connectors, setConnectors] = useState<ConnectorDefinition[]>([]);
  const [selectedConnector, setSelectedConnector] = useState<ConnectorDefinition | null>(null);
  const [instances, setInstances] = useState<ConnectorInstance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<ConnectorInstance | null>(null);
  const [configText, setConfigText] = useState('');
  const [loading, setLoading] = useState(false);
  const [instancesLoading, setInstancesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSaving, setConfigSaving] = useState(false);

  const loadConnectors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await connectorsApi.getConnectors();
      setConnectors(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载连接器失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConnectors();
  }, [loadConnectors]);

  const loadInstances = useCallback(async (connectorId: string) => {
    setInstancesLoading(true);
    try {
      const data = await connectorsApi.getInstances(connectorId);
      setInstances(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载实例失败');
    } finally {
      setInstancesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedConnector) {
      loadInstances(selectedConnector.id);
    } else {
      setInstances([]);
      setSelectedInstance(null);
    }
  }, [selectedConnector, loadInstances]);

  const handleSelectConnector = (connector: ConnectorDefinition) => {
    setSelectedConnector(connector);
    setSelectedInstance(null);
    setConfigText('');
    setConfigError(null);
  };

  const handleBackToList = () => {
    setSelectedConnector(null);
    setSelectedInstance(null);
    setInstances([]);
    setConfigText('');
    setConfigError(null);
  };

  const handleSelectInstance = (instance: ConnectorInstance) => {
    setSelectedInstance(instance);
    setConfigText(JSON.stringify(instance.config ?? {}, null, 2));
    setConfigError(null);
  };

  const handleConfigChange = (value: string) => {
    setConfigText(value);
    try {
      JSON.parse(value);
      setConfigError(null);
    } catch {
      setConfigError('无效的 JSON 格式');
    }
  };

  const handleUpdateConfig = async () => {
    if (!selectedConnector || !selectedInstance) return;
    if (configError) return;

    setConfigSaving(true);
    try {
      const newConfig = JSON.parse(configText);
      const updated = await connectorsApi.updateInstanceConfig(
        selectedConnector.id,
        selectedInstance.id,
        newConfig
      );
      setSelectedInstance(updated);
      setInstances(prev =>
        prev.map(inst => (inst.id === updated.id ? updated : inst))
      );
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : '更新配置失败');
    } finally {
      setConfigSaving(false);
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'active':
        return 'healthy';
      case 'draft':
        return 'degraded';
      case 'deprecated':
      case 'inactive':
        return 'error';
      default:
        return '';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active':
        return '活跃';
      case 'draft':
        return '草稿';
      case 'deprecated':
        return '已弃用';
      case 'inactive':
        return '未激活';
      default:
        return status;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'api':
        return 'API';
      case 'messaging':
        return '消息';
      case 'storage':
        return '存储';
      case 'database':
        return '数据库';
      case 'custom':
        return '自定义';
      default:
        return type;
    }
  };

  if (selectedConnector) {
    return (
      <div data-testid="connectors-panel" className="connectors-panel">
        <section className="connectors-sidebar">
          <div className="connectors-sidebar-header">
            <button
              className="secondary-button"
              onClick={handleBackToList}
              data-testid="connector-back"
            >
              ← 返回列表
            </button>
          </div>
          <div className="connectors-detail-info">
            <h3 data-testid="connector-detail-name">{selectedConnector.name}</h3>
            <div className="connector-meta">
              <span className="connector-type-badge" data-testid="connector-detail-type">
                {getTypeLabel(selectedConnector.connectorType)}
              </span>
              <span className="version-badge" data-testid="connector-detail-version">
                v{selectedConnector.version}
              </span>
              <span className={`status-chip ${getStatusClass(selectedConnector.status)}`} data-testid="connector-detail-status">
                {getStatusLabel(selectedConnector.status)}
              </span>
            </div>
            {selectedConnector.description && (
              <p className="connector-description" data-testid="connector-detail-description">
                {selectedConnector.description}
              </p>
            )}
            <div className="connector-capabilities" data-testid="connector-detail-capabilities">
              <h4>能力</h4>
              <div className="capability-tags">
                {selectedConnector.capabilities.map(cap => (
                  <span key={cap} className="capability-tag">{cap}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="connectors-main">
          <div className="connectors-main-header">
            <h3>实例</h3>
          </div>

          {instancesLoading ? (
            <LoadingSpinner size="small" label="加载实例..." />
          ) : error ? (
            <div className="connectors-error" data-testid="instances-error">{error}</div>
          ) : instances.length === 0 ? (
            <div className="empty-state" data-testid="instances-empty">暂无实例</div>
          ) : (
            <div className="connectors-instances-list">
              {instances.map(instance => (
                <button
                  key={instance.id}
                  className={`connectors-instance-card ${selectedInstance?.id === instance.id ? 'active' : ''}`}
                  onClick={() => handleSelectInstance(instance)}
                  data-testid={`instance-${instance.id}`}
                >
                  <span className="instance-name">{instance.name}</span>
                  <span className={`status-chip ${getStatusClass(instance.status)}`}>
                    {getStatusLabel(instance.status)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {selectedInstance && (
            <div className="connectors-config-panel" data-testid="config-panel">
              <div className="config-panel-header">
                <h4>实例配置: {selectedInstance.name}</h4>
              </div>
              <div className="config-panel-body">
                <div className="form-group">
                  <label htmlFor="instance-config">配置 (JSON)</label>
                  <textarea
                    id="instance-config"
                    className="input-field config-textarea"
                    value={configText}
                    onChange={e => handleConfigChange(e.target.value)}
                    rows={10}
                    data-testid="config-textarea"
                  />
                </div>
                {configError && (
                  <div className="config-error" data-testid="config-error">{configError}</div>
                )}
                <button
                  className="primary-button"
                  onClick={handleUpdateConfig}
                  disabled={configSaving || !!configError}
                  data-testid="config-update-btn"
                >
                  {configSaving ? '保存中...' : '更新配置'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div data-testid="connectors-panel" className="connectors-panel">
      <section className="connectors-list-section">
        <div className="connectors-list-header">
          <h3>连接器</h3>
        </div>

        {loading ? (
          <LoadingSpinner label="加载连接器..." />
        ) : error ? (
          <div className="connectors-error" data-testid="connectors-error">{error}</div>
        ) : connectors.length === 0 ? (
          <div className="empty-state" data-testid="connectors-empty">暂无连接器</div>
        ) : (
          <div className="connectors-list">
            {connectors.map(connector => (
              <button
                key={connector.id}
                className="connectors-card"
                onClick={() => handleSelectConnector(connector)}
                data-testid={`connector-${connector.id}`}
              >
                <div className="connector-card-header">
                  <span className="connector-name">{connector.name}</span>
                  <span className={`status-chip ${getStatusClass(connector.status)}`}>
                    {getStatusLabel(connector.status)}
                  </span>
                </div>
                <div className="connector-card-meta">
                  <span className="connector-type">{getTypeLabel(connector.connectorType)}</span>
                  <span className="version-badge">v{connector.version}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default ConnectorsTab;
