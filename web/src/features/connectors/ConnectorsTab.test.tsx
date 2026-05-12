import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ConnectorsTab from './ConnectorsTab';
import * as connectorsApi from '../../api/connectors';
import type { ConnectorDefinition, ConnectorInstance } from '../../api/connectors';

vi.mock('../../api/connectors');

function makeConnector(overrides: Partial<ConnectorDefinition> = {}): ConnectorDefinition {
  return {
    id: 'conn-1',
    connectorId: 'gmail',
    name: 'Gmail Connector',
    connectorType: 'api',
    version: '1.0.0',
    description: 'Gmail integration',
    capabilities: ['email.read', 'email.send'],
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeInstance(overrides: Partial<ConnectorInstance> = {}): ConnectorInstance {
  return {
    id: 'inst-1',
    connectorInstanceId: 'gmail-inst-1',
    connectorDefinitionId: 'conn-1',
    userId: 'user-1',
    name: 'My Gmail',
    authStateRef: 'auth-ref-1',
    config: { label: 'work' },
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ConnectorsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(connectorsApi.getConnectors).mockResolvedValue([]);
  });

  it('renders the connectors panel', async () => {
    render(<ConnectorsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('connectors-panel')).toBeInTheDocument();
    });
  });

  it('shows empty state when no connectors exist', async () => {
    render(<ConnectorsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('connectors-empty')).toBeInTheDocument();
    });
    expect(screen.getByText('暂无连接器')).toBeInTheDocument();
  });

  it('renders connector list from mock API', async () => {
    const connectors = [
      makeConnector({ id: 'conn-1', name: 'Gmail' }),
      makeConnector({ id: 'conn-2', name: 'Calendar', connectorId: 'calendar' }),
    ];
    vi.mocked(connectorsApi.getConnectors).mockResolvedValue(connectors);

    render(<ConnectorsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('connector-conn-1')).toBeInTheDocument();
    });

    expect(screen.getByText('Gmail')).toBeInTheDocument();
    expect(screen.getByText('Calendar')).toBeInTheDocument();
  });

  it('shows loading state', async () => {
    vi.mocked(connectorsApi.getConnectors).mockImplementation(
      () => new Promise(() => undefined)
    );

    render(<ConnectorsTab />);
    expect(screen.getByTestId('connectors-loading')).toBeInTheDocument();
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  it('shows error state on API failure', async () => {
    vi.mocked(connectorsApi.getConnectors).mockRejectedValue(new Error('Network error'));

    render(<ConnectorsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('connectors-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('clicks connector to show detail view with manifest', async () => {
    const connector = makeConnector({
      capabilities: ['email.read', 'email.send', 'email.delete'],
    });
    vi.mocked(connectorsApi.getConnectors).mockResolvedValue([connector]);
    vi.mocked(connectorsApi.getInstances).mockResolvedValue([]);

    render(<ConnectorsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('connector-conn-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('connector-conn-1'));

    await waitFor(() => {
      expect(screen.getByTestId('connector-detail-name')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByTestId('instances-loading')).not.toBeInTheDocument();
    });

    expect(screen.getByText('Gmail Connector')).toBeInTheDocument();
    expect(screen.getByTestId('connector-detail-type')).toHaveTextContent('API');
    expect(screen.getByTestId('connector-detail-version')).toHaveTextContent('v1.0.0');
    expect(screen.getByTestId('connector-detail-status')).toHaveTextContent('活跃');
    expect(screen.getByTestId('connector-detail-capabilities')).toBeInTheDocument();
    expect(screen.getByText('email.read')).toBeInTheDocument();
    expect(screen.getByText('email.send')).toBeInTheDocument();
    expect(screen.getByText('email.delete')).toBeInTheDocument();
  });

  it('shows instances in detail view', async () => {
    const connector = makeConnector();
    const instances = [
      makeInstance({ id: 'inst-1', name: 'Work Gmail' }),
      makeInstance({ id: 'inst-2', name: 'Personal Gmail', connectorInstanceId: 'gmail-inst-2' }),
    ];
    vi.mocked(connectorsApi.getConnectors).mockResolvedValue([connector]);
    vi.mocked(connectorsApi.getInstances).mockResolvedValue(instances);

    render(<ConnectorsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('connector-conn-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('connector-conn-1'));

    await waitFor(() => {
      expect(screen.getByTestId('instance-inst-1')).toBeInTheDocument();
    });

    expect(screen.getByText('Work Gmail')).toBeInTheDocument();
    expect(screen.getByText('Personal Gmail')).toBeInTheDocument();
  });

  it('instance config section renders and is editable', async () => {
    const connector = makeConnector();
    const instance = makeInstance({ config: { label: 'work', sync: true } });
    vi.mocked(connectorsApi.getConnectors).mockResolvedValue([connector]);
    vi.mocked(connectorsApi.getInstances).mockResolvedValue([instance]);

    render(<ConnectorsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('connector-conn-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('connector-conn-1'));
    await waitFor(() => {
      expect(screen.getByTestId('instance-inst-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('instance-inst-1'));

    await waitFor(() => {
      expect(screen.getByTestId('config-panel')).toBeInTheDocument();
    });

    const textarea = screen.getByTestId('config-textarea');
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue(JSON.stringify({ label: 'work', sync: true }, null, 2));

    fireEvent.change(textarea, { target: { value: '{"newKey": "newValue"}' } });

    expect(textarea).toHaveValue('{"newKey": "newValue"}');
  });

  it('validates JSON in config textarea', async () => {
    const connector = makeConnector();
    const instance = makeInstance();
    vi.mocked(connectorsApi.getConnectors).mockResolvedValue([connector]);
    vi.mocked(connectorsApi.getInstances).mockResolvedValue([instance]);

    render(<ConnectorsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('connector-conn-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('connector-conn-1'));
    await waitFor(() => {
      expect(screen.getByTestId('instance-inst-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('instance-inst-1'));

    await waitFor(() => {
      expect(screen.getByTestId('config-textarea')).toBeInTheDocument();
    });

    const textarea = screen.getByTestId('config-textarea');
    fireEvent.change(textarea, { target: { value: 'invalid json' } });

    expect(screen.getByTestId('config-error')).toBeInTheDocument();
    expect(screen.getByText('无效的 JSON 格式')).toBeInTheDocument();
  });

  it('updates instance config on button click', async () => {
    const connector = makeConnector();
    const instance = makeInstance();
    const updatedInstance = { ...instance, config: { newKey: 'newValue' } };
    vi.mocked(connectorsApi.getConnectors).mockResolvedValue([connector]);
    vi.mocked(connectorsApi.getInstances).mockResolvedValue([instance]);
    vi.mocked(connectorsApi.updateInstanceConfig).mockResolvedValue(updatedInstance);

    render(<ConnectorsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('connector-conn-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('connector-conn-1'));
    await waitFor(() => {
      expect(screen.getByTestId('instance-inst-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('instance-inst-1'));

    await waitFor(() => {
      expect(screen.getByTestId('config-textarea')).toBeInTheDocument();
    });

    const textarea = screen.getByTestId('config-textarea');
    fireEvent.change(textarea, { target: { value: '{"newKey": "newValue"}' } });

    fireEvent.click(screen.getByTestId('config-update-btn'));

    await waitFor(() => {
      expect(connectorsApi.updateInstanceConfig).toHaveBeenCalledWith(
        'conn-1',
        'inst-1',
        { newKey: 'newValue' }
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('config-update-btn')).toHaveTextContent('更新配置');
    });
  });

  it('returns to list from detail view', async () => {
    const connector = makeConnector();
    vi.mocked(connectorsApi.getConnectors).mockResolvedValue([connector]);
    vi.mocked(connectorsApi.getInstances).mockResolvedValue([]);

    render(<ConnectorsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('connector-conn-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('connector-conn-1'));

    await waitFor(() => {
      expect(screen.getByTestId('connector-detail-name')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByTestId('instances-loading')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('connector-back'));

    await waitFor(() => {
      expect(screen.getByTestId('connector-conn-1')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('connector-detail-name')).not.toBeInTheDocument();
  });

  it('shows empty state for instances', async () => {
    const connector = makeConnector();
    vi.mocked(connectorsApi.getConnectors).mockResolvedValue([connector]);
    vi.mocked(connectorsApi.getInstances).mockResolvedValue([]);

    render(<ConnectorsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('connector-conn-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('connector-conn-1'));

    await waitFor(() => {
      expect(screen.getByTestId('instances-empty')).toBeInTheDocument();
    });
    expect(screen.getByText('暂无实例')).toBeInTheDocument();
  });

  it('displays different connector types correctly', async () => {
    const connectors = [
      makeConnector({ id: 'conn-1', connectorType: 'messaging', name: 'Slack' }),
      makeConnector({ id: 'conn-2', connectorType: 'storage', name: 'S3' }),
      makeConnector({ id: 'conn-3', connectorType: 'database', name: 'PostgreSQL' }),
      makeConnector({ id: 'conn-4', connectorType: 'custom', name: 'Custom' }),
    ];
    vi.mocked(connectorsApi.getConnectors).mockResolvedValue(connectors);

    render(<ConnectorsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('connector-conn-1')).toBeInTheDocument();
    });

    expect(screen.getByText('消息')).toBeInTheDocument();
    expect(screen.getByText('存储')).toBeInTheDocument();
    expect(screen.getByText('数据库')).toBeInTheDocument();
    expect(screen.getByText('自定义')).toBeInTheDocument();
  });

  it('displays different connector statuses correctly', async () => {
    const connectors = [
      makeConnector({ id: 'conn-1', status: 'active', name: 'Active' }),
      makeConnector({ id: 'conn-2', status: 'draft', name: 'Draft' }),
      makeConnector({ id: 'conn-3', status: 'deprecated', name: 'Deprecated' }),
      makeConnector({ id: 'conn-4', status: 'inactive', name: 'Inactive' }),
    ];
    vi.mocked(connectorsApi.getConnectors).mockResolvedValue(connectors);

    render(<ConnectorsTab />);
    await waitFor(() => {
      expect(screen.getByTestId('connector-conn-1')).toBeInTheDocument();
    });

    expect(screen.getByText('活跃')).toBeInTheDocument();
    expect(screen.getByText('草稿')).toBeInTheDocument();
    expect(screen.getByText('已弃用')).toBeInTheDocument();
    expect(screen.getByText('未激活')).toBeInTheDocument();
  });
});
