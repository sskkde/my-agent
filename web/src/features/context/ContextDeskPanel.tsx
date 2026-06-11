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
import { isReady } from './card-state'
import type { TabId } from '../../components/TabNav'

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
  activeTab?: TabId
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
  <div className="context-card companion-card context-card--error">
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
  activeTab,
  maxItems = 5,
  className = '',
  testId = 'context-desk-panel',
}) => {
  const scopedSessionId = sessionId || null
  const sessionLabel = scopedSessionId ?? '未选择会话'
  const activeRun = isReady(runsState)
    ? runsState.data.runs.find((run) => run.status === 'running') ?? runsState.data.runs[0]
    : null
  const pendingApprovalCount = isReady(approvalState)
    ? approvalState.data.approvals.filter((approval) => approval.status === 'pending').length
    : null

  return (
    <div
      className={`context-desk-panel companion-panel ${className}`}
      data-testid={testId}
      data-active-tab={activeTab}
      data-session-id={scopedSessionId ?? undefined}
    >
      <section className="companion-section" aria-labelledby="context-current-session-title">
        <div className="companion-section__header">
          <h3 id="context-current-session-title" className="companion-section__title">当前 Session</h3>
        </div>
        <div className="companion-card companion-card--summary" data-testid="context-current-session">
          <dl className="context-session-summary">
            <div className="context-session-summary__row">
              <dt>Session</dt>
              <dd>{sessionLabel}</dd>
            </div>
            <div className="context-session-summary__row">
              <dt>Active tab</dt>
              <dd>{activeTab ?? 'unknown'}</dd>
            </div>
            <div className="context-session-summary__row">
              <dt>Active run</dt>
              <dd>{activeRun ? (activeRun.objective || activeRun.runId) : '暂无活动 run'}</dd>
            </div>
            <div className="context-session-summary__row">
              <dt>Pending approvals</dt>
              <dd>{pendingApprovalCount ?? '—'}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="companion-section" aria-labelledby="context-active-run-title">
        <div className="companion-section__header">
          <h3 id="context-active-run-title" className="companion-section__title">活动 Run</h3>
        </div>
        <CardErrorBoundary fallback={CardErrorFallback}>
          <RunsCard state={runsState} sessionId={scopedSessionId} maxItems={maxItems} />
        </CardErrorBoundary>
      </section>

      <section className="companion-section" aria-labelledby="context-memory-title">
        <div className="companion-section__header">
          <h3 id="context-memory-title" className="companion-section__title">Memory</h3>
        </div>
        <CardErrorBoundary fallback={CardErrorFallback}>
          <MemoryCard state={memoryState} maxItems={maxItems} />
        </CardErrorBoundary>
      </section>

      <section className="companion-section" aria-labelledby="context-tool-activity-title">
        <div className="companion-section__header">
          <h3 id="context-tool-activity-title" className="companion-section__title">Tool Activity</h3>
        </div>
        <CardErrorBoundary fallback={CardErrorFallback}>
          <ToolActivityCard
            state={toolActivityState}
            sessionId={scopedSessionId || 'unknown'}
            maxItems={maxItems}
          />
        </CardErrorBoundary>
      </section>

      <section className="companion-section" aria-labelledby="context-pending-approvals-title">
        <div className="companion-section__header">
          <h3 id="context-pending-approvals-title" className="companion-section__title">Pending Approvals</h3>
        </div>
        <CardErrorBoundary fallback={CardErrorFallback}>
          <ApprovalCard state={approvalState} sessionId={scopedSessionId} maxItems={maxItems} />
        </CardErrorBoundary>
      </section>
    </div>
  )
}

export default ContextDeskPanel
