/**
 * ChatContextPanel - Right-side context panel for chat session
 *
 * Displays the work plan overview and the desk workdir card.
 */

import React from 'react'
import TodoWorkPlanCard from '../../context/TodoWorkPlanCard'
import DeskWorkdirCard from '../../context/DeskWorkdirCard'

export interface ChatContextPanelProps {
  sessionId?: string | null
}

const ChatContextPanel: React.FC<ChatContextPanelProps> = ({ sessionId }) => {
  return (
    <div className="chat-right-sidebar__inner" data-testid="chat-context-panel">
      <div className="chat-rs-panel chat-rs-panel--top">
        <div className="chat-rs-panel__header">
          <span className="chat-rs-panel__title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            工作计划
          </span>
        </div>
        <div className="chat-rs-panel__body">
          <TodoWorkPlanCard sessionId={sessionId} />
        </div>
      </div>

      <div className="chat-rs-panel chat-rs-panel--bottom">
        <div className="chat-rs-panel__header">
          <span className="chat-rs-panel__title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            书桌
          </span>
        </div>
        <div className="chat-rs-panel__body">
          <DeskWorkdirCard sessionId={sessionId} />
        </div>
      </div>
    </div>
  )
}

export default ChatContextPanel
