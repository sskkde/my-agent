import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApprovalCard } from './ApprovalCard'
import { ToastProvider } from './Toast'

vi.mock('../api/client', () => ({
  respondApproval: vi.fn(),
}))

import * as api from '../api/client'

const mockRespondApproval = api.respondApproval as ReturnType<typeof vi.fn>

const renderWithProviders = (props: React.ComponentProps<typeof ApprovalCard>) => {
  return render(
    <ToastProvider>
      <ApprovalCard {...props} />
    </ToastProvider>,
  )
}

describe('ApprovalCard', () => {
  const defaultProps = {
    approvalId: 'approval-123',
    actionType: 'file.write',
    status: 'pending' as const,
    onApprove: vi.fn(),
    onReject: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders action type', () => {
    renderWithProviders(defaultProps)
    expect(screen.getByText('file.write')).toBeInTheDocument()
  })

  it('renders resource when provided', () => {
    renderWithProviders({ ...defaultProps, resource: '/path/to/file.ts' })
    expect(screen.getByText('/path/to/file.ts')).toBeInTheDocument()
  })

  it('renders justification when provided', () => {
    renderWithProviders({ ...defaultProps, justification: 'Need to update config' })
    expect(screen.getByText('Need to update config')).toBeInTheDocument()
  })

  it('renders risk level badge when provided', () => {
    renderWithProviders({ ...defaultProps, riskLevel: 'high' })
    expect(screen.getByText('高风险')).toBeInTheDocument()
  })

  it('renders low risk level badge', () => {
    renderWithProviders({ ...defaultProps, riskLevel: 'low' })
    expect(screen.getByText('低风险')).toBeInTheDocument()
  })

  it('renders medium risk level badge', () => {
    renderWithProviders({ ...defaultProps, riskLevel: 'medium' })
    expect(screen.getByText('中风险')).toBeInTheDocument()
  })

  it('shows approve and reject buttons for pending status', () => {
    renderWithProviders(defaultProps)
    expect(screen.getByTestId('approval-approve-approval-123')).toBeInTheDocument()
    expect(screen.getByTestId('approval-reject-approval-123')).toBeInTheDocument()
  })

  it('shows approved status without buttons', () => {
    renderWithProviders({ ...defaultProps, status: 'approved' })
    expect(screen.getByText('已批准')).toBeInTheDocument()
    expect(screen.queryByTestId(/approval-approve/)).not.toBeInTheDocument()
    expect(screen.queryByTestId(/approval-reject/)).not.toBeInTheDocument()
  })

  it('shows rejected status without buttons', () => {
    renderWithProviders({ ...defaultProps, status: 'rejected' })
    expect(screen.getByText('已拒绝')).toBeInTheDocument()
    expect(screen.queryByTestId(/approval-approve/)).not.toBeInTheDocument()
    expect(screen.queryByTestId(/approval-reject/)).not.toBeInTheDocument()
  })

  it('calls approve API and onApprove callback when approve clicked', async () => {
    mockRespondApproval.mockResolvedValue({ success: true, approvalId: 'approval-123', status: 'approved' })

    renderWithProviders(defaultProps)

    fireEvent.click(screen.getByTestId('approval-approve-approval-123'))

    await waitFor(() => {
      expect(mockRespondApproval).toHaveBeenCalledWith('approval-123', 'approved')
    })

    await waitFor(() => {
      expect(defaultProps.onApprove).toHaveBeenCalledWith('approval-123')
    })

    await waitFor(() => {
      expect(screen.getByText('已批准')).toBeInTheDocument()
    })
  })

  it('calls reject API and onReject callback when reject clicked', async () => {
    mockRespondApproval.mockResolvedValue({ success: true, approvalId: 'approval-123', status: 'rejected' })

    renderWithProviders(defaultProps)

    fireEvent.click(screen.getByTestId('approval-reject-approval-123'))

    await waitFor(() => {
      expect(mockRespondApproval).toHaveBeenCalledWith('approval-123', 'rejected', undefined)
    })

    await waitFor(() => {
      expect(defaultProps.onReject).toHaveBeenCalledWith('approval-123')
    })

    await waitFor(() => {
      expect(screen.getByText('已拒绝')).toBeInTheDocument()
    })
  })

  it('shows loading state while action is in progress', async () => {
    mockRespondApproval.mockReturnValue(new Promise(() => {}))

    renderWithProviders(defaultProps)

    const approveBtn = screen.getByTestId('approval-approve-approval-123')
    expect(approveBtn).toHaveTextContent('批准')

    fireEvent.click(approveBtn)

    await waitFor(() => {
      expect(screen.getByTestId('approval-approve-approval-123')).toHaveTextContent('处理中...')
    })
  })

  it('disables buttons while submitting', async () => {
    mockRespondApproval.mockReturnValue(new Promise(() => {}))

    renderWithProviders(defaultProps)

    const approveBtn = screen.getByTestId('approval-approve-approval-123')
    const rejectBtn = screen.getByTestId('approval-reject-approval-123')

    fireEvent.click(approveBtn)

    await waitFor(() => {
      expect(approveBtn).toBeDisabled()
      expect(rejectBtn).toBeDisabled()
    })
  })

  it('shows error message on API failure', async () => {
    mockRespondApproval.mockRejectedValue(new Error('Network error'))

    renderWithProviders(defaultProps)

    fireEvent.click(screen.getByTestId('approval-approve-approval-123'))

    await waitFor(() => {
      expect(screen.getByTestId('approval-error')).toHaveTextContent('Network error')
    })

    expect(screen.getByTestId('approval-approve-approval-123')).toBeInTheDocument()
  })

  it('applies correct status data attribute', () => {
    const { rerender } = renderWithProviders({ ...defaultProps, status: 'pending' })
    expect(screen.getByTestId('approval-card')).toHaveAttribute('data-status', 'pending')

    rerender(
      <ToastProvider>
        <ApprovalCard {...defaultProps} status="approved" />
      </ToastProvider>,
    )
    expect(screen.getByTestId('approval-card')).toHaveAttribute('data-status', 'approved')

    rerender(
      <ToastProvider>
        <ApprovalCard {...defaultProps} status="rejected" />
      </ToastProvider>,
    )
    expect(screen.getByTestId('approval-card')).toHaveAttribute('data-status', 'rejected')
  })

  it('shows success toast on approve', async () => {
    mockRespondApproval.mockResolvedValue({ success: true, approvalId: 'approval-123', status: 'approved' })

    renderWithProviders(defaultProps)

    fireEvent.click(screen.getByTestId('approval-approve-approval-123'))

    await waitFor(() => {
      expect(screen.getByText('审批已通过')).toBeInTheDocument()
    })
  })

  it('shows success toast on reject', async () => {
    mockRespondApproval.mockResolvedValue({ success: true, approvalId: 'approval-123', status: 'rejected' })

    renderWithProviders(defaultProps)

    fireEvent.click(screen.getByTestId('approval-reject-approval-123'))

    await waitFor(() => {
      expect(screen.getByText('审批已拒绝')).toBeInTheDocument()
    })
  })
})
