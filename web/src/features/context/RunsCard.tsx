/**
 * RunsCard - Read-only background runs summary
 *
 * Displays background runs for a session.
 * READ-ONLY: No run-control actions (pause/resume/cancel).
 * Navigate to ObservabilityTab for control actions.
 */

import React from 'react'
import Card from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import type { RunsCardProps } from './card-contracts'
import { isLoading, isReady, isEmpty, isError } from './card-state'

/**
 * Status badge variant mapping
 */
const STATUS_VARIANTS: Record<string, 'warning' | 'success' | 'error' | 'info' | 'default'> = {
  pending: 'warning',
  running: 'info',
  completed: 'success',
  failed: 'error',
  cancelled: 'default',
}

/**
 * RunsCard component
 *
 * Renders a summary of background runs with:
 * - Loading state with spinner
 * - Error state with message
 * - Empty state with hint
 * - Ready state with runs list
 */
const RunsCard: React.FC<RunsCardProps> = ({ state, maxItems = 5 }) => {
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
          <span className="context-card__empty-icon">⚡</span>
          <span className="context-card__empty-text">{state.message}</span>
          {state.hint && <span className="context-card__empty-hint">{state.hint}</span>}
        </div>
      )
    }

    if (isReady(state)) {
      const { data } = state
      const displayRuns = data.runs.slice(0, maxItems)
      const hasMore = data.total > maxItems

      return (
        <>
          <div className="context-card__list">
            {displayRuns.map((run) => (
              <div key={run.runId} className="context-card__item">
                <div className="context-card__item-header">
                  <span className="context-card__item-title">
                    {run.objective || run.runId.substring(0, 8)}
                  </span>
                  <Badge variant={STATUS_VARIANTS[run.status] || 'default'} size="small">
                    {run.status}
                  </Badge>
                </div>
                {run.progress !== undefined && run.progress > 0 && (
                  <div className="context-card__item-meta">
                    <div className="context-card__progress-bar">
                      <div
                        className="context-card__progress-fill"
                        style={{ width: `${Math.min(run.progress, 100)}%` }}
                      />
                    </div>
                  </div>
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
    <Card className="context-card" data-testid="context-card-runs">
      <Card.Header>
        <h3 className="context-card__title">运行记录</h3>
      </Card.Header>
      <Card.Content>{renderContent()}</Card.Content>
    </Card>
  )
}

export default RunsCard
