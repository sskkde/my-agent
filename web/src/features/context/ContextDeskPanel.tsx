/**
 * ContextDeskPanel - Container for context desk summary cards
 *
 * Displays read-only summary cards for:
 * - Approvals (pending approval requests)
 * - Memory (memory entries)
 * - Runs (background runs)
 * - Tool Activity (tool call/result events)
 *
 * READ-ONLY POLICY:
 * All cards are strictly read-only. No approve/reject/edit/run-control actions.
 * Card failures are localized and do not crash the Chat interface.
 *
 * Error Isolation:
 * Each card is wrapped in an error boundary to prevent cascading failures.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react'
import ApprovalCard from './ApprovalCard'
import MemoryCard from './MemoryCard'
import RunsCard from './RunsCard'
import ToolActivityCard from './ToolActivityCard'
import type {
  ApprovalCardData,
  MemoryCardData,
  RunsCardData,
  ToolActivityCardData,
} from './card-contracts'
import type { CardState } from './card-state'

// =============================================================================
// Error Boundary for Card Isolation
// =============================================================================

interface ErrorBoundaryProps {
  children: ReactNode
  fallback: (error: Error) => ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

/**
 * Error boundary to isolate card failures
 */
class CardErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Context card error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return this.props.fallback(this.state.error)
    }

    return this.props.children
  }
}

// =============================================================================
// ContextDeskPanel Props
// =============================================================================

export interface ContextDeskPanelProps {
  approvalState: CardState<ApprovalCardData>
  memoryState: CardState<MemoryCardData>
  runsState: CardState<RunsCardData>
  toolActivityState: CardState<ToolActivityCardData>
  sessionId?: string | null
  maxItems?: number
  className?: string
  testId?: string
}

// =============================================================================
// Fallback Components
// =============================================================================

/**
 * Error fallback for individual cards
 */
const CardErrorFallback = (err: Error): ReactNode => (
  <div className="context-card context-card--error">
    <div className="context-card__error">
      <span className="context-card__error-icon">⚠️</span>
      <span className="context-card__error-text">
        卡片加载失败: {err.message}
      </span>
    </div>
  </div>
)

// =============================================================================
// ContextDeskPanel Component
// =============================================================================

/**
 * ContextDeskPanel - Grid layout for context summary cards
 *
 * Renders four read-only cards in a responsive grid:
 * - Top row: Approvals, Memory
 * - Bottom row: Runs, Tool Activity
 *
 * Each card is isolated in an error boundary to prevent cascading failures.
 */
const ContextDeskPanel: React.FC<ContextDeskPanelProps> = ({
  approvalState,
  memoryState,
  runsState,
  toolActivityState,
  sessionId,
  maxItems = 5,
  className = '',
  testId = 'context-desk-panel',
}) => {
  return (
    <div
      className={`context-desk-panel ${className}`}
      data-testid={testId}
    >
      <div className="context-desk-panel__grid">
        {/* Approvals Card */}
        <CardErrorBoundary fallback={CardErrorFallback}>
          <ApprovalCard state={approvalState} maxItems={maxItems} />
        </CardErrorBoundary>

        {/* Memory Card */}
        <CardErrorBoundary fallback={CardErrorFallback}>
          <MemoryCard state={memoryState} maxItems={maxItems} />
        </CardErrorBoundary>

        {/* Runs Card */}
        <CardErrorBoundary fallback={CardErrorFallback}>
          <RunsCard state={runsState} maxItems={maxItems} />
        </CardErrorBoundary>

        {/* Tool Activity Card */}
        <CardErrorBoundary fallback={CardErrorFallback}>
          <ToolActivityCard
            state={toolActivityState}
            sessionId={sessionId || 'unknown'}
            maxItems={maxItems}
          />
        </CardErrorBoundary>
      </div>
    </div>
  )
}

export default ContextDeskPanel
