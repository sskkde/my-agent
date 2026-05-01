import React, { useEffect, useState } from 'react';
import { getChannels } from '../../api/client';
import type { ChannelSummary } from '../../api/types';

interface ChannelsData {
  channels: ChannelSummary[];
  loading: boolean;
  error: boolean;
}

const ChannelsTab: React.FC = () => {
  const [data, setData] = useState<ChannelsData>({
    channels: [],
    loading: true,
    error: false,
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await getChannels();
        setData({
          channels: response.channels,
          loading: false,
          error: false,
        });
      } catch {
        setData({
          channels: [],
          loading: false,
          error: true,
        });
      }
    };

    fetchData();
  }, []);

  const { channels, loading, error } = data;

  const getStatusClass = (status: string): string => {
    switch (status.toLowerCase()) {
      case 'connected':
      case 'active':
        return 'status-chip healthy';
      case 'disconnected':
      case 'inactive':
        return 'status-chip error';
      default:
        return 'status-chip degraded';
    }
  };

  return (
    <div data-testid="channels-panel" className="channels-panel">
      <div className="content-header">
        <h2>通道</h2>
      </div>

      <div className="content-body">
        {loading && (
          <div className="channels-loading" data-testid="channels-loading">
            加载中...
          </div>
        )}

        {error && (
          <div className="channels-error" data-testid="channels-error">
            无法加载通道数据
          </div>
        )}

        {!loading && !error && channels.length === 0 && (
          <div className="channels-empty-state" data-testid="channels-empty-state">
            <p>暂无通道配置</p>
          </div>
        )}

        {!loading && !error && channels.length > 0 && (
          <>
            {/* Desktop Table - hidden on phone */}
            <div className="channels-table-container" data-testid="channels-table-container">
              <table className="channels-table" data-testid="channels-table">
                <thead>
                  <tr>
                    <th className="col-connector">连接器 ID</th>
                    <th className="col-type">类型</th>
                    <th className="col-status">状态</th>
                    <th className="col-configured">已配置</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((channel, index) => (
                    <tr key={channel.connectorId} data-testid={`channel-row-${index}`}>
                      <td className="cell-connector">{channel.connectorId}</td>
                      <td className="cell-type">{channel.type}</td>
                      <td className="cell-status">
                        <span className={getStatusClass(channel.status)}>
                          {channel.status}
                        </span>
                      </td>
                      <td className="cell-configured">
                        {channel.configured ? (
                          <span className="checkmark-yes" data-testid={`channel-configured-${index}`}>✓</span>
                        ) : (
                          <span className="checkmark-no">✗</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards - visible only on phone */}
            <div className="channels-mobile-list" data-testid="channels-mobile-list">
              {channels.map((channel, index) => (
                <div key={channel.connectorId} className="channel-card" data-testid={`channel-card-${index}`}>
                  <div className="channel-card__row">
                    <span className="channel-card__label">连接器 ID</span>
                    <span className="channel-card__value channel-card__value--mono">{channel.connectorId}</span>
                  </div>
                  <div className="channel-card__row">
                    <span className="channel-card__label">类型</span>
                    <span className="channel-card__value">{channel.type}</span>
                  </div>
                  <div className="channel-card__row">
                    <span className="channel-card__label">状态</span>
                    <span className={getStatusClass(channel.status)}>
                      {channel.status}
                    </span>
                  </div>
                  <div className="channel-card__row">
                    <span className="channel-card__label">已配置</span>
                    <span className="channel-card__value">
                      {channel.configured ? (
                        <span className="checkmark-yes">✓</span>
                      ) : (
                        <span className="checkmark-no">✗</span>
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ChannelsTab;
