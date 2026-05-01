import React, { useEffect, useState } from 'react';
import { getInstances } from '../../api/client';
import type { InstanceSummary } from '../../api/types';

interface InstancesData {
  instances: InstanceSummary[];
  loading: boolean;
  error: boolean;
}

const formatUptime = (seconds?: number): string => {
  if (seconds === undefined || seconds === null) return '-';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

const InstancesTab: React.FC = () => {
  const [data, setData] = useState<InstancesData>({
    instances: [],
    loading: true,
    error: false,
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await getInstances();
        setData({
          instances: response.instances,
          loading: false,
          error: false,
        });
      } catch {
        setData({
          instances: [],
          loading: false,
          error: true,
        });
      }
    };

    fetchData();
  }, []);

  const { instances, loading, error } = data;

  const getStatusClass = (status: string): string => {
    switch (status) {
      case 'healthy':
        return 'status-chip healthy';
      case 'degraded':
        return 'status-chip degraded';
      default:
        return 'status-chip error';
    }
  };

  const getStatusText = (status: string): string => {
    switch (status) {
      case 'healthy':
        return '健康';
      case 'degraded':
        return '降级';
      default:
        return '异常';
    }
  };

  return (
    <div data-testid="instances-panel" className="instances-panel">
      <div className="content-header">
        <h2>实例</h2>
      </div>

      <div className="content-body">
        {loading && (
          <div className="instances-loading" data-testid="instances-loading">
            加载中...
          </div>
        )}

        {error && (
          <div className="instances-error" data-testid="instances-error">
            无法加载实例数据
          </div>
        )}

        {!loading && !error && instances.length === 0 && (
          <div className="instances-empty-state" data-testid="instances-empty-state">
            <p>暂无实例配置</p>
          </div>
        )}

        {!loading && !error && instances.length > 0 && (
          <div className="instances-list" data-testid="instances-list">
            {instances.map((instance, index) => (
              <div
                key={index}
                className="instance-card"
                data-testid={`instance-card-${index}`}
              >
                <div className="instance-header">
                  <span className="instance-type">{instance.type}</span>
                  <span className={getStatusClass(instance.status)}>
                    {getStatusText(instance.status)}
                  </span>
                </div>
                <div className="instance-details">
                  <div className="instance-detail">
                    <span className="detail-label">运行时间:</span>
                    <span className="detail-value">{formatUptime(instance.uptime)}</span>
                  </div>
                  <div className="instance-detail">
                    <span className="detail-label">API 端口:</span>
                    <span className="detail-value">{instance.apiPort}</span>
                  </div>
                  <div className="instance-detail">
                    <span className="detail-label">存储状态:</span>
                    <span className="detail-value">{instance.storeStatus}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default InstancesTab;
