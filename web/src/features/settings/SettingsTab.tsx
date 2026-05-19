import React, { useEffect, useState } from 'react';
import { getSettings } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import ProviderManager from './ProviderManager';
import type { SettingsConfig } from '../../api/types';
import LoadingSpinner from '../../components/LoadingSpinner';

interface SettingsData {
  settings: SettingsConfig | null;
  loading: boolean;
  error: boolean;
}

const SettingsTab: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const [data, setData] = useState<SettingsData>({
    settings: null,
    loading: true,
    error: false,
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await getSettings();
        setData({
          settings: response.settings,
          loading: false,
          error: false,
        });
      } catch {
        setData({
          settings: null,
          loading: false,
          error: true,
        });
      }
    };

    fetchData();
  }, []);

  const { settings, loading, error } = data;

  return (
    <div data-testid="settings-panel" className="settings-panel">
      <div className="content-header">
        <h2>设置</h2>
      </div>

      <div className="content-body">
        {loading && (
          <div className="settings-loading" data-testid="settings-loading">
            <LoadingSpinner label="加载设置..." />
          </div>
        )}

        {error && (
          <div className="settings-error" data-testid="settings-error">
            无法加载设置数据
          </div>
        )}

        {!loading && !error && settings && (
          <div className="settings-content" data-testid="settings-content">
            <div className="settings-section">
              <h3>基本设置</h3>
              <div className="setting-item">
                <span className="setting-label">本地模式:</span>
                <span className="setting-value">
                  {settings.localOnly ? (
                    <span className="checkmark-yes" data-testid="local-only-yes">✓ 是</span>
                  ) : (
                    <span className="checkmark-no">✗ 否</span>
                  )}
                </span>
              </div>
              <div className="setting-item">
                <span className="setting-label">数据保留天数:</span>
                <span className="setting-value" data-testid="retention-days">
                  {settings.retentionDays} 天
                </span>
              </div>
            </div>

            <ProviderManager isAuthenticated={isAuthenticated} />

            <div className="settings-notice" data-testid="settings-notice">
              <p>安全提示: API 密钥和敏感配置信息不会在此显示</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsTab;
