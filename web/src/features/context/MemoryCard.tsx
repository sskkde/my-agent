/**
 * MemoryCard - Read-only memory entries summary
 *
 * Displays memory entries for context.
 * READ-ONLY: No delete/edit actions. Navigate to MemoryTab for actions.
 * Memory API is global with no sessionId filter.
 */

import React from 'react'
import Card from '../../components/ui/Card'
import type { MemoryCardProps } from './card-contracts'
import { isLoading, isReady, isEmpty, isError } from './card-state'

/**
 * MemoryCard component
 *
 * Renders a summary of memory entries with:
 * - Loading state with spinner
 * - Error state with message
 * - Empty state with hint
 * - Ready state with memory list
 */
const MemoryCard: React.FC<MemoryCardProps> = ({ state, maxItems = 5 }) => {
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
          <span className="context-card__empty-icon">💾</span>
          <span className="context-card__empty-text">{state.message}</span>
          {state.hint && <span className="context-card__empty-hint">{state.hint}</span>}
        </div>
      )
    }

    if (isReady(state)) {
      const { data } = state
      const displayMemories = data.memories.slice(0, maxItems)
      const hasMore = data.total > maxItems

      return (
        <>
          <div className="context-card__list">
            {displayMemories.map((memory) => (
              <div key={memory.memoryId} className="context-card__item">
                <div className="context-card__item-header">
                  <span className="context-card__item-title">{memory.type}</span>
                </div>
                <div className="context-card__item-content">{memory.content}</div>
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
    <Card className="context-card" data-testid="context-card-memory">
      <Card.Header>
        <h3 className="context-card__title">记忆条目</h3>
      </Card.Header>
      <Card.Content>{renderContent()}</Card.Content>
    </Card>
  )
}

export default MemoryCard
