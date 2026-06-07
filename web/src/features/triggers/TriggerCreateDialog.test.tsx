import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TriggerCreateDialog from './TriggerCreateDialog'
import * as triggersApi from '../../api/triggers'
import * as client from '../../api/client'

vi.mock('../../api/triggers')
vi.mock('../../api/client')

describe('TriggerCreateDialog', () => {
  const mockOnClose = vi.fn()
  const mockOnSuccess = vi.fn()

  const mockWorkflows = [
    {
      workflowId: 'wf-1',
      name: 'Workflow 1',
      version: 1,
      steps: [],
      ownerUserId: 'user-1',
      status: 'active',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      workflowId: 'wf-2',
      name: 'Workflow 2',
      version: 1,
      steps: [],
      ownerUserId: 'user-1',
      status: 'active',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(client.listWorkflowDefinitions).mockResolvedValue(mockWorkflows)
  })

  it('does not render when isOpen is false', () => {
    render(<TriggerCreateDialog isOpen={false} onClose={mockOnClose} onSuccess={mockOnSuccess} />)
    expect(screen.queryByTestId('trigger-create-dialog')).not.toBeInTheDocument()
  })

  it('renders dialog when isOpen is true', async () => {
    render(<TriggerCreateDialog isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)
    await waitFor(() => {
      expect(screen.getByTestId('trigger-create-dialog')).toBeInTheDocument()
    })
    expect(screen.getByText('创建触发器')).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', async () => {
    render(<TriggerCreateDialog isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)
    await waitFor(() => {
      expect(screen.getByTestId('trigger-create-dialog')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('trigger-create-close'))
    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('shows schedule and webhook tabs', async () => {
    render(<TriggerCreateDialog isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)
    await waitFor(() => {
      expect(screen.getByTestId('trigger-create-dialog')).toBeInTheDocument()
    })
    expect(screen.getByTestId('tab-schedule')).toBeInTheDocument()
    expect(screen.getByTestId('tab-webhook')).toBeInTheDocument()
  })

  it('shows schedule form by default', async () => {
    render(<TriggerCreateDialog isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)
    await waitFor(() => {
      expect(screen.getByTestId('trigger-create-dialog')).toBeInTheDocument()
    })
    expect(screen.getByTestId('schedule-name-input')).toBeInTheDocument()
    expect(screen.getByTestId('cron-expression-input')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-selector')).toBeInTheDocument()
  })

  it('switches to webhook form when webhook tab is clicked', async () => {
    render(<TriggerCreateDialog isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)
    await waitFor(() => {
      expect(screen.getByTestId('trigger-create-dialog')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('tab-webhook'))
    expect(screen.getByTestId('webhook-name-input')).toBeInTheDocument()
    expect(screen.getByTestId('webhook-url-display')).toBeInTheDocument()
    expect(screen.getByTestId('webhook-secret-display')).toBeInTheDocument()
  })

  it('shows validation error when schedule name is empty', async () => {
    render(<TriggerCreateDialog isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)
    await waitFor(() => {
      expect(screen.getByTestId('trigger-create-dialog')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('trigger-create-submit'))
    expect(screen.getByText('请输入触发器名称')).toBeInTheDocument()
  })

  it('shows validation error when cron expression is empty', async () => {
    render(<TriggerCreateDialog isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)
    await waitFor(() => {
      expect(screen.getByTestId('trigger-create-dialog')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByTestId('schedule-name-input'), { target: { value: 'Test Trigger' } })
    fireEvent.click(screen.getByTestId('trigger-create-submit'))
    expect(screen.getByText('请输入 Cron 表达式')).toBeInTheDocument()
  })

  it('shows validation error when cron expression is invalid', async () => {
    render(<TriggerCreateDialog isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)
    await waitFor(() => {
      expect(screen.getByTestId('trigger-create-dialog')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByTestId('schedule-name-input'), { target: { value: 'Test Trigger' } })
    fireEvent.change(screen.getByTestId('cron-expression-input'), { target: { value: 'invalid-cron' } })
    fireEvent.click(screen.getByTestId('trigger-create-submit'))
    expect(screen.getByText('Cron 表达式格式无效')).toBeInTheDocument()
  })

  it('shows next execution preview for valid cron expression', async () => {
    render(<TriggerCreateDialog isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)
    await waitFor(() => {
      expect(screen.getByTestId('trigger-create-dialog')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByTestId('cron-expression-input'), { target: { value: '0 9 * * *' } })
    await waitFor(() => {
      expect(screen.getByTestId('next-execution-preview')).toBeInTheDocument()
    })
  })

  it('creates schedule trigger successfully', async () => {
    vi.mocked(triggersApi.createScheduleTrigger).mockResolvedValue({
      scheduleId: 'sched-1',
      name: 'Test Schedule',
      schedulePattern: '0 9 * * *',
      status: 'active',
      runCount: 0,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    })

    render(<TriggerCreateDialog isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)
    await waitFor(() => {
      expect(screen.getByTestId('trigger-create-dialog')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('schedule-name-input'), { target: { value: 'Test Schedule' } })
    fireEvent.change(screen.getByTestId('cron-expression-input'), { target: { value: '0 9 * * *' } })
    fireEvent.click(screen.getByTestId('trigger-create-submit'))

    await waitFor(() => {
      expect(triggersApi.createScheduleTrigger).toHaveBeenCalledWith('Test Schedule', '0 9 * * *')
    })
    expect(mockOnSuccess).toHaveBeenCalledTimes(1)
    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('creates webhook trigger successfully', async () => {
    vi.mocked(triggersApi.createWebhookTrigger).mockResolvedValue({
      webhookId: 'wh-1',
      name: 'Test Webhook',
      status: 'active',
      secretLast4: '1234',
      secret: 'abc123secret456',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    })

    render(<TriggerCreateDialog isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)
    await waitFor(() => {
      expect(screen.getByTestId('trigger-create-dialog')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('tab-webhook'))
    fireEvent.change(screen.getByTestId('webhook-name-input'), { target: { value: 'Test Webhook' } })
    fireEvent.click(screen.getByTestId('trigger-create-submit'))

    await waitFor(() => {
      expect(triggersApi.createWebhookTrigger).toHaveBeenCalledWith('Test Webhook')
    })
    expect(mockOnSuccess).toHaveBeenCalledTimes(1)
    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('shows validation error when webhook name is empty', async () => {
    render(<TriggerCreateDialog isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)
    await waitFor(() => {
      expect(screen.getByTestId('trigger-create-dialog')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('tab-webhook'))
    fireEvent.click(screen.getByTestId('trigger-create-submit'))
    expect(screen.getByText('请输入触发器名称')).toBeInTheDocument()
  })

  it('shows API error message when creation fails', async () => {
    const mockError = new Error('Cron 表达式无效')
    vi.mocked(triggersApi.createScheduleTrigger).mockRejectedValue(mockError)

    render(<TriggerCreateDialog isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)
    await waitFor(() => {
      expect(screen.getByTestId('trigger-create-dialog')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('schedule-name-input'), { target: { value: 'Test Schedule' } })
    fireEvent.change(screen.getByTestId('cron-expression-input'), { target: { value: '0 9 * * *' } })
    fireEvent.click(screen.getByTestId('trigger-create-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('api-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('api-error')).toHaveTextContent('Cron 表达式无效')
    expect(mockOnSuccess).not.toHaveBeenCalled()
    expect(mockOnClose).not.toHaveBeenCalled()
  })

  it('loads workflows for selector dropdown', async () => {
    render(<TriggerCreateDialog isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)
    await waitFor(() => {
      expect(client.listWorkflowDefinitions).toHaveBeenCalled()
    })
    await waitFor(() => {
      const selector = screen.getByTestId('workflow-selector')
      expect(selector).toBeInTheDocument()
    })
  })

  it('disables submit button while loading', async () => {
    vi.mocked(triggersApi.createScheduleTrigger).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100)),
    )

    render(<TriggerCreateDialog isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)
    await waitFor(() => {
      expect(screen.getByTestId('trigger-create-dialog')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('schedule-name-input'), { target: { value: 'Test Schedule' } })
    fireEvent.change(screen.getByTestId('cron-expression-input'), { target: { value: '0 9 * * *' } })
    fireEvent.click(screen.getByTestId('trigger-create-submit'))

    expect(screen.getByTestId('trigger-create-submit')).toBeDisabled()
  })

  it('resets form when dialog is reopened', async () => {
    const { rerender } = render(<TriggerCreateDialog isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)
    await waitFor(() => {
      expect(screen.getByTestId('trigger-create-dialog')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('schedule-name-input'), { target: { value: 'Test Schedule' } })
    expect(screen.getByTestId('schedule-name-input')).toHaveValue('Test Schedule')

    rerender(<TriggerCreateDialog isOpen={false} onClose={mockOnClose} onSuccess={mockOnSuccess} />)
    rerender(<TriggerCreateDialog isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)

    await waitFor(() => {
      expect(screen.getByTestId('schedule-name-input')).toHaveValue('')
    })
  })
})
