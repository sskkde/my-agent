import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AdminTab from './AdminTab';
import * as adminApi from '../../api/admin';

vi.mock('../../api/admin');

const mockUseAuth = vi.fn();
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

describe('AdminTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { userId: 'admin-1', username: 'admin', role: 'admin' },
      isAuthenticated: true,
    });
  });

  describe('Role Check', () => {
    it('shows access denied for non-admin users', () => {
      mockUseAuth.mockReturnValue({
        user: { userId: 'user-1', username: 'user', role: 'user' },
        isAuthenticated: true,
      });

      render(<AdminTab />);

      expect(screen.getByTestId('admin-access-denied')).toBeInTheDocument();
      expect(screen.getByText('没有权限')).toBeInTheDocument();
      expect(screen.getByText('您没有权限访问此页面')).toBeInTheDocument();
    });

    it('renders admin panel for admin users', async () => {
      vi.mocked(adminApi.listUsers).mockResolvedValue({ users: [], total: 0 });
      vi.mocked(adminApi.listApiKeys).mockResolvedValue({ keys: [], total: 0 });
      vi.mocked(adminApi.getConnectorHealth).mockResolvedValue({ connectors: [] });
      vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
        settings: { rateLimitPerMinute: 60, rateLimitPerHour: 1000, sessionTokenTtlHours: 24 },
      });

      render(<AdminTab />);

      await waitFor(() => {
        expect(screen.getByTestId('admin-panel')).toBeInTheDocument();
      });
    });
  });

  describe('UserManagementPanel', () => {
    it('renders user list with userId, username, role, status', async () => {
      vi.mocked(adminApi.listUsers).mockResolvedValue({
        users: [
          {
            userId: 'user-1',
            username: 'alice',
            role: 'user',
            status: 'active',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
          {
            userId: 'user-2',
            username: 'bob',
            role: 'admin',
            status: 'disabled',
            createdAt: '2024-01-02T00:00:00Z',
            updatedAt: '2024-01-02T00:00:00Z',
          },
        ],
        total: 2,
      });
      vi.mocked(adminApi.listApiKeys).mockResolvedValue({ keys: [], total: 0 });
      vi.mocked(adminApi.getConnectorHealth).mockResolvedValue({ connectors: [] });
      vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
        settings: { rateLimitPerMinute: 60, rateLimitPerHour: 1000, sessionTokenTtlHours: 24 },
      });

      render(<AdminTab />);

      await waitFor(() => {
        expect(screen.getByTestId('user-management-panel')).toBeInTheDocument();
      });

      expect(screen.getByTestId('user-row-user-1')).toBeInTheDocument();
      expect(screen.getByText('alice')).toBeInTheDocument();
      expect(screen.getByText('bob')).toBeInTheDocument();
    });

    it('dropdown to change role', async () => {
      vi.mocked(adminApi.listUsers).mockResolvedValue({
        users: [
          {
            userId: 'user-1',
            username: 'alice',
            role: 'user',
            status: 'active',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        ],
        total: 1,
      });
      vi.mocked(adminApi.updateUserRole).mockResolvedValue({
        userId: 'user-1',
        username: 'alice',
        role: 'admin',
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      });
      vi.mocked(adminApi.listApiKeys).mockResolvedValue({ keys: [], total: 0 });
      vi.mocked(adminApi.getConnectorHealth).mockResolvedValue({ connectors: [] });
      vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
        settings: { rateLimitPerMinute: 60, rateLimitPerHour: 1000, sessionTokenTtlHours: 24 },
      });

      render(<AdminTab />);

      await waitFor(() => {
        expect(screen.getByTestId('role-select-user-1')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByTestId('role-select-user-1'), { target: { value: 'admin' } });

      await waitFor(() => {
        expect(adminApi.updateUserRole).toHaveBeenCalledWith('user-1', { role: 'admin' });
      });
    });

    it('toggle enable/disable user', async () => {
      vi.mocked(adminApi.listUsers).mockResolvedValue({
        users: [
          {
            userId: 'user-1',
            username: 'alice',
            role: 'user',
            status: 'active',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        ],
        total: 1,
      });
      vi.mocked(adminApi.updateUserStatus).mockResolvedValue({
        userId: 'user-1',
        username: 'alice',
        role: 'user',
        status: 'disabled',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      });
      vi.mocked(adminApi.listApiKeys).mockResolvedValue({ keys: [], total: 0 });
      vi.mocked(adminApi.getConnectorHealth).mockResolvedValue({ connectors: [] });
      vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
        settings: { rateLimitPerMinute: 60, rateLimitPerHour: 1000, sessionTokenTtlHours: 24 },
      });

      render(<AdminTab />);

      await waitFor(() => {
        expect(screen.getByTestId('status-toggle-user-1')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('status-toggle-user-1'));

      await waitFor(() => {
        expect(adminApi.updateUserStatus).toHaveBeenCalledWith('user-1', { status: 'disabled' });
      });
    });
  });

  describe('ApiKeyManagementPanel', () => {
    it('renders API key list with prefix, name, role, status', async () => {
      vi.mocked(adminApi.listUsers).mockResolvedValue({ users: [], total: 0 });
      vi.mocked(adminApi.listApiKeys).mockResolvedValue({
        keys: [
          {
            id: 'key-1',
            name: 'CI Key',
            prefix: 'ak_abc123',
            role: 'service',
            status: 'active',
            userId: null,
            createdAt: '2024-01-01T00:00:00Z',
            expiresAt: null,
            lastUsedAt: '2024-01-02T00:00:00Z',
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
        expect(screen.getByTestId('api-key-management-panel')).toBeInTheDocument();
      });

      expect(screen.getByTestId('api-key-row-key-1')).toBeInTheDocument();
      expect(screen.getByText('CI Key')).toBeInTheDocument();
      expect(screen.getByText('ak_abc123')).toBeInTheDocument();
    });

    it('create key dialog with name and role inputs', async () => {
      vi.mocked(adminApi.listUsers).mockResolvedValue({ users: [], total: 0 });
      vi.mocked(adminApi.listApiKeys).mockResolvedValue({ keys: [], total: 0 });
      vi.mocked(adminApi.getConnectorHealth).mockResolvedValue({ connectors: [] });
      vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
        settings: { rateLimitPerMinute: 60, rateLimitPerHour: 1000, sessionTokenTtlHours: 24 },
      });
      vi.mocked(adminApi.createApiKey).mockResolvedValue({
        id: 'key-1',
        name: 'New Key',
        key: 'ak_newsecret123',
        prefix: 'ak_newsec',
        role: 'service',
        createdAt: '2024-01-01T00:00:00Z',
      });

      render(<AdminTab />);

      await waitFor(() => {
        expect(screen.getByTestId('create-api-key-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('create-api-key-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('api-key-create-dialog')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByTestId('api-key-name-input'), { target: { value: 'New Key' } });
      fireEvent.change(screen.getByTestId('api-key-role-select'), { target: { value: 'service' } });
      fireEvent.click(screen.getByTestId('api-key-create-submit'));

      await waitFor(() => {
        expect(adminApi.createApiKey).toHaveBeenCalledWith({ name: 'New Key', role: 'service' });
      });
    });

    it('revoke button disables API key', async () => {
      vi.mocked(adminApi.listUsers).mockResolvedValue({ users: [], total: 0 });
      vi.mocked(adminApi.listApiKeys).mockResolvedValue({
        keys: [
          {
            id: 'key-1',
            name: 'CI Key',
            prefix: 'ak_abc123',
            role: 'service',
            status: 'active',
            userId: null,
            createdAt: '2024-01-01T00:00:00Z',
            expiresAt: null,
            lastUsedAt: '2024-01-02T00:00:00Z',
          },
        ],
        total: 1,
      });
      vi.mocked(adminApi.getConnectorHealth).mockResolvedValue({ connectors: [] });
      vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
        settings: { rateLimitPerMinute: 60, rateLimitPerHour: 1000, sessionTokenTtlHours: 24 },
      });
      vi.mocked(adminApi.revokeApiKey).mockResolvedValue({ id: 'key-1', isActive: false });

      render(<AdminTab />);

      await waitFor(() => {
        expect(screen.getByTestId('revoke-key-key-1')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('revoke-key-key-1'));

      await waitFor(() => {
        expect(adminApi.revokeApiKey).toHaveBeenCalledWith('key-1');
      });
    });
  });

  describe('SystemSettingsPanel', () => {
    it('renders rate limit and auth token config', async () => {
      vi.mocked(adminApi.listUsers).mockResolvedValue({ users: [], total: 0 });
      vi.mocked(adminApi.listApiKeys).mockResolvedValue({ keys: [], total: 0 });
      vi.mocked(adminApi.getConnectorHealth).mockResolvedValue({ connectors: [] });
      vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
        settings: { rateLimitPerMinute: 60, rateLimitPerHour: 1000, sessionTokenTtlHours: 24 },
      });

      render(<AdminTab />);

      await waitFor(() => {
        expect(screen.getByTestId('system-settings-panel')).toBeInTheDocument();
      });

      expect(screen.getByTestId('rate-limit-per-minute')).toBeInTheDocument();
      expect(screen.getByTestId('rate-limit-per-hour')).toBeInTheDocument();
      expect(screen.getByTestId('session-token-ttl')).toBeInTheDocument();
    });

    it('updates settings on save', async () => {
      vi.mocked(adminApi.listUsers).mockResolvedValue({ users: [], total: 0 });
      vi.mocked(adminApi.listApiKeys).mockResolvedValue({ keys: [], total: 0 });
      vi.mocked(adminApi.getConnectorHealth).mockResolvedValue({ connectors: [] });
      vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
        settings: { rateLimitPerMinute: 60, rateLimitPerHour: 1000, sessionTokenTtlHours: 24 },
      });
      vi.mocked(adminApi.updateSystemSettings).mockResolvedValue({
        settings: { rateLimitPerMinute: 100, rateLimitPerHour: 2000, sessionTokenTtlHours: 48 },
      });

      render(<AdminTab />);

      await waitFor(() => {
        expect(screen.getByTestId('settings-save-btn')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByTestId('rate-limit-per-minute'), { target: { value: '100' } });
      fireEvent.click(screen.getByTestId('settings-save-btn'));

      await waitFor(() => {
        expect(adminApi.updateSystemSettings).toHaveBeenCalled();
      });
    });
  });

  describe('ConnectorStatusPanel', () => {
    it('renders connector health status overview', async () => {
      vi.mocked(adminApi.listUsers).mockResolvedValue({ users: [], total: 0 });
      vi.mocked(adminApi.listApiKeys).mockResolvedValue({ keys: [], total: 0 });
      vi.mocked(adminApi.getConnectorHealth).mockResolvedValue({
        connectors: [
          {
            connectorId: 'github',
            connectorType: 'api',
            displayName: 'GitHub',
            status: 'healthy',
            message: 'Connected',
            lastCheckedAt: '2024-01-01T00:00:00Z',
          },
          {
            connectorId: 'slack',
            connectorType: 'messaging',
            displayName: 'Slack',
            status: 'degraded',
            message: 'Rate limited',
            lastCheckedAt: '2024-01-01T00:00:00Z',
          },
        ],
      });
      vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
        settings: { rateLimitPerMinute: 60, rateLimitPerHour: 1000, sessionTokenTtlHours: 24 },
      });

      render(<AdminTab />);

      await waitFor(() => {
        expect(screen.getByTestId('connector-status-panel')).toBeInTheDocument();
      });

      expect(screen.getByTestId('connector-status-github')).toBeInTheDocument();
      expect(screen.getByTestId('connector-status-slack')).toBeInTheDocument();
      expect(screen.getByText('GitHub')).toBeInTheDocument();
      expect(screen.getByText('Slack')).toBeInTheDocument();
    });

    it('shows healthy/degraded/unhealthy status icons', async () => {
      vi.mocked(adminApi.listUsers).mockResolvedValue({ users: [], total: 0 });
      vi.mocked(adminApi.listApiKeys).mockResolvedValue({ keys: [], total: 0 });
      vi.mocked(adminApi.getConnectorHealth).mockResolvedValue({
        connectors: [
          {
            connectorId: 'github',
            connectorType: 'api',
            displayName: 'GitHub',
            status: 'healthy',
            lastCheckedAt: '2024-01-01T00:00:00Z',
          },
          {
            connectorId: 'slack',
            connectorType: 'messaging',
            displayName: 'Slack',
            status: 'unhealthy',
            lastCheckedAt: '2024-01-01T00:00:00Z',
          },
        ],
      });
      vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
        settings: { rateLimitPerMinute: 60, rateLimitPerHour: 1000, sessionTokenTtlHours: 24 },
      });

      render(<AdminTab />);

      await waitFor(() => {
        expect(screen.getByTestId('connector-status-icon-github')).toHaveClass('status-healthy');
      });

      expect(screen.getByTestId('connector-status-icon-slack')).toHaveClass('status-unhealthy');
    });
  });

  describe('Loading and Error States', () => {
    it('shows loading state initially', () => {
      vi.mocked(adminApi.listUsers).mockImplementation(() => new Promise(() => {}));
      vi.mocked(adminApi.listApiKeys).mockImplementation(() => new Promise(() => {}));
      vi.mocked(adminApi.getConnectorHealth).mockImplementation(() => new Promise(() => {}));
      vi.mocked(adminApi.getSystemSettings).mockImplementation(() => new Promise(() => {}));

      render(<AdminTab />);

      expect(screen.getByTestId('admin-loading')).toBeInTheDocument();
    });

    it('shows error state when API fails', async () => {
      vi.mocked(adminApi.listUsers).mockRejectedValue(new Error('API error'));
      vi.mocked(adminApi.listApiKeys).mockRejectedValue(new Error('API error'));
      vi.mocked(adminApi.getConnectorHealth).mockRejectedValue(new Error('API error'));
      vi.mocked(adminApi.getSystemSettings).mockRejectedValue(new Error('API error'));

      render(<AdminTab />);

      await waitFor(() => {
        expect(screen.getByTestId('admin-error')).toBeInTheDocument();
      });
    });
  });
});
