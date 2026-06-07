/**
 * ToolActivityCard - Read-only tool activity log
 *
 * Displays tool calls and results for a session.
 * READ-ONLY: This is a log view only. No actions available.
 * Data derived from session timeline filtered by eventType (tool_call, tool_result).
 */

import React from 'react'
import Card from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import type { ToolActivityCardProps } from './card-contracts'
import { isLoading, isReady, isEmpty, isError } from './card-state'

/**
 * Event type badge variant mapping
 */
const EVENT_VARIANTS: Record<string, 'info' | 'default'> = {
  tool_call: 'info',
  tool_result: 'default',
}

/**
 * ToolActivityCard component
 *
 * Renders a summary of tool activity with:
 * - Loading state with spinner
 * - Error state with message
 * - Empty state with hint
 * - Ready state with tool events list
 */
const ToolActivityCard: React.FC<ToolActivityCardProps> = ({ state, maxItems = 5 }) => {
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
          <span className="context-card__empty-icon">🔧</span>
          <span className="context-card__empty-text">{state.message}</span>
          {state.hint && <span className="context-card__empty-hint">{state.hint}</span>}
        </div>
      )
    }

    if (isReady(state)) {
      const { data } = state
      const displayEvents = data.events.slice(0, maxItems)
      const hasMore = data.total > maxItems

      return (
        <>
          <div className="context-card__list">
            {displayEvents.map((event) => {
              const toolName = event.metadata?.toolName as string | undefined
              return (
                <div key={event.eventId} className="context-card__item context-card__item--tool">
                  <div className="context-card__item-header">
                    <Badge variant={EVENT_VARIANTS[event.eventType] || 'default'} size="small">
                      {event.eventType === 'tool_call' ? '调用' : '结果'}
                    </Badge>
                    <span className="context-card__item-title">
                      {toolName || event.eventType}
                    </span>
                  </div>
                  {event.content && (
                    <div className="context-card__item-content">{event.content}</div>
                  )}
                </div>
              )
            })}
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
    <Card className="context-card" data-testid="context-card-tools">
      <Card.Header>
        <h3 className="context-card__title">工具活动</h3>
      </Card.Header>
      <Card.Content>{renderContent()}</Card.Content>
    </Card>
  )
}

export default ToolActivityCard
