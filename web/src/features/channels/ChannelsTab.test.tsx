import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ChannelsTab from './ChannelsTab'
import * as client from '../../api/client'
import { resetMatchMedia } from '../../test/setup'

vi.mock('../../api/client', () => ({
  getChannels: vi.fn(),
}))

describe('ChannelsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMatchMedia()
  })

  it('renders channels panel with data-testid', async () => {
    ;(client.getChannels as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [],
    })

    render(<ChannelsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('channels-panel')).toBeInTheDocument()
    })
  })

  it('shows loading state initially', () => {
    ;(client.getChannels as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}))

    render(<ChannelsTab />)

    expect(screen.getByTestId('channels-loading')).toBeInTheDocument()
  })

  it('shows empty state when no channels', async () => {
    ;(client.getChannels as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [],
    })

    render(<ChannelsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('channels-empty-state')).toBeInTheDocument()
    })
  })

  it('displays channels table with correct data', async () => {
    ;(client.getChannels as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [
        {
          connectorId: 'slack-1',
          type: 'slack',
          status: 'active',
          configured: true,
        },
        {
          connectorId: 'discord-1',
          type: 'discord',
          status: 'inactive',
          configured: false,
        },
      ],
    })

    render(<ChannelsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('channels-table')).toBeInTheDocument()
    })

    expect(screen.getByTestId('channel-row-0')).toBeInTheDocument()
    expect(screen.getByTestId('channel-row-1')).toBeInTheDocument()

    // Text appears in both desktop table and mobile cards, so use getAllByText
    expect(screen.getAllByText('slack-1').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('discord-1').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('slack').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('discord').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('活跃').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('未启用').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('active')).not.toBeInTheDocument()
    expect(screen.queryByText('inactive')).not.toBeInTheDocument()
  })

  it('shows configured checkmark correctly in desktop table', async () => {
    ;(client.getChannels as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [
        {
          connectorId: 'slack-1',
          type: 'slack',
          status: 'active',
          configured: true,
        },
        {
          connectorId: 'discord-1',
          type: 'discord',
          status: 'inactive',
          configured: false,
        },
      ],
    })

    render(<ChannelsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('channels-table')).toBeInTheDocument()
    })

    const table = screen.getByTestId('channels-table')
    const configuredCell = table.querySelector('[data-testid="channel-configured-0"]')
    expect(configuredCell).toBeInTheDocument()
    expect(configuredCell).toHaveTextContent('✓')
  })

  it('shows error state on API failure', async () => {
    ;(client.getChannels as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'))

    render(<ChannelsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('channels-error')).toBeInTheDocument()
    })
  })

  it('renders mobile cards list alongside desktop table', async () => {
    ;(client.getChannels as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [
        {
          connectorId: 'slack-1',
          type: 'slack',
          status: 'active',
          configured: true,
        },
      ],
    })

    render(<ChannelsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('channels-mobile-list')).toBeInTheDocument()
      expect(screen.getByTestId('channels-table')).toBeInTheDocument()
    })
  })

  it('renders channel cards with correct data-testids', async () => {
    ;(client.getChannels as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [
        {
          connectorId: 'slack-1',
          type: 'slack',
          status: 'active',
          configured: true,
        },
        {
          connectorId: 'discord-1',
          type: 'discord',
          status: 'inactive',
          configured: false,
        },
      ],
    })

    render(<ChannelsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('channel-card-0')).toBeInTheDocument()
      expect(screen.getByTestId('channel-card-1')).toBeInTheDocument()
    })
  })

  it('renders mobile cards with all field values', async () => {
    ;(client.getChannels as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [
        {
          connectorId: 'slack-1',
          type: 'slack',
          status: 'active',
          configured: true,
        },
      ],
    })

    render(<ChannelsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('channel-card-0')).toBeInTheDocument()
    })

    const card = screen.getByTestId('channel-card-0')
    expect(card).toHaveTextContent('slack-1')
    expect(card).toHaveTextContent('slack')
    expect(card).toHaveTextContent('活跃')
    expect(card).toHaveTextContent('✓')
  })

  it('renders configured checkmark in mobile cards', async () => {
    ;(client.getChannels as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [
        {
          connectorId: 'slack-1',
          type: 'slack',
          status: 'active',
          configured: true,
        },
        {
          connectorId: 'discord-1',
          type: 'discord',
          status: 'inactive',
          configured: false,
        },
      ],
    })

    render(<ChannelsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('channel-card-0')).toBeInTheDocument()
    })

    const card0 = screen.getByTestId('channel-card-0')
    const card1 = screen.getByTestId('channel-card-1')
    expect(card0).toHaveTextContent('✓')
    expect(card1).toHaveTextContent('✗')
  })

  it('localizes known channel statuses in desktop table and mobile cards', async () => {
    ;(client.getChannels as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [
        {
          connectorId: 'active-channel',
          type: 'slack',
          status: 'active',
          configured: true,
        },
        {
          connectorId: 'inactive-channel',
          type: 'discord',
          status: 'inactive',
          configured: false,
        },
        {
          connectorId: 'error-channel',
          type: 'email',
          status: 'error',
          configured: true,
        },
        {
          connectorId: 'degraded-channel',
          type: 'webhook',
          status: 'degraded',
          configured: true,
        },
      ],
    })

    render(<ChannelsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('channels-table')).toBeInTheDocument()
    })

    expect(screen.getAllByText('活跃')).toHaveLength(2)
    expect(screen.getAllByText('未启用')).toHaveLength(2)
    expect(screen.getAllByText('异常')).toHaveLength(2)
    expect(screen.getAllByText('降级')).toHaveLength(2)
    expect(screen.queryByText('active')).not.toBeInTheDocument()
    expect(screen.queryByText('inactive')).not.toBeInTheDocument()
    expect(screen.queryByText('error')).not.toBeInTheDocument()
    expect(screen.queryByText('degraded')).not.toBeInTheDocument()
  })

  it('falls back to the original value for unknown statuses and keeps status-based classes', async () => {
    ;(client.getChannels as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [
        {
          connectorId: 'unknown-channel',
          type: 'webhook',
          status: 'paused',
          configured: true,
        },
        {
          connectorId: 'active-channel',
          type: 'slack',
          status: 'active',
          configured: true,
        },
        {
          connectorId: 'inactive-channel',
          type: 'discord',
          status: 'inactive',
          configured: false,
        },
      ],
    })

    render(<ChannelsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('channels-table')).toBeInTheDocument()
    })

    const table = screen.getByTestId('channels-table')
    expect(table.querySelector('[data-testid="channel-row-0"] .status-chip')).toHaveTextContent('paused')
    expect(table.querySelector('[data-testid="channel-row-0"] .status-chip')).toHaveClass('degraded')
    expect(table.querySelector('[data-testid="channel-row-1"] .status-chip')).toHaveTextContent('活跃')
    expect(table.querySelector('[data-testid="channel-row-1"] .status-chip')).toHaveClass('healthy')
    expect(table.querySelector('[data-testid="channel-row-2"] .status-chip')).toHaveTextContent('未启用')
    expect(table.querySelector('[data-testid="channel-row-2"] .status-chip')).toHaveClass('error')

    const card = screen.getByTestId('channel-card-0')
    expect(card.querySelector('.status-chip')).toHaveTextContent('paused')
    expect(card.querySelector('.status-chip')).toHaveClass('degraded')
  })
})
