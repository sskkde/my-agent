import React, { useEffect, useState } from 'react';
import { getHealth, getRuns } from '../../api/client';
import type { HealthResponse, RunsResponse } from '../../api/types';

interface DashboardData {
  health: HealthResponse | null;
  runs: RunsResponse | null;
  healthError: boolean;
}

const DashboardTab: React.FC = () => {
  const [data, setData] = useState<DashboardData>({
    health: null,
    runs: null,
    healthError: false,
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const health = await getHealth();
        setData((prev) => ({ ...prev, health, healthError: false }));
      } catch {
        setData((prev) => ({ ...prev, healthError: true }));
      }

      try {
        const runs = await getRuns();
        setData((prev) => ({ ...prev, runs }));
      } catch {
        setData((prev) => ({ ...prev, runs: { runs: [], total: 0 } }));
      }
    };

    fetchData();
  }, []);

  const { health, runs, healthError } = data;
  const activeRunsCount = runs?.runs.filter((r) => r.status === 'running').length ?? 0;

  const getStatusText = () => {
    if (healthError) return '异常';
    if (!health) return '加载中...';
    return health.status === 'healthy' ? '健康' : '降级';
  };

  const getStatusClass = () => {
    if (healthError) return 'status-error';
    if (!health) return 'status-loading';
    return health.status === 'healthy' ? 'status-healthy' : 'status-degraded';
  };

  return (
    <div className="dashboard-tab">
      <div className="dashboard-section">
        <h3>系统状态</h3>
        <div
          className={`health-status ${getStatusClass()}`}
          data-testid="dashboard-health-status"
        >
          {getStatusText()}
        </div>
      </div>

      {health && (
        <div className="dashboard-section">
          <h3>模块状态</h3>
          <div className="module-chips" data-testid="dashboard-modules">
            {Object.entries(health.modules).map(([name, moduleHealth]) => (
              <span
                key={name}
                className={`module-chip ${moduleHealth.status}`}
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="dashboard-section">
        <h3>运行任务</h3>
        <div className="runs-count" data-testid="dashboard-runs-count">
          {activeRunsCount}
        </div>
      </div>

      {runs && runs.runs.length === 0 && (
        <div
          className="dashboard-empty-state"
          data-testid="dashboard-empty-state"
        >
          暂无运行中的任务
        </div>
      )}
    </div>
  );
};

export default DashboardTab;