import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SettingsTab from './SettingsTab';
import { AuthProvider } from '../../context/AuthContext';
import * as client from '../../api/client';

vi.mock('../../api/client', () => ({
  getSettings: vi.fn(),
  getProviders: vi.fn(),
}));

const renderWithAuth = (component: React.ReactElement) => {
  return render(<AuthProvider>{component}</AuthProvider>);
};

describe('SettingsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders settings panel with data-testid', async () => {
    (client.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      settings: {
        localOnly: true,
        providers: {},
        retentionDays: 30,
      },
    });
    (client.getProviders as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    renderWithAuth(<SettingsTab />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-panel')).toBeInTheDocument();
    });
  });

  it('shows loading state initially', () => {
    (client.getSettings as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );

    renderWithAuth(<SettingsTab />);

    expect(screen.getByTestId('settings-loading')).toBeInTheDocument();
  });

  it('shows settings content with correct data', async () => {
    (client.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      settings: {
        localOnly: true,
        providers: {},
        retentionDays: 30,
      },
    });
    (client.getProviders as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    renderWithAuth(<SettingsTab />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-content')).toBeInTheDocument();
    });

    expect(screen.getByTestId('local-only-yes')).toBeInTheDocument();
    expect(screen.getByTestId('retention-days')).toHaveTextContent('30 天');
  });

  it('shows error state on API failure', async () => {
    (client.getSettings as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('API error')
    );

    renderWithAuth(<SettingsTab />);

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument();
    });
  });

  it('shows security notice', async () => {
    (client.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      settings: {
        localOnly: true,
        providers: {},
        retentionDays: 30,
      },
    });
    (client.getProviders as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    renderWithAuth(<SettingsTab />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-notice')).toBeInTheDocument();
    });

    expect(screen.getByText(/安全提示/)).toBeInTheDocument();
    expect(screen.getByText(/API 密钥/)).toBeInTheDocument();
  });
});
