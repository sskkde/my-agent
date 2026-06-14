/**
 * ContextDeskPanel - Right panel workspace for reference materials
 *
 * Displays three main sections:
 * - 工作计划 (Work Plan): Current plan status
 * - 书桌 (Desk): Files/resources area
 * - 活动概览 (Activity Overview): Summary of runs, approvals, tool activity, memory
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
// Activity Summary Card Component
// =============================================================================

interface ActivitySummaryProps {
  runsState: CardState<RunsCardData>
  approvalState: CardState<ApprovalCardData>
  toolActivityState: CardState<ToolActivityCardData>
  memoryState: CardState<MemoryCardData>
  sessionId: string | null
  maxItems: number
}

/**
 * ActivitySummaryCard - Compact summary of activity metrics
 */
const ActivitySummaryCard: React.FC<ActivitySummaryProps> = ({
  runsState,
  approvalState,
  toolActivityState,
  memoryState,
}) => {
  // Extract counts from each state
  const runsCount = isReady(runsState) ? runsState.data.total : 0
  const runningCount = isReady(runsState) 
    ? runsState.data.runs.filter(r => r.status === 'running').length 
    : 0
  const pendingApprovals = isReady(approvalState) 
    ? approvalState.data.approvals.filter(a => a.status === 'pending').length 
    : 0
  const toolEvents = isReady(toolActivityState) ? toolActivityState.data.total : 0
  const memoryCount = isReady(memoryState) ? memoryState.data.total : 0

  return (
    <div className="workspace-card workspace-card--activity-summary" data-testid="activity-summary">
      <div className="activity-summary__metrics">
        <div className="activity-metric">
          <span className="activity-metric__value">{runningCount}</span>
          <span className="activity-metric__label">运行中</span>
        </div>
        <div className="activity-metric">
          <span className="activity-metric__value">{pendingApprovals}</span>
          <span className="activity-metric__label">待审批</span>
        </div>
        <div className="activity-metric">
          <span className="activity-metric__value">{runsCount}</span>
          <span className="activity-metric__label">总运行</span>
        </div>
        <div className="activity-metric">
          <span className="activity-metric__value">{toolEvents}</span>
          <span className="activity-metric__label">工具调用</span>
        </div>
        <div className="activity-metric">
          <span className="activity-metric__value">{memoryCount}</span>
          <span className="activity-metric__label">记忆条目</span>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// ContextDeskPanel Component
// =============================================================================

/**
 * ContextDeskPanel - Workspace panel with three main sections
 *
 * Renders:
 * - 工作计划 (Work Plan): Current plan status placeholder
 * - 书桌 (Desk): Files/resources area placeholder
 * - 活动概览 (Activity Overview): Activity summary + detailed cards
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

  return (
    <div
      className={`workspace-panel companion-panel ${className}`}
      data-testid={testId}
      data-active-tab={activeTab}
      data-session-id={scopedSessionId ?? undefined}
    >
      {/* Section 1: 工作计划 (Work Plan) */}
      <section className="workspace-section" aria-labelledby="workspace-plan-title">
        <div className="workspace-section__header">
          <h3 id="workspace-plan-title" className="workspace-section__title">工作计划</h3>
        </div>
        <div className="workspace-card workspace-card--plan" data-testid="workspace-plan">
          <div className="workspace-plan__placeholder">
            <div className="workspace-plan__icon">📋</div>
            <div className="workspace-plan__text">
              <span className="workspace-plan__title">当前无活动计划</span>
              <span className="workspace-plan__hint">计划功能即将上线</span>
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: 书桌 (Desk) */}
      <section className="workspace-section" aria-labelledby="workspace-desk-title">
        <div className="workspace-section__header">
          <h3 id="workspace-desk-title" className="workspace-section__title">书桌</h3>
        </div>
        <div className="workspace-card workspace-card--desk" data-testid="workspace-desk">
          <div className="workspace-desk__placeholder">
            <div className="workspace-desk__icon">📁</div>
            <div className="workspace-desk__text">
              <span className="workspace-desk__title">文件与资源</span>
              <span className="workspace-desk__hint">上传或关联文件以在此处查看</span>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: 活动概览 (Activity Overview) */}
      <section className="workspace-section workspace-section--activity" aria-labelledby="workspace-activity-title">
        <div className="workspace-section__header">
          <h3 id="workspace-activity-title" className="workspace-section__title">活动概览</h3>
        </div>
        
        {/* Activity Summary Card */}
        <ActivitySummaryCard
          runsState={runsState}
          approvalState={approvalState}
          toolActivityState={toolActivityState}
          memoryState={memoryState}
          sessionId={scopedSessionId}
          maxItems={maxItems}
        />

        {/* Detailed Activity Cards */}
        <div className="workspace-activity__cards">
          <CardErrorBoundary fallback={CardErrorFallback}>
            <RunsCard state={runsState} sessionId={scopedSessionId} maxItems={maxItems} />
          </CardErrorBoundary>

          <CardErrorBoundary fallback={CardErrorFallback}>
            <ApprovalCard state={approvalState} sessionId={scopedSessionId} maxItems={maxItems} />
          </CardErrorBoundary>

          <CardErrorBoundary fallback={CardErrorFallback}>
            <ToolActivityCard
              state={toolActivityState}
              sessionId={scopedSessionId || 'unknown'}
              maxItems={maxItems}
            />
          </CardErrorBoundary>

          <CardErrorBoundary fallback={CardErrorFallback}>
            <MemoryCard state={memoryState} maxItems={maxItems} />
          </CardErrorBoundary>
        </div>
      </section>
    </div>
  )
}

export default ContextDeskPanel
