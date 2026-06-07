import React, { useEffect, useState, useCallback } from 'react'
import { getUsage } from '../../api/client'
import type { UsageResponse, UsageSummary } from '../../api/types'
import LoadingSpinner from '../../components/LoadingSpinner'

interface UsageState {
  data: UsageResponse | null
  loading: boolean
  error: string | null
}

const UsageTab: React.FC = () => {
  const [state, setState] = useState<UsageState>({
    data: null,
    loading: true,
    error: null,
  })
  const [offset, setOffset] = useState(0)
  const limit = 10

  const fetchUsage = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const response = await getUsage(undefined, limit, offset)
      setState({ data: response, loading: false, error: null })
    } catch (err) {
      setState({
        data: null,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch usage data',
      })
    }
  }, [offset])

  useEffect(() => {
    fetchUsage()
  }, [fetchUsage])

  const calculateAggregates = (usages: UsageSummary[]) => {
    return usages.reduce(
      (acc, usage) => ({
        totalSessions: acc.totalSessions + 1,
        totalMessages: acc.totalMessages + usage.messageCount,
        totalToolCalls: acc.totalToolCalls + usage.toolCallCount,
        totalApprovals: acc.totalApprovals + usage.approvalCount,
        totalTokens: acc.totalTokens + usage.estimatedTotalTokens,
        totalCostCents:
          usage.estimatedCostCents !== null ? acc.totalCostCents + usage.estimatedCostCents : acc.totalCostCents,
        hasCostConfigured: acc.hasCostConfigured || usage.estimatedCostCents !== null,
      }),
      {
        totalSessions: 0,
        totalMessages: 0,
        totalToolCalls: 0,
        totalApprovals: 0,
        totalTokens: 0,
        totalCostCents: 0,
        hasCostConfigured: false,
      },
    )
  }

  const formatCost = (cents: number | null): string => {
    if (cents === null) return '未配置'
    return `$${(cents / 100).toFixed(2)}`
  }

  const formatNumber = (num: number): string => {
    return num.toLocaleString()
  }

  const truncateSessionId = (sessionId: string): string => {
    return sessionId.slice(0, 12)
  }

  if (state.loading) {
    return (
      <div className="usage-tab" data-testid="usage-panel">
        <LoadingSpinner label="加载用量数据..." />
      </div>
    )
  }

  if (state.error) {
    return (
      <div className="usage-tab" data-testid="usage-panel">
        <div className="usage-error" data-testid="usage-error">
          <p>加载失败: {state.error}</p>
          <button type="button" className="retry-button" onClick={fetchUsage}>
            重试
          </button>
        </div>
      </div>
    )
  }

  const usages = state.data?.usages ?? []
  const total = state.data?.total ?? 0

  if (usages.length === 0) {
    return (
      <div className="usage-tab" data-testid="usage-panel">
        <div className="usage-empty-state" data-testid="usage-empty-state">
          暂无用量数据
        </div>
      </div>
    )
  }

  const aggregates = calculateAggregates(usages)
  const totalPages = Math.ceil(total / limit)
  const currentPage = Math.floor(offset / limit) + 1

  return (
    <div className="usage-tab" data-testid="usage-panel">
      <div className="usage-aggregates">
        <div className="usage-card">
          <div className="usage-card__label">总会话数</div>
          <div className="usage-card__value">{formatNumber(aggregates.totalSessions)}</div>
        </div>
        <div className="usage-card">
          <div className="usage-card__label">总消息数</div>
          <div className="usage-card__value">{formatNumber(aggregates.totalMessages)}</div>
        </div>
        <div className="usage-card">
          <div className="usage-card__label">总工具调用</div>
          <div className="usage-card__value">{formatNumber(aggregates.totalToolCalls)}</div>
        </div>
        <div className="usage-card">
          <div className="usage-card__label">总审批数</div>
          <div className="usage-card__value">{formatNumber(aggregates.totalApprovals)}</div>
        </div>
        <div className="usage-card">
          <div className="usage-card__label">总Token数</div>
          <div className="usage-card__value">{formatNumber(aggregates.totalTokens)}</div>
        </div>
        <div className="usage-card">
          <div className="usage-card__label">预估总成本</div>
          <div className={`usage-card__value ${!aggregates.hasCostConfigured ? 'usage-card__value--muted' : ''}`}>
            {aggregates.hasCostConfigured ? formatCost(aggregates.totalCostCents) : '未配置'}
          </div>
        </div>
      </div>

      <div className="usage-table-section">
        <h3 className="usage-table__title">会话用量详情</h3>

        {/* Desktop table - hidden on mobile */}
        <div className="usage-table-container">
          <table className="usage-table">
            <thead>
              <tr>
                <th>会话ID</th>
                <th>消息数</th>
                <th>Token数</th>
                <th>预估成本</th>
              </tr>
            </thead>
            <tbody>
              {usages.map((usage) => (
                <tr key={usage.sessionId}>
                  <td className="usage-table__session-id">{truncateSessionId(usage.sessionId)}</td>
                  <td>{formatNumber(usage.messageCount)}</td>
                  <td>{formatNumber(usage.estimatedTotalTokens)}</td>
                  <td>
                    <span className={usage.estimatedCostCents === null ? 'usage-cost--muted' : ''}>
                      {formatCost(usage.estimatedCostCents)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile card list - visible only on phone */}
        <div className="usage-mobile-list" data-testid="usage-mobile-list">
          {usages.map((usage) => (
            <div key={usage.sessionId} className="usage-mobile-card" data-testid={`usage-card-${usage.sessionId}`}>
              <div className="usage-mobile-card__row">
                <span className="usage-mobile-card__label">会话ID</span>
                <span className="usage-mobile-card__value usage-mobile-card__value--monospace">
                  {truncateSessionId(usage.sessionId)}
                </span>
              </div>
              <div className="usage-mobile-card__row">
                <span className="usage-mobile-card__label">消息数</span>
                <span className="usage-mobile-card__value">{formatNumber(usage.messageCount)}</span>
              </div>
              <div className="usage-mobile-card__row">
                <span className="usage-mobile-card__label">Token数</span>
                <span className="usage-mobile-card__value">{formatNumber(usage.estimatedTotalTokens)}</span>
              </div>
              <div className="usage-mobile-card__row">
                <span className="usage-mobile-card__label">预估成本</span>
                <span
                  className={`usage-mobile-card__value ${
                    usage.estimatedCostCents === null ? 'usage-mobile-card__value--muted' : ''
                  }`}
                >
                  {formatCost(usage.estimatedCostCents)}
                </span>
              </div>
            </div>
          ))}
        </div>

        {totalPages > 1 && (
          <div className="usage-pagination">
            <button
              type="button"
              className="usage-pagination__button"
              onClick={() => setOffset((prev) => Math.max(0, prev - limit))}
              disabled={offset === 0}
            >
              上一页
            </button>
            <span className="usage-pagination__info">
              第 {currentPage} 页 / 共 {totalPages} 页 (共 {total} 条)
            </span>
            <button
              type="button"
              className="usage-pagination__button"
              onClick={() => setOffset((prev) => Math.min((totalPages - 1) * limit, prev + limit))}
              disabled={currentPage >= totalPages}
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default UsageTab
