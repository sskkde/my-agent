/**
 * ContextDeskPanel - Right panel workspace for reference materials
 *
 * Displays two main sections:
 * - 工作计划 (Work Plan): Current plan status
 * - 书桌 (Desk): Files/resources area
 */

import React from 'react'
import type { TabId } from '../../components/TabNav'

// =============================================================================
// ContextDeskPanel Props
// =============================================================================

export interface ContextDeskPanelProps {
  sessionId?: string | null
  activeTab?: TabId
  maxItems?: number
  className?: string
  testId?: string
}



// =============================================================================
// ContextDeskPanel Component
// =============================================================================

/**
 * ContextDeskPanel - Workspace panel with two main sections
 *
 * Renders:
 * - 工作计划 (Work Plan): Current plan status placeholder
 * - 书桌 (Desk): Files/resources area placeholder
 */
const ContextDeskPanel: React.FC<ContextDeskPanelProps> = ({
  sessionId,
  activeTab,
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
    </div>
  )
}

export default ContextDeskPanel
