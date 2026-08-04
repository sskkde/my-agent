import React from 'react'
import type { ChildSessionInfo } from '../../../api/types'
import { StreamStatusIndicator } from '../components/StreamStatusIndicator'
import type { ChildStatus } from './child-session-utils'
import { statusLabels } from './child-session-utils'

export const ChildSessionSidebar: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <div className="chat-sidebar__inner child-session-sidebar" data-testid="child-session-sidebar">
    <div className="chat-sidebar__header">
      <span className="chat-sidebar__title">子会话</span>
    </div>
    <div className="child-session-sidebar__note">这是父会话中的内部任务，仅展示当前任务时间线。</div>
    <button type="button" className="chat-new-btn child-session-sidebar__back" onClick={onBack}>
      <span aria-hidden="true">←</span>
      返回父会话
    </button>
  </div>
)

export const ChildSessionContext: React.FC<{
  child: ChildSessionInfo
  status: ChildStatus
  streamStatus: 'connecting' | 'connected' | 'disconnected'
  onRetry: () => void
}> = ({ child, status, streamStatus, onRetry }) => (
  <section className="child-session-context" aria-label="子会话信息" data-testid="child-session-context">
    <div className="child-session-context__eyebrow">任务上下文</div>
    <h2 className="child-session-context__title">{child.title || '子任务'}</h2>
    <dl className="child-session-context__details">
      <div>
        <dt>代理配置</dt>
        <dd>{child.agentProfile}</dd>
      </div>
      <div>
        <dt>启动方式</dt>
        <dd>{child.launchMode === 'background' ? '后台任务' : '前台任务'}</dd>
      </div>
    </dl>
    <div className={`child-session-status child-session-status--${status}`} data-testid="child-session-status">
      {statusLabels[status]}
    </div>
    <div className="child-session-context__stream" data-testid="child-session-stream-status">
      <StreamStatusIndicator streamStatus={streamStatus} onRetry={onRetry} retryLabel="重试子会话连接" />
    </div>
  </section>
)

export const ChildSessionNotFound: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <div className="child-session-safe-state" data-testid="child-session-not-found" role="alert">
    <div className="child-session-safe-state__mark" aria-hidden="true">
      404
    </div>
    <h1>找不到该子任务</h1>
    <p>该任务不存在，或你没有访问权限。</p>
    <button type="button" className="child-session-safe-state__back" onClick={onBack}>
      返回父会话
    </button>
  </div>
)

export const ChildSessionError: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <div className="child-session-safe-state" data-testid="child-session-error" role="alert">
    <div className="child-session-safe-state__mark" aria-hidden="true">
      !
    </div>
    <h1>子会话暂时不可用</h1>
    <p>加载失败，请稍后重试或返回父会话。</p>
    <button type="button" className="child-session-safe-state__back" onClick={onBack}>
      返回父会话
    </button>
  </div>
)
