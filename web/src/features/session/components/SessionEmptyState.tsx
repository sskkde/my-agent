import React from 'react'
import agentAvatarUrl from '../../../assets/default-agent-avatar.svg?url'
import emptyStateIllustrationUrl from '../../../assets/empty-state-illustration.svg?url'

export interface SessionEmptyStateProps {
  onToggleSidebar: () => void
  isDrawerOpen: boolean
}

const QUICK_PROMPTS = [
  '帮我规划今天的工作流',
  '总结最近一次运行状态',
  '检查待审批任务',
]

export const SessionEmptyState: React.FC<SessionEmptyStateProps> = ({ onToggleSidebar, isDrawerOpen }) => {
  return (
    <>
      {/* Mobile session sidebar toggle for empty state */}
      <div className="timeline-header timeline-header--empty">
        <button
          className="session-sidebar-toggle"
          data-testid="session-sidebar-toggle"
          onClick={onToggleSidebar}
          aria-controls="sessions-sidebar"
          aria-label="打开会话列表"
          aria-expanded={isDrawerOpen}
        >
          ☰
        </button>
        <h3>会话控制台</h3>
      </div>
      <div className="session-empty-state session-empty-state--branded" data-testid="session-empty-state">
        <div className="session-empty-state__media" aria-hidden="true">
          <img className="session-empty-state__illustration" src={emptyStateIllustrationUrl} alt="" />
          <img className="session-empty-state__avatar" src={agentAvatarUrl} alt="" />
        </div>

        <p className="session-empty-state__eyebrow">Agent Platform</p>
        <h2 className="session-empty-state__title">准备好启动你的智能体会话</h2>
        <p className="session-empty-state__description">
          选择一个最近会话继续上下文，或从快捷 prompt 开始一次新的协作。
        </p>

        <div className="session-empty-state__quick-prompts" aria-label="快捷 prompt">
          {QUICK_PROMPTS.map((prompt) => (
            <button key={prompt} className="session-empty-state__prompt" type="button">
              {prompt}
            </button>
          ))}
        </div>

        <button
          className="session-empty-state__recent-button"
          type="button"
          onClick={onToggleSidebar}
          aria-controls="sessions-sidebar"
          aria-expanded={isDrawerOpen}
        >
          查看最近会话
        </button>
      </div>
    </>
  )
}
