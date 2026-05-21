import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from './App';
import * as client from './api/client';

vi.mock('./api/client');

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', () => {
    render(<App />);
    expect(screen.getByTestId('auth-loading')).toBeInTheDocument();
  });

  it('renders setup form when needsSetup is true', async () => {
    vi.mocked(client.getSetupStatus).mockResolvedValue({ needsSetup: true });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('production-setup-page')).toBeInTheDocument();
    });
  });

  it('renders login form when setup is complete and no session', async () => {
    vi.mocked(client.getSetupStatus).mockResolvedValue({ needsSetup: false });
    vi.mocked(client.getMe).mockRejectedValue(new Error('Unauthorized'));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('auth-subtitle')).toHaveTextContent('请输入您的凭据');
    });
  });

  it('renders app shell when authenticated', async () => {
    vi.mocked(client.getSetupStatus).mockResolvedValue({ needsSetup: false });
    vi.mocked(client.getMe).mockResolvedValue({
      user: {
        userId: 'test-user-id',
        username: 'testuser',
        createdAt: '2024-01-01T00:00:00Z',
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    });

    expect(screen.getByTestId('username-display')).toHaveTextContent('testuser');
  });
});
