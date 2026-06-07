import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import StatusTab from './StatusTab'
import * as client from '../../api/client'

vi.mock('../../api/client')

describe('StatusTab', () => {
  const mockOnTabChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders status panel with platform introduction', async () => {
    vi.mocked(client.getHealth).mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      modules: { api: { status: 'healthy' } },
    })
    vi.mocked(client.getApprovals).mockResolvedValue({
      approvals: [],
      total: 0,
    })

    render(<StatusTab onTabChange={mockOnTabChange} />)

    await waitFor(() => {
      expect(screen.getByTestId('status-panel')).toBeInTheDocument()
    })
  })

  it('shows health summary', async () => {
    vi.mocked(client.getHealth).mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      modules: {
        api: { status: 'healthy' },
        database: { status: 'healthy' },
      },
    })
    vi.mocked(client.getApprovals).mockResolvedValue({
      approvals: [],
      total: 0,
    })

    render(<StatusTab onTabChange={mockOnTabChange} />)

    await waitFor(() => {
      expect(screen.getByTestId('status-health-summary')).toBeInTheDocument()
    })
  })

  it('shows pending approvals count', async () => {
    vi.mocked(client.getHealth).mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      modules: { api: { status: 'healthy' } },
    })
    vi.mocked(client.getApprovals).mockResolvedValue({
      approvals: [
        {
          id: '1',
          userId: 'user1',
          sessionId: 's1',
          status: 'pending',
          actionType: 'test',
          requestedBy: 'user1',
          requestedAt: new Date().toISOString(),
        },
        {
          id: '2',
          userId: 'user2',
          sessionId: 's2',
          status: 'pending',
          actionType: 'test2',
          requestedBy: 'user2',
          requestedAt: new Date().toISOString(),
        },
      ],
      total: 2,
    })

    render(<StatusTab onTabChange={mockOnTabChange} />)

    await waitFor(() => {
      expect(screen.getByTestId('approvals-summary')).toBeInTheDocument()
    })
  })

  it('shows empty approval state', async () => {
    vi.mocked(client.getHealth).mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      modules: { api: { status: 'healthy' } },
    })
    vi.mocked(client.getApprovals).mockResolvedValue({
      approvals: [],
      total: 0,
    })

    render(<StatusTab onTabChange={mockOnTabChange} />)

    await waitFor(() => {
      expect(screen.getByText(/暂无审批项/)).toBeInTheDocument()
    })
  })

  it('quick action button switches to session console', async () => {
    vi.mocked(client.getHealth).mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      modules: { api: { status: 'healthy' } },
    })
    vi.mocked(client.getApprovals).mockResolvedValue({
      approvals: [],
      total: 0,
    })

    render(<StatusTab onTabChange={mockOnTabChange} />)

    await waitFor(() => {
      expect(screen.getByTestId('status-open-session')).toBeInTheDocument()
    })

    screen.getByTestId('status-open-session').click()
    expect(mockOnTabChange).toHaveBeenCalledWith('session-console')
  })

  it('quick action button switches to agent monitor', async () => {
    vi.mocked(client.getHealth).mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      modules: { api: { status: 'healthy' } },
    })
    vi.mocked(client.getApprovals).mockResolvedValue({
      approvals: [],
      total: 0,
    })

    render(<StatusTab onTabChange={mockOnTabChange} />)

    await waitFor(() => {
      expect(screen.getByTestId('status-open-monitor')).toBeInTheDocument()
    })

    screen.getByTestId('status-open-monitor').click()
    expect(mockOnTabChange).toHaveBeenCalledWith('agent-monitor')
  })

  it('handles API error for approvals without hiding health summary', async () => {
    vi.mocked(client.getHealth).mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      modules: { api: { status: 'healthy' } },
    })
    vi.mocked(client.getApprovals).mockRejectedValue(new Error('API error'))

    render(<StatusTab onTabChange={mockOnTabChange} />)

    await waitFor(() => {
      expect(screen.getByTestId('status-health-summary')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument()
    })
  })

  describe('Approval List', () => {
    it('renders approval rows with deterministic test IDs', async () => {
      vi.mocked(client.getHealth).mockResolvedValue({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        modules: { api: { status: 'healthy' } },
      })
      vi.mocked(client.getApprovals).mockResolvedValue({
        approvals: [
          {
            id: 'approval-1',
            userId: 'user1',
            sessionId: 's1',
            status: 'pending',
            actionType: 'test',
            requestedBy: 'user1',
            requestedAt: new Date().toISOString(),
          },
          {
            id: 'approval-2',
            userId: 'user2',
            sessionId: 's2',
            status: 'approved',
            actionType: 'test2',
            requestedBy: 'user2',
            requestedAt: new Date().toISOString(),
          },
        ],
        total: 2,
      })

      render(<StatusTab onTabChange={mockOnTabChange} />)

      await waitFor(() => {
        expect(screen.getByTestId('approval-row-approval-1')).toBeInTheDocument()
      })
      expect(screen.getByTestId('approval-row-approval-2')).toBeInTheDocument()
    })

    it('shows approval detail when clicking expand button', async () => {
      vi.mocked(client.getHealth).mockResolvedValue({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        modules: { api: { status: 'healthy' } },
      })
      vi.mocked(client.getApprovals).mockResolvedValue({
        approvals: [
          {
            id: 'approval-1',
            userId: 'user1',
            sessionId: 's1',
            status: 'pending',
            actionType: 'test',
            resource: 'resource-1',
            requestedBy: 'user1',
            requestedAt: new Date().toISOString(),
          },
        ],
        total: 1,
      })

      render(<StatusTab onTabChange={mockOnTabChange} />)

      await waitFor(() => {
        expect(screen.getByTestId('approval-row-approval-1')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('查看详情'))

      await waitFor(() => {
        expect(screen.getByTestId('approval-detail-approval-1')).toBeInTheDocument()
      })
    })

    it('shows approve and reject buttons for pending approval', async () => {
      vi.mocked(client.getHealth).mockResolvedValue({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        modules: { api: { status: 'healthy' } },
      })
      vi.mocked(client.getApprovals).mockResolvedValue({
        approvals: [
          {
            id: 'approval-1',
            userId: 'user1',
            sessionId: 's1',
            status: 'pending',
            actionType: 'test',
            resource: 'resource-1',
            requestedBy: 'user1',
            requestedAt: new Date().toISOString(),
          },
        ],
        total: 1,
      })

      render(<StatusTab onTabChange={mockOnTabChange} />)

      await waitFor(() => {
        expect(screen.getByTestId('approval-row-approval-1')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('查看详情'))

      await waitFor(() => {
        expect(screen.getByTestId('approval-approve-approval-1')).toBeInTheDocument()
        expect(screen.getByTestId('approval-reject-approval-1')).toBeInTheDocument()
      })
    })

    it('calls respondApproval with approve_once decision', async () => {
      vi.mocked(client.getHealth).mockResolvedValue({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        modules: { api: { status: 'healthy' } },
      })
      vi.mocked(client.getApprovals).mockResolvedValue({
        approvals: [
          {
            id: 'approval-1',
            userId: 'user1',
            sessionId: 's1',
            status: 'pending',
            actionType: 'test',
            resource: 'resource-1',
            requestedBy: 'user1',
            requestedAt: new Date().toISOString(),
          },
        ],
        total: 1,
      })
      vi.mocked(client.respondApproval).mockResolvedValue({
        success: true,
        approvalId: 'approval-1',
        status: 'approved',
      })

      render(<StatusTab onTabChange={mockOnTabChange} />)

      await waitFor(() => {
        expect(screen.getByTestId('approval-row-approval-1')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('查看详情'))

      await waitFor(() => {
        expect(screen.getByTestId('approval-approve-approval-1')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('approval-approve-approval-1'))

      await waitFor(() => {
        expect(client.respondApproval).toHaveBeenCalledWith('approval-1', 'approve_once', undefined)
      })
    })

    it('calls respondApproval with reject decision and reason', async () => {
      vi.mocked(client.getHealth).mockResolvedValue({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        modules: { api: { status: 'healthy' } },
      })
      vi.mocked(client.getApprovals).mockResolvedValue({
        approvals: [
          {
            id: 'approval-1',
            userId: 'user1',
            sessionId: 's1',
            status: 'pending',
            actionType: 'test',
            resource: 'resource-1',
            requestedBy: 'user1',
            requestedAt: new Date().toISOString(),
          },
        ],
        total: 1,
      })
      vi.mocked(client.respondApproval).mockResolvedValue({
        success: true,
        approvalId: 'approval-1',
        status: 'rejected',
      })

      render(<StatusTab onTabChange={mockOnTabChange} />)

      await waitFor(() => {
        expect(screen.getByTestId('approval-row-approval-1')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('查看详情'))

      await waitFor(() => {
        expect(screen.getByTestId('approval-reject-approval-1')).toBeInTheDocument()
      })

      const reasonInput = screen.getByPlaceholderText('审批意见（可选）')
      fireEvent.change(reasonInput, { target: { value: 'not authorized' } })

      fireEvent.click(screen.getByTestId('approval-reject-approval-1'))

      await waitFor(() => {
        expect(client.respondApproval).toHaveBeenCalledWith('approval-1', 'reject', 'not authorized')
      })
    })

    it('shows resolution info for resolved approvals', async () => {
      vi.mocked(client.getHealth).mockResolvedValue({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        modules: { api: { status: 'healthy' } },
      })
      vi.mocked(client.getApprovals).mockResolvedValue({
        approvals: [
          {
            id: 'approval-1',
            userId: 'user1',
            sessionId: 's1',
            status: 'approved',
            actionType: 'test',
            resource: 'resource-1',
            requestedBy: 'user1',
            requestedAt: new Date().toISOString(),
            responseBy: 'admin',
            responseReason: 'looks good',
          },
        ],
        total: 1,
      })

      render(<StatusTab onTabChange={mockOnTabChange} />)

      await waitFor(() => {
        expect(screen.getByTestId('approval-row-approval-1')).toBeInTheDocument()
      })

      expect(screen.getByText('已批准')).toBeInTheDocument()
    })
  })
})
