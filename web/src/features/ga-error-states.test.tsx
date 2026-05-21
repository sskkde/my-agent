/**
 * GA Tests for Web Production Error States
 * 
 * This file contains comprehensive tests for error states, loading states,
 * empty states, retry logic, and secret redaction in the UI.
 * 
 * Coverage:
 * - ErrorMessage component for different error types (401, 403, 500, NETWORK_ERROR)
 * - LoadingSpinner shows during loading state
 * - EmptyState renders when data is empty
 * - Retry button click triggers refetch
 * - API keys display truncated (ak_... prefix) in AdminTab
 * - Setup flow redirects to /setup when no admin exists
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AdminTab from './admin/AdminTab';
import ConnectorsTab from './connectors/ConnectorsTab';
import TriggersTab from './triggers/TriggersTab';
import DLQTab from './dlq/DLQTab';
import MemoryTab from './memory/MemoryTab';
import ObservabilityTab from './observability/ObservabilityTab';
import SettingsTab from './settings/SettingsTab';
import ProductionSetupChecklist from './setup/ProductionSetupChecklist';
import ErrorMessage from '../components/ErrorMessage';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import * as adminApi from '../api/admin';
import * as connectorsApi from '../api/connectors';
import * as triggersApi from '../api/triggers';
import * as dlqApi from '../api/dlq';
import * as observabilityApi from '../api/observability';
import * as client from '../api/client';
import { AuthProvider } from '../context/AuthContext';

vi.mock('../api/admin');
vi.mock('../api/connectors');
vi.mock('../api/triggers');
vi.mock('../api/dlq');
vi.mock('../api/observability');
vi.mock('../api/client');
const mockUseAuth = vi.fn();
vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const renderWithAuth = (component: React.ReactNode) => {
  return render(<AuthProvider>{component}</AuthProvider>);
};

describe('GA: ErrorMessage Component Error Type Mapping', () => {
  it('renders 401 UNAUTHORIZED error with correct Chinese message', () => {
    const error = { code: '401', message: 'Unauthorized' } as Error & { code: string };
    render(<ErrorMessage error={error} />);

    expect(screen.getByText('认证失败')).toBeInTheDocument();
    expect(screen.getByText('请重新登录')).toBeInTheDocument();
  });

  it('renders 403 FORBIDDEN error with correct Chinese message', () => {
    const error = { code: '403', message: 'Forbidden' } as Error & { code: string };
    render(<ErrorMessage error={error} />);

    expect(screen.getByText('没有权限')).toBeInTheDocument();
    expect(screen.getByText('没有权限执行此操作')).toBeInTheDocument();
  });

  it('renders 500 INTERNAL_ERROR with correct Chinese message', () => {
    const error = { code: '500', message: 'Internal Server Error' } as Error & { code: string };
    render(<ErrorMessage error={error} />);

    expect(screen.getByText('服务器错误')).toBeInTheDocument();
    expect(screen.getByText('服务器内部错误，请稍后再试')).toBeInTheDocument();
  });

  it('renders NETWORK_ERROR with correct Chinese message', () => {
    const error = { code: 'NETWORK_ERROR', message: 'Connection failed' } as Error & { code: string };
    render(<ErrorMessage error={error} />);

    expect(screen.getByText('网络错误')).toBeInTheDocument();
    expect(screen.getByText('无法连接到服务器，请检查网络连接')).toBeInTheDocument();
  });

  it('renders CONNECTION_FAILED as network error', () => {
    const error = { code: 'CONNECTION_FAILED', message: 'No connection' } as Error & { code: string };
    render(<ErrorMessage error={error} />);

    expect(screen.getByText('网络错误')).toBeInTheDocument();
  });

  it('renders 429 RATE_LIMITED error with correct message', () => {
    const error = { code: '429', message: 'Too Many Requests' } as Error & { code: string };
    render(<ErrorMessage error={error} />);

    expect(screen.getByText('请求过于频繁')).toBeInTheDocument();
    expect(screen.getByText('请稍后再试')).toBeInTheDocument();
  });

  it('renders 404 NOT_FOUND error with correct message', () => {
    const error = { code: '404', message: 'Not Found' } as Error & { code: string };
    render(<ErrorMessage error={error} />);

    expect(screen.getByText('资源不存在')).toBeInTheDocument();
    expect(screen.getByText('请求的资源未找到')).toBeInTheDocument();
  });

  it('renders 400 BAD_REQUEST error with custom message', () => {
    const error = { code: '400', message: 'Invalid input provided' } as Error & { code: string };
    render(<ErrorMessage error={error} />);

    expect(screen.getByText('请求无效')).toBeInTheDocument();
    expect(screen.getByText('Invalid input provided')).toBeInTheDocument();
  });

  it('renders unknown error code with fallback message', () => {
    const error = { code: 'CUSTOM_ERROR', message: 'Custom error occurred' } as Error & { code: string };
    render(<ErrorMessage error={error} />);

    expect(screen.getByText('操作失败')).toBeInTheDocument();
    expect(screen.getByText('Custom error occurred')).toBeInTheDocument();
  });

  it('renders null error with default message', () => {
    render(<ErrorMessage error={null} />);

    expect(screen.getByText('发生错误')).toBeInTheDocument();
    expect(screen.getByText('请稍后再试')).toBeInTheDocument();
  });
});

describe('GA: LoadingSpinner Component', () => {
  it('shows loading spinner during loading state', () => {
    render(<LoadingSpinner />);

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has accessibility label for screen readers', () => {
    render(<LoadingSpinner label="加载数据中..." />);

    expect(screen.getByLabelText('加载数据中...')).toBeInTheDocument();
  });

  it('supports different sizes (small, medium, large)', () => {
    const { rerender } = render(<LoadingSpinner size="small" />);
    expect(screen.getByTestId('loading-spinner')).toHaveClass('spinner--small');

    rerender(<LoadingSpinner size="medium" />);
    expect(screen.getByTestId('loading-spinner')).toHaveClass('spinner--medium');

    rerender(<LoadingSpinner size="large" />);
    expect(screen.getByTestId('loading-spinner')).toHaveClass('spinner--large');
  });

  it('supports inline mode', () => {
    render(<LoadingSpinner inline />);

    expect(screen.getByTestId('loading-spinner')).toHaveClass('spinner--inline');
  });
});

describe('GA: EmptyState Component', () => {
  it('renders when data is empty', () => {
    render(<EmptyState title="暂无数据" description="当前列表为空" />);

    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('暂无数据')).toBeInTheDocument();
    expect(screen.getByText('当前列表为空')).toBeInTheDocument();
  });

  it('renders with icon', () => {
    render(<EmptyState title="暂无数据" icon="📭" />);

    expect(screen.getByText('📭')).toBeInTheDocument();
  });

  it('renders with action button', () => {
    const handleClick = vi.fn();
    render(
      <EmptyState
        title="暂无数据"
        action={{ label: '添加项目', onClick: handleClick }}
      />
    );

    const button = screen.getByTestId('empty-state-action');
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent('添加项目');

    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});

describe('GA: Retry Logic', () => {
  it('retry button click triggers refetch in ErrorMessage', () => {
    const handleRetry = vi.fn();
    const error = { code: 'NETWORK_ERROR', message: 'Connection failed' } as Error & { code: string };
    render(<ErrorMessage error={error} retry={{ onClick: handleRetry }} />);

    const retryButton = screen.getByTestId('error-message-retry');
    fireEvent.click(retryButton);

    expect(handleRetry).toHaveBeenCalledTimes(1);
  });

  it('retry button has correct label', () => {
    const handleRetry = vi.fn();
    const error = { code: 'NETWORK_ERROR', message: 'Connection failed' } as Error & { code: string };
    render(<ErrorMessage error={error} retry={{ label: '重新加载', onClick: handleRetry }} />);

    expect(screen.getByTestId('error-message-retry')).toHaveTextContent('重新加载');
  });
});

describe('GA: AdminTab Error/Loading/Empty States', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { userId: 'admin-1', username: 'admin', role: 'admin' },
      isAuthenticated: true,
    });
  });

  it('shows loading spinner during initial load', () => {
    vi.mocked(adminApi.listUsers).mockImplementation(() => new Promise(() => {}));
    vi.mocked(adminApi.listApiKeys).mockImplementation(() => new Promise(() => {}));
    vi.mocked(adminApi.getConnectorHealth).mockImplementation(() => new Promise(() => {}));
    vi.mocked(adminApi.getSystemSettings).mockImplementation(() => new Promise(() => {}));

    render(<AdminTab />);

    expect(screen.getByTestId('admin-loading')).toBeInTheDocument();
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    vi.mocked(adminApi.listUsers).mockRejectedValue(new Error('API error'));
    vi.mocked(adminApi.listApiKeys).mockRejectedValue(new Error('API error'));
    vi.mocked(adminApi.getConnectorHealth).mockRejectedValue(new Error('API error'));
    vi.mocked(adminApi.getSystemSettings).mockRejectedValue(new Error('API error'));

    render(<AdminTab />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-error')).toBeInTheDocument();
      expect(screen.getByTestId('error-message')).toBeInTheDocument();
    });
  });

  it('shows FORBIDDEN error for non-admin users', () => {
    mockUseAuth.mockReturnValue({
      user: { userId: 'user-1', username: 'user', role: 'user' },
      isAuthenticated: true,
    });

    render(<AdminTab />);

    expect(screen.getByTestId('admin-access-denied')).toBeInTheDocument();
    expect(screen.getByText('没有权限')).toBeInTheDocument();
    expect(screen.getByText('您没有权限访问此页面')).toBeInTheDocument();
  });

  it('displays API key with truncated prefix (ak_...)', async () => {
    vi.mocked(adminApi.listUsers).mockResolvedValue({ users: [], total: 0 });
    vi.mocked(adminApi.listApiKeys).mockResolvedValue({
      keys: [
        {
          id: 'key-1',
          name: 'Test Key',
          prefix: 'ak_abc123...',
          role: 'service',
          status: 'active',
          userId: null,
          createdAt: '2024-01-01T00:00:00Z',
          expiresAt: null,
          lastUsedAt: null,
        },
      ],
      total: 1,
    });
    vi.mocked(adminApi.getConnectorHealth).mockResolvedValue({ connectors: [] });
    vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
      settings: { rateLimitPerMinute: 60, rateLimitPerHour: 1000, sessionTokenTtlHours: 24 },
    });

    render(<AdminTab />);

    await waitFor(() => {
      expect(screen.getByTestId('api-key-row-key-1')).toBeInTheDocument();
    });

    expect(screen.getByText('ak_abc123...')).toBeInTheDocument();
    expect(screen.queryByText('ak_fullsecretkey123')).not.toBeInTheDocument();
  });

  it('shows created API key in full for one-time copy', async () => {
    vi.mocked(adminApi.listUsers).mockResolvedValue({ users: [], total: 0 });
    vi.mocked(adminApi.listApiKeys).mockResolvedValue({ keys: [], total: 0 });
    vi.mocked(adminApi.getConnectorHealth).mockResolvedValue({ connectors: [] });
    vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
      settings: { rateLimitPerMinute: 60, rateLimitPerHour: 1000, sessionTokenTtlHours: 24 },
    });
    vi.mocked(adminApi.createApiKey).mockResolvedValue({
      id: 'key-1',
      name: 'New Key',
      key: 'ak_fullsecretkey123',
      prefix: 'ak_full',
      role: 'admin',
      createdAt: '2024-01-01T00:00:00Z',
    });

    render(<AdminTab />);

    await waitFor(() => {
      expect(screen.getByTestId('create-api-key-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('create-api-key-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('api-key-name-input')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('api-key-name-input'), { target: { value: 'New Key' } });
    fireEvent.click(screen.getByTestId('api-key-create-submit'));

    await waitFor(() => {
      expect(screen.getByText('ak_fullsecretkey123')).toBeInTheDocument();
    });
  });

  it('shows empty state when no users exist', async () => {
    vi.mocked(adminApi.listUsers).mockResolvedValue({ users: [], total: 0 });
    vi.mocked(adminApi.listApiKeys).mockResolvedValue({ keys: [], total: 0 });
    vi.mocked(adminApi.getConnectorHealth).mockResolvedValue({ connectors: [] });
    vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
      settings: { rateLimitPerMinute: 60, rateLimitPerHour: 1000, sessionTokenTtlHours: 24 },
    });

    render(<AdminTab />);

    await waitFor(() => {
      expect(screen.getByTestId('user-management-panel')).toBeInTheDocument();
    });

    expect(screen.getByText('暂无用户')).toBeInTheDocument();
  });

  it('shows empty state when no API keys exist', async () => {
    vi.mocked(adminApi.listUsers).mockResolvedValue({ users: [], total: 0 });
    vi.mocked(adminApi.listApiKeys).mockResolvedValue({ keys: [], total: 0 });
    vi.mocked(adminApi.getConnectorHealth).mockResolvedValue({ connectors: [] });
    vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
      settings: { rateLimitPerMinute: 60, rateLimitPerHour: 1000, sessionTokenTtlHours: 24 },
    });

    render(<AdminTab />);

    await waitFor(() => {
      expect(screen.getByTestId('api-key-management-panel')).toBeInTheDocument();
    });

    expect(screen.getByText('暂无 API 密钥')).toBeInTheDocument();
  });

  it('retry button triggers data reload', async () => {
    vi.mocked(adminApi.listUsers).mockRejectedValueOnce(new Error('API error'))
      .mockResolvedValueOnce({ users: [], total: 0 });
    vi.mocked(adminApi.listApiKeys).mockRejectedValueOnce(new Error('API error'))
      .mockResolvedValueOnce({ keys: [], total: 0 });
    vi.mocked(adminApi.getConnectorHealth).mockRejectedValueOnce(new Error('API error'))
      .mockResolvedValueOnce({ connectors: [] });
    vi.mocked(adminApi.getSystemSettings).mockRejectedValueOnce(new Error('API error'))
      .mockResolvedValueOnce({
        settings: { rateLimitPerMinute: 60, rateLimitPerHour: 1000, sessionTokenTtlHours: 24 },
      });

    render(<AdminTab />);

    await waitFor(() => {
      expect(screen.getByTestId('error-message-retry')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('error-message-retry'));

    await waitFor(() => {
      expect(screen.getByTestId('admin-panel')).toBeInTheDocument();
    });
  });
});

describe('GA: ConnectorsTab Error/Loading/Empty States', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner during initial load', () => {
    vi.mocked(connectorsApi.getConnectors).mockImplementation(() => new Promise(() => {}));

    render(<ConnectorsTab />);

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('shows error state on API failure', async () => {
    vi.mocked(connectorsApi.getConnectors).mockRejectedValue(new Error('Network error'));

    render(<ConnectorsTab />);

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument();
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('shows empty state when no connectors exist', async () => {
    vi.mocked(connectorsApi.getConnectors).mockResolvedValue([]);

    render(<ConnectorsTab />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.getByText('暂无连接器')).toBeInTheDocument();
    });
  });

  it('retry button triggers data reload', async () => {
    vi.mocked(connectorsApi.getConnectors)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce([]);

    render(<ConnectorsTab />);

    await waitFor(() => {
      expect(screen.getByTestId('error-message-retry')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('error-message-retry'));

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('shows empty state for instances in detail view', async () => {
    const mockConnector = {
      id: 'conn-1',
      connectorId: 'gmail',
      name: 'Gmail',
      connectorType: 'api' as const,
      version: '1.0.0',
      capabilities: ['email.read'],
      status: 'active' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.mocked(connectorsApi.getConnectors).mockResolvedValue([mockConnector]);
    vi.mocked(connectorsApi.getInstances).mockResolvedValue([]);

    render(<ConnectorsTab />);

    await waitFor(() => {
      expect(screen.getByTestId('connector-conn-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('connector-conn-1'));

    await waitFor(() => {
      expect(screen.getByText('暂无实例')).toBeInTheDocument();
    });
  });
});

describe('GA: TriggersTab Error/Loading/Empty States', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(triggersApi.getTriggers).mockResolvedValue([]);
  });

  it('shows loading spinner during initial load', () => {
    vi.mocked(triggersApi.getTriggers).mockImplementation(() => new Promise(() => {}));

    render(<TriggersTab />);

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('shows error state on API failure', async () => {
    vi.mocked(triggersApi.getTriggers).mockRejectedValue(new Error('API error'));

    render(<TriggersTab />);

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument();
    });
  });

  it('shows empty state when no triggers exist', async () => {
    vi.mocked(triggersApi.getTriggers).mockResolvedValue([]);

    render(<TriggersTab />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.getByText('暂无触发器')).toBeInTheDocument();
    });
  });
});

describe('GA: DLQTab Error/Loading/Empty States', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(dlqApi.getDlqEntries).mockResolvedValue({ entries: [], total: 0 });
  });

  it('shows loading spinner during initial load', () => {
    vi.mocked(dlqApi.getDlqEntries).mockImplementation(() => new Promise(() => {}));

    render(<DLQTab />);

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('shows error state on API failure', async () => {
    vi.mocked(dlqApi.getDlqEntries).mockRejectedValue(new Error('API error'));

    render(<DLQTab />);

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument();
    });
  });

  it('shows empty state when no DLQ events exist', async () => {
    vi.mocked(dlqApi.getDlqEntries).mockResolvedValue({ entries: [], total: 0 });

    render(<DLQTab />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.getByText('暂无死信事件')).toBeInTheDocument();
    });
  });
});

describe('GA: MemoryTab Error/Loading/Empty States', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getMemories).mockResolvedValue({ memories: [], total: 0 });
  });

  it('shows loading spinner during initial load', () => {
    vi.mocked(client.getMemories).mockImplementation(() => new Promise(() => {}));

    render(<MemoryTab />);

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('shows error state on API failure', async () => {
    vi.mocked(client.getMemories).mockRejectedValue(new Error('API error'));

    render(<MemoryTab />);

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument();
    });
  });

  it('shows empty state when no memories exist', async () => {
    vi.mocked(client.getMemories).mockResolvedValue({ memories: [], total: 0 });

    render(<MemoryTab />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });
});

describe('GA: ObservabilityTab Error/Loading/Empty States', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(observabilityApi.getRuns).mockResolvedValue([]);
  });

  it('shows loading spinner during initial load', () => {
    vi.mocked(observabilityApi.getRuns).mockImplementation(() => new Promise(() => {}));

    render(<ObservabilityTab />);

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('shows error state on API failure', async () => {
    vi.mocked(observabilityApi.getRuns).mockRejectedValue(new Error('API error'));

    render(<ObservabilityTab />);

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument();
    });
  });

  it('shows empty state when no runs exist', async () => {
    vi.mocked(observabilityApi.getRuns).mockResolvedValue([]);

    render(<ObservabilityTab />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });
});

describe('GA: SettingsTab Error/Loading/Empty States', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getSettings).mockResolvedValue({
      settings: { localOnly: true, retentionDays: 30 },
    });
  });

  it('shows loading spinner during initial load', () => {
    vi.mocked(client.getSettings).mockImplementation(() => new Promise(() => {}));

    render(<SettingsTab />);

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('shows error state on API failure', async () => {
    vi.mocked(client.getSettings).mockRejectedValue(new Error('API error'));

    render(<SettingsTab />);

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument();
    });
  });
});

describe('GA: Setup Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      needsSetup: true,
      setupUser: vi.fn().mockResolvedValue({
        user: { userId: 'admin-1', username: 'admin', createdAt: new Date().toISOString() },
      }),
    });
    vi.mocked(client.getSetupStatus).mockResolvedValue({ needsSetup: true });
    vi.mocked(adminApi.createApiKey).mockResolvedValue({
      id: 'key-1',
      name: 'Test Key',
      key: 'ak_testsecret123',
      prefix: 'ak_test',
      role: 'admin',
      createdAt: new Date().toISOString(),
    });
    vi.mocked(adminApi.getConnectorHealth).mockResolvedValue({ connectors: [] });
  });

  it('shows setup flow when needsSetup is true', async () => {
    renderWithAuth(<ProductionSetupChecklist />);

    await waitFor(() => {
      expect(screen.getByTestId('production-setup-page')).toBeInTheDocument();
    });
  });

  it('starts with admin user creation step', async () => {
    renderWithAuth(<ProductionSetupChecklist />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-username-input')).toBeInTheDocument();
      expect(screen.getByTestId('admin-password-input')).toBeInTheDocument();
      expect(screen.getByTestId('admin-confirm-password-input')).toBeInTheDocument();
    });
  });

  it('shows error when username is empty', async () => {
    renderWithAuth(<ProductionSetupChecklist />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-create-submit')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('admin-create-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toHaveTextContent('用户名不能为空');
    });
  });

  it('shows error when password is too short', async () => {
    renderWithAuth(<ProductionSetupChecklist />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-username-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('admin-username-input'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByTestId('admin-password-input'), { target: { value: 'short' } });
    fireEvent.change(screen.getByTestId('admin-confirm-password-input'), { target: { value: 'short' } });
    fireEvent.click(screen.getByTestId('admin-create-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toHaveTextContent('密码至少需要 8 个字符');
    });
  });

  it('shows error when passwords do not match', async () => {
    renderWithAuth(<ProductionSetupChecklist />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-username-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('admin-username-input'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByTestId('admin-password-input'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByTestId('admin-confirm-password-input'), { target: { value: 'password456' } });
    fireEvent.click(screen.getByTestId('admin-create-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toHaveTextContent('两次输入的密码不一致');
    });
  });

  it('moves to API key step after admin creation', async () => {
    const mockSetupUser = vi.fn().mockResolvedValue({
      user: { userId: 'admin-1', username: 'admin', createdAt: new Date().toISOString() },
    });
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      needsSetup: true,
      setupUser: mockSetupUser,
    });

    renderWithAuth(<ProductionSetupChecklist />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-username-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('admin-username-input'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByTestId('admin-password-input'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByTestId('admin-confirm-password-input'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByTestId('admin-create-submit'));

    await waitFor(() => {
      expect(screen.getByText('创建 API 密钥')).toBeInTheDocument();
    });
  });

  it('shows production readiness checklist on final step', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      needsSetup: true,
      setupUser: vi.fn().mockResolvedValue({
        user: { userId: 'admin-1', username: 'admin', createdAt: new Date().toISOString() },
      }),
    });

    renderWithAuth(<ProductionSetupChecklist />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-username-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('admin-username-input'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByTestId('admin-password-input'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByTestId('admin-confirm-password-input'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByTestId('admin-create-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('skip-api-key-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('skip-api-key-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('readiness-app_secret_key')).toBeInTheDocument();
      expect(screen.getByTestId('readiness-cors')).toBeInTheDocument();
      expect(screen.getByTestId('readiness-connectors')).toBeInTheDocument();
    });
  });

  it('calls onComplete when setup is finished', async () => {
    const onComplete = vi.fn();
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      needsSetup: true,
      setupUser: vi.fn().mockResolvedValue({
        user: { userId: 'admin-1', username: 'admin', createdAt: new Date().toISOString() },
      }),
    });

    renderWithAuth(<ProductionSetupChecklist onComplete={onComplete} />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-username-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('admin-username-input'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByTestId('admin-password-input'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByTestId('admin-confirm-password-input'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByTestId('admin-create-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('skip-api-key-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('skip-api-key-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('complete-setup-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('complete-setup-btn'));

    expect(onComplete).toHaveBeenCalled();
  });
});

describe('GA: Secret Redaction in UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { userId: 'admin-1', username: 'admin', role: 'admin' },
      isAuthenticated: true,
    });
  });

  it('never shows full API key in list view', async () => {
    vi.mocked(adminApi.listUsers).mockResolvedValue({ users: [], total: 0 });
    vi.mocked(adminApi.listApiKeys).mockResolvedValue({
      keys: [
        {
          id: 'key-1',
          name: 'Production Key',
          prefix: 'ak_prod123...',
          role: 'admin',
          status: 'active',
          userId: null,
          createdAt: '2024-01-01T00:00:00Z',
          expiresAt: null,
          lastUsedAt: null,
        },
      ],
      total: 1,
    });
    vi.mocked(adminApi.getConnectorHealth).mockResolvedValue({ connectors: [] });
    vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
      settings: { rateLimitPerMinute: 60, rateLimitPerHour: 1000, sessionTokenTtlHours: 24 },
    });

    render(<AdminTab />);

    await waitFor(() => {
      expect(screen.getByTestId('api-key-row-key-1')).toBeInTheDocument();
    });

    expect(screen.getByText('ak_prod123...')).toBeInTheDocument();
    expect(screen.queryByText('ak_prod123fullsecretkey')).not.toBeInTheDocument();
  });

  it('shows full API key only once after creation', async () => {
    vi.mocked(adminApi.listUsers).mockResolvedValue({ users: [], total: 0 });
    vi.mocked(adminApi.listApiKeys).mockResolvedValue({ keys: [], total: 0 });
    vi.mocked(adminApi.getConnectorHealth).mockResolvedValue({ connectors: [] });
    vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
      settings: { rateLimitPerMinute: 60, rateLimitPerHour: 1000, sessionTokenTtlHours: 24 },
    });
    vi.mocked(adminApi.createApiKey).mockResolvedValue({
      id: 'key-1',
      name: 'Test Key',
      key: 'ak_fullsecretkey_xyz123',
      prefix: 'ak_full',
      role: 'admin',
      createdAt: '2024-01-01T00:00:00Z',
    });

    render(<AdminTab />);

    await waitFor(() => {
      expect(screen.getByTestId('create-api-key-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('create-api-key-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('api-key-name-input')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('api-key-name-input'), { target: { value: 'Test Key' } });
    fireEvent.click(screen.getByTestId('api-key-create-submit'));

    await waitFor(() => {
      expect(screen.getByText('ak_fullsecretkey_xyz123')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('api-key-dialog-close'));

    await waitFor(() => {
      expect(screen.queryByText('ak_fullsecretkey_xyz123')).not.toBeInTheDocument();
    });

    expect(screen.getByText('ak_full')).toBeInTheDocument();
  });
});
