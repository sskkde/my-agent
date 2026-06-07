import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import UsageTab from './UsageTab'
import * as client from '../../api/client'
import type { UsageSummary, UsageResponse } from '../../api/types'

vi.mock('../../api/client', () => ({
  getUsage: vi.fn(),
}))

const createMockUsage = (overrides: Partial<UsageSummary> = {}): UsageSummary => ({
  sessionId: 'sess_' + Math.random().toString(36).slice(2),
  messageCount: 10,
  turnCount: 5,
  toolCallCount: 3,
  approvalCount: 1,
  artifactCount: 2,
  runCount: 1,
  estimatedInputTokens: 1000,
  estimatedOutputTokens: 500,
  estimatedTotalTokens: 1500,
  estimatedCostCents: 100,
  updatedAt: new Date().toISOString(),
  ...overrides,
})

describe('UsageTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('displays loading state initially', () => {
    vi.mocked(client.getUsage).mockImplementation(() => new Promise(() => {}))

    render(<UsageTab />)

    expect(screen.getByTestId('usage-panel')).toBeInTheDocument()
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('displays empty state when no usage data', async () => {
    vi.mocked(client.getUsage).mockResolvedValue({
      usages: [],
      total: 0,
    } as UsageResponse)

    render(<UsageTab />)

    await waitFor(() => {
      expect(screen.getByTestId('usage-empty-state')).toBeInTheDocument()
    })
    expect(screen.getByTestId('usage-empty-state')).toHaveTextContent('暂无用量数据')
  })

  it('displays error state when API fails', async () => {
    vi.mocked(client.getUsage).mockRejectedValue(new Error('Network error'))

    render(<UsageTab />)

    await waitFor(() => {
      expect(screen.getByTestId('usage-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('usage-error')).toHaveTextContent('加载失败')
    expect(screen.getByTestId('usage-error')).toHaveTextContent('Network error')
  })

  it('displays aggregate cards with correct data', async () => {
    const mockUsages = [
      createMockUsage({
        messageCount: 10,
        toolCallCount: 3,
        approvalCount: 1,
        estimatedTotalTokens: 1500,
        estimatedCostCents: 100,
      }),
      createMockUsage({
        messageCount: 20,
        toolCallCount: 5,
        approvalCount: 2,
        estimatedTotalTokens: 2500,
        estimatedCostCents: 200,
      }),
    ]

    vi.mocked(client.getUsage).mockResolvedValue({
      usages: mockUsages,
      total: 2,
    } as UsageResponse)

    render(<UsageTab />)

    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument()
    })

    expect(screen.getByText('总会话数').nextElementSibling).toHaveTextContent('2')
    expect(screen.getByText('总消息数').nextElementSibling).toHaveTextContent('30')
    expect(screen.getByText('总工具调用').nextElementSibling).toHaveTextContent('8')
    expect(screen.getByText('总审批数').nextElementSibling).toHaveTextContent('3')
    expect(screen.getByText('总Token数').nextElementSibling).toHaveTextContent('4,000')
    expect(screen.getByText('预估总成本').nextElementSibling).toHaveTextContent('$3.00')
  })

  it('displays "未配置" for null cost', async () => {
    const mockUsages = [createMockUsage({ estimatedCostCents: null })]

    vi.mocked(client.getUsage).mockResolvedValue({
      usages: mockUsages,
      total: 1,
    } as UsageResponse)

    render(<UsageTab />)

    await waitFor(() => {
      expect(screen.getByText('预估总成本').nextElementSibling).toHaveTextContent('未配置')
    })
  })

  it('displays per-session usage table', async () => {
    const mockUsages = [
      createMockUsage({
        sessionId: 'session-abc123xyz',
        messageCount: 10,
        estimatedTotalTokens: 1500,
        estimatedCostCents: 100,
      }),
      createMockUsage({
        sessionId: 'session-def456uvw',
        messageCount: 20,
        estimatedTotalTokens: 2500,
        estimatedCostCents: 200,
      }),
    ]

    vi.mocked(client.getUsage).mockResolvedValue({
      usages: mockUsages,
      total: 2,
    } as UsageResponse)

    render(<UsageTab />)

    await waitFor(() => {
      expect(screen.getAllByText('session-abc1')[0]).toBeInTheDocument()
    })

    expect(screen.getAllByText('session-abc1')[0]).toBeInTheDocument()
    expect(screen.getAllByText('session-def4')[0]).toBeInTheDocument()
    expect(screen.getAllByText('10')[0]).toBeInTheDocument()
    expect(screen.getAllByText('20')[0]).toBeInTheDocument()
    expect(screen.getAllByText('1,500')[0]).toBeInTheDocument()
    expect(screen.getAllByText('$1.00')[0]).toBeInTheDocument()
  })

  it('displays "未配置" for null cost in table', async () => {
    const mockUsages = [createMockUsage({ sessionId: 'session-abc123xyz', estimatedCostCents: null })]

    vi.mocked(client.getUsage).mockResolvedValue({
      usages: mockUsages,
      total: 1,
    } as UsageResponse)

    render(<UsageTab />)

    await waitFor(() => {
      const costCells = screen.getAllByText('未配置')
      const tableCostCell = costCells.find((el) => el.classList.contains('usage-cost--muted'))
      expect(tableCostCell).toBeInTheDocument()
    })
  })

  it('displays pagination when there are multiple pages', async () => {
    const mockUsages = Array.from({ length: 10 }, (_, i) => createMockUsage({ sessionId: `session-${i}` }))

    vi.mocked(client.getUsage).mockResolvedValue({
      usages: mockUsages,
      total: 25,
    } as UsageResponse)

    render(<UsageTab />)

    await waitFor(() => {
      expect(screen.getByText('第 1 页 / 共 3 页 (共 25 条)')).toBeInTheDocument()
    })

    expect(screen.getByText('上一页')).toBeDisabled()
    expect(screen.getByText('下一页')).toBeEnabled()
  })

  it('handles pagination navigation', async () => {
    const user = userEvent.setup()
    const mockUsages = Array.from({ length: 10 }, (_, i) => createMockUsage({ sessionId: `session-${i}` }))

    vi.mocked(client.getUsage).mockResolvedValue({
      usages: mockUsages,
      total: 25,
    } as UsageResponse)

    render(<UsageTab />)

    await waitFor(() => {
      expect(screen.getByText('下一页')).toBeEnabled()
    })

    await user.click(screen.getByText('下一页'))

    await waitFor(() => {
      expect(client.getUsage).toHaveBeenCalledWith(undefined, 10, 10)
    })
  })

  it('retry button calls fetch again on error', async () => {
    const user = userEvent.setup()
    vi.mocked(client.getUsage).mockRejectedValue(new Error('Network error'))

    render(<UsageTab />)

    await waitFor(() => {
      expect(screen.getByTestId('usage-error')).toBeInTheDocument()
    })

    vi.mocked(client.getUsage).mockResolvedValue({
      usages: [createMockUsage()],
      total: 1,
    } as UsageResponse)

    await user.click(screen.getByText('重试'))

    await waitFor(() => {
      expect(client.getUsage).toHaveBeenCalledTimes(2)
    })
  })

  it('truncates session IDs to 12 characters', async () => {
    const mockUsages = [createMockUsage({ sessionId: 'very-long-session-id-that-needs-truncation' })]

    vi.mocked(client.getUsage).mockResolvedValue({
      usages: mockUsages,
      total: 1,
    } as UsageResponse)

    render(<UsageTab />)

    await waitFor(() => {
      expect(screen.getAllByText('very-long-se')[0]).toBeInTheDocument()
    })
    expect(screen.queryByText('very-long-session-id-that-needs-truncation')).not.toBeInTheDocument()
  })
})
