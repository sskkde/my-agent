import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ChannelsTab from './ChannelsTab';
import * as client from '../../api/client';
import { resetMatchMedia } from '../../test/setup';

vi.mock('../../api/client', () => ({
  getChannels: vi.fn(),
}));

describe('ChannelsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMatchMedia();
  });

  it('renders channels panel with data-testid', async () => {
    (client.getChannels as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [],
    });

    render(<ChannelsTab />);

    await waitFor(() => {
      expect(screen.getByTestId('channels-panel')).toBeInTheDocument();
    });
  });

  it('shows loading state initially', () => {
    (client.getChannels as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );

    render(<ChannelsTab />);

    expect(screen.getByTestId('channels-loading')).toBeInTheDocument();
  });

  it('shows empty state when no channels', async () => {
    (client.getChannels as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [],
    });

    render(<ChannelsTab />);

    await waitFor(() => {
      expect(screen.getByTestId('channels-empty-state')).toBeInTheDocument();
    });
  });

  it('displays channels table with correct data', async () => {
    (client.getChannels as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [
        {
          connectorId: 'slack-1',
          type: 'slack',
          status: 'connected',
          configured: true,
        },
        {
          connectorId: 'discord-1',
          type: 'discord',
          status: 'disconnected',
          configured: false,
        },
      ],
    });

    render(<ChannelsTab />);

    await waitFor(() => {
      expect(screen.getByTestId('channels-table')).toBeInTheDocument();
    });

    expect(screen.getByTestId('channel-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('channel-row-1')).toBeInTheDocument();

    // Text appears in both desktop table and mobile cards, so use getAllByText
    expect(screen.getAllByText('slack-1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('discord-1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('slack').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('discord').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('connected').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('disconnected').length).toBeGreaterThanOrEqual(1);
  });

  it('shows configured checkmark correctly in desktop table', async () => {
    (client.getChannels as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [
        {
          connectorId: 'slack-1',
          type: 'slack',
          status: 'connected',
          configured: true,
        },
        {
          connectorId: 'discord-1',
          type: 'discord',
          status: 'disconnected',
          configured: false,
        },
      ],
    });

    render(<ChannelsTab />);

    await waitFor(() => {
      expect(screen.getByTestId('channels-table')).toBeInTheDocument();
    });

    const table = screen.getByTestId('channels-table');
    const configuredCell = table.querySelector('[data-testid="channel-configured-0"]');
    expect(configuredCell).toBeInTheDocument();
    expect(configuredCell).toHaveTextContent('✓');
  });

  it('shows error state on API failure', async () => {
    (client.getChannels as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('API error')
    );

    render(<ChannelsTab />);

    await waitFor(() => {
      expect(screen.getByTestId('channels-error')).toBeInTheDocument();
    });
  });

  it('renders mobile cards list alongside desktop table', async () => {
    (client.getChannels as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [
        {
          connectorId: 'slack-1',
          type: 'slack',
          status: 'connected',
          configured: true,
        },
      ],
    });

    render(<ChannelsTab />);

    await waitFor(() => {
      expect(screen.getByTestId('channels-mobile-list')).toBeInTheDocument();
      expect(screen.getByTestId('channels-table')).toBeInTheDocument();
    });
  });

  it('renders channel cards with correct data-testids', async () => {
    (client.getChannels as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [
        {
          connectorId: 'slack-1',
          type: 'slack',
          status: 'connected',
          configured: true,
        },
        {
          connectorId: 'discord-1',
          type: 'discord',
          status: 'disconnected',
          configured: false,
        },
      ],
    });

    render(<ChannelsTab />);

    await waitFor(() => {
      expect(screen.getByTestId('channel-card-0')).toBeInTheDocument();
      expect(screen.getByTestId('channel-card-1')).toBeInTheDocument();
    });
  });

  it('renders mobile cards with all field values', async () => {
    (client.getChannels as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [
        {
          connectorId: 'slack-1',
          type: 'slack',
          status: 'connected',
          configured: true,
        },
      ],
    });

    render(<ChannelsTab />);

    await waitFor(() => {
      expect(screen.getByTestId('channel-card-0')).toBeInTheDocument();
    });

    const card = screen.getByTestId('channel-card-0');
    expect(card).toHaveTextContent('slack-1');
    expect(card).toHaveTextContent('slack');
    expect(card).toHaveTextContent('connected');
    expect(card).toHaveTextContent('✓');
  });

  it('renders configured checkmark in mobile cards', async () => {
    (client.getChannels as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [
        {
          connectorId: 'slack-1',
          type: 'slack',
          status: 'connected',
          configured: true,
        },
        {
          connectorId: 'discord-1',
          type: 'discord',
          status: 'disconnected',
          configured: false,
        },
      ],
    });

    render(<ChannelsTab />);

    await waitFor(() => {
      expect(screen.getByTestId('channel-card-0')).toBeInTheDocument();
    });

    const card0 = screen.getByTestId('channel-card-0');
    const card1 = screen.getByTestId('channel-card-1');
    expect(card0).toHaveTextContent('✓');
    expect(card1).toHaveTextContent('✗');
  });
});
