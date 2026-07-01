/**
 * ChatContextPanel - Right-side context panel for chat session
 *
 * Displays the work plan overview and a placeholder desk for future
 * files/resources integration.
 */

import React from 'react'
import { showToast } from './ChatToast'
import TodoWorkPlanCard from '../../context/TodoWorkPlanCard'

export interface ChatContextPanelProps {
  sessionId?: string | null
}

const EXAMPLE_DESK_ITEMS = [
  { id: 'd1', name: '暖纸主题设计规范.md', type: '文档', time: '刚刚编辑', icon: 'doc' },
  { id: 'd2', name: 'theme-warm-paper.css', type: '代码', time: '2 小时前', icon: 'code' },
  { id: 'd3', name: '配色方案参考', type: '笔记', time: '昨天', icon: 'note' },
  { id: 'd4', name: '界面截图对比.png', type: '图片', time: '昨天', icon: 'image' },
  { id: 'd5', name: 'HanaAgent 仓库链接', type: '链接', time: '2 天前', icon: 'link' },
  { id: 'd6', name: '字体加载策略笔记', type: '笔记', time: '3 天前', icon: 'note' },
]

function DeskIcon({ icon }: { icon: string }) {
  switch (icon) {
    case 'doc':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      )
    case 'code':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      )
    case 'note':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      )
    case 'image':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      )
    case 'link':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      )
  }
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
          <div className="chat-rs-panel__actions">
            <button className="chat-rs-panel__action" aria-label="筛选" title="筛选" onClick={() => showToast('筛选后续接入')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
              </svg>
            </button>
          </div>
        </div>
        <div className="chat-rs-panel__body">
          <button className="chat-rs-add-btn" onClick={() => showToast('添加任务后续接入')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>添加任务</span>
          </button>
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
          <div className="chat-rs-panel__actions">
            <button className="chat-rs-panel__action" aria-label="筛选" title="筛选" onClick={() => showToast('筛选后续接入')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
              </svg>
            </button>
          </div>
        </div>
        <div className="chat-rs-panel__body">
          <button className="chat-rs-add-btn" onClick={() => showToast('放到书桌后续接入')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>放到书桌</span>
          </button>
          <div className="chat-desk-list" data-testid="chat-desk-list">
            {EXAMPLE_DESK_ITEMS.map(item => (
              <div key={item.id} className="chat-desk-item" data-testid="chat-desk-item">
                <div className="chat-desk-item__icon">
                  <DeskIcon icon={item.icon} />
                </div>
                <div className="chat-desk-item__main">
                  <div className="chat-desk-item__name">{item.name}</div>
                  <div className="chat-desk-item__meta">
                    <span>{item.type}</span>
                    <span> · {item.time}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChatContextPanel
