/**
 * ApprovalCard - Read-only approval requests summary
 *
 * Displays pending approvals for a session.
 * READ-ONLY: No approve/reject actions. Navigate to ApprovalsTab for actions.
 */

import React from 'react'
import Card from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import type { ApprovalCardProps } from './card-contracts'
import { isLoading, isReady, isEmpty, isError } from './card-state'

/**
 * Status badge variant mapping
 */
const STATUS_VARIANTS: Record<string, 'warning' | 'success' | 'error' | 'default'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  expired: 'default',
  cancelled: 'default',
}

/**
 * ApprovalCard component
 *
 * Renders a summary of approval requests with:
 * - Loading state with spinner
 * - Error state with message
 * - Empty state with hint
 * - Ready state with approval list
 */
const ApprovalCard: React.FC<ApprovalCardProps> = ({ state, maxItems = 5 }) => {
  const renderContent = () => {
    if (isLoading(state)) {
      return (
        <div className="context-card__loading">
          <div className="context-card__spinner" />
          <span className="context-card__loading-text">加载中...</span>
        </div>
      )
    }

    if (isError(state)) {
      return (
        <div className="context-card__error">
          <span className="context-card__error-icon">⚠️</span>
          <span className="context-card__error-text">{state.message}</span>
        </div>
      )
    }

    if (isEmpty(state)) {
      return (
        <div className="context-card__empty">
          <span className="context-card__empty-icon">📋</span>
          <span className="context-card__empty-text">{state.message}</span>
          {state.hint && <span className="context-card__empty-hint">{state.hint}</span>}
        </div>
      )
    }

    if (isReady(state)) {
      const { data } = state
      const displayApprovals = data.approvals.slice(0, maxItems)
      const hasMore = data.total > maxItems

      return (
        <>
          <div className="context-card__list">
            {displayApprovals.map((approval) => (
              <div key={approval.id} className="context-card__item">
                <div className="context-card__item-header">
                  <span className="context-card__item-title">{approval.actionType}</span>
                  <Badge variant={STATUS_VARIANTS[approval.status] || 'default'} size="small">
                    {approval.status}
                  </Badge>
                </div>
                {approval.resource && (
                  <div className="context-card__item-meta">{approval.resource}</div>
                )}
              </div>
            ))}
          </div>
          {hasMore && (
            <div className="context-card__footer">
              <span className="context-card__more">还有 {data.total - maxItems} 项...</span>
            </div>
          )}
        </>
      )
    }

    return null
  }

  return (
    <Card className="context-card" data-testid="context-card-approvals">
      <Card.Header>
        <h3 className="context-card__title">审批请求</h3>
      </Card.Header>
      <Card.Content>{renderContent()}</Card.Content>
    </Card>
  )
}

export default ApprovalCard
