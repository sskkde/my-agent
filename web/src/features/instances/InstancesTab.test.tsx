import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import InstancesTab from './InstancesTab'
import * as client from '../../api/client'

vi.mock('../../api/client', () => ({
  getInstances: vi.fn(),
}))

describe('InstancesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders instances panel with data-testid', async () => {
    ;(client.getInstances as ReturnType<typeof vi.fn>).mockResolvedValue({
      instances: [],
    })

    render(<InstancesTab />)

    await waitFor(() => {
      expect(screen.getByTestId('instances-panel')).toBeInTheDocument()
    })
  })

  it('shows loading state initially', () => {
    ;(client.getInstances as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}))

    render(<InstancesTab />)

    expect(screen.getByTestId('instances-loading')).toBeInTheDocument()
  })

  it('shows empty state when no instances', async () => {
    ;(client.getInstances as ReturnType<typeof vi.fn>).mockResolvedValue({
      instances: [],
    })

    render(<InstancesTab />)

    await waitFor(() => {
      expect(screen.getByTestId('instances-empty-state')).toBeInTheDocument()
    })
  })

  it('displays instances list with correct data', async () => {
    ;(client.getInstances as ReturnType<typeof vi.fn>).mockResolvedValue({
      instances: [
        {
          type: 'local',
          status: 'healthy',
          uptime: 3665,
          apiPort: 3000,
          storeStatus: 'connected',
        },
        {
          type: 'remote',
          status: 'degraded',
          uptime: 180,
          apiPort: 3001,
          storeStatus: 'disconnected',
        },
      ],
    })

    render(<InstancesTab />)

    await waitFor(() => {
      expect(screen.getByTestId('instances-list')).toBeInTheDocument()
    })

    expect(screen.getByTestId('instance-card-0')).toBeInTheDocument()
    expect(screen.getByTestId('instance-card-1')).toBeInTheDocument()

    const localElements = screen.getAllByText('local')
    expect(localElements.length).toBeGreaterThan(0)

    expect(screen.getByText('remote')).toBeInTheDocument()
    expect(screen.getByText('健康')).toBeInTheDocument()
    expect(screen.getByText('降级')).toBeInTheDocument()
    expect(screen.getByText('3000')).toBeInTheDocument()
    expect(screen.getByText('3001')).toBeInTheDocument()
  })

  it('formats uptime correctly', async () => {
    ;(client.getInstances as ReturnType<typeof vi.fn>).mockResolvedValue({
      instances: [
        {
          type: 'local',
          status: 'healthy',
          uptime: 3665,
          apiPort: 3000,
          storeStatus: 'connected',
        },
      ],
    })

    render(<InstancesTab />)

    await waitFor(() => {
      expect(screen.getByText('1h 1m')).toBeInTheDocument()
    })
  })

  it('handles missing uptime gracefully', async () => {
    ;(client.getInstances as ReturnType<typeof vi.fn>).mockResolvedValue({
      instances: [
        {
          type: 'local',
          status: 'healthy',
          apiPort: 3000,
          storeStatus: 'connected',
        },
      ],
    })

    render(<InstancesTab />)

    await waitFor(() => {
      expect(screen.getByText('-')).toBeInTheDocument()
    })
  })

  it('shows error state on API failure', async () => {
    ;(client.getInstances as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'))

    render(<InstancesTab />)

    await waitFor(() => {
      expect(screen.getByTestId('instances-error')).toBeInTheDocument()
    })
  })
})
