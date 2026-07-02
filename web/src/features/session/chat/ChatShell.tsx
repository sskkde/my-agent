import React, { useState, useEffect } from 'react'
import type { UserMetadata } from '../../../api/types'
import FloatingSettingsMenu from '../../settings/FloatingSettingsMenu'

export interface ChatShellProps {
  title: string
  sidebar: React.ReactNode
  rightPanel: React.ReactNode
  children: React.ReactNode
  initialSidebarOpen?: boolean
  initialRightOpen?: boolean
  user?: UserMetadata | null
  onLogout?: () => void
}

const ChatShell: React.FC<ChatShellProps> = ({
  title,
  sidebar,
  rightPanel,
  children,
  initialSidebarOpen = true,
  initialRightOpen = true,
  user,
  onLogout,
}) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(initialSidebarOpen)
  const [isRightOpen, setIsRightOpen] = useState(initialRightOpen)
  const [isMobile, setIsMobile] = useState(false)
  const [isTabletOrBelow, setIsTabletOrBelow] = useState(false)

  useEffect(() => {
    const check = () => {
      if (typeof window !== 'undefined' && window.matchMedia) {
        const mobile = window.matchMedia('(max-width: 768px)').matches
        const tabletOrBelow = window.matchMedia('(max-width: 1024px)').matches
        setIsMobile(mobile)
        setIsTabletOrBelow(tabletOrBelow)
      } else {
        setIsMobile(false)
        setIsTabletOrBelow(false)
      }
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    if (isMobile) {
      setIsSidebarOpen(false)
      setIsRightOpen(false)
    } else if (isTabletOrBelow) {
      setIsSidebarOpen(true)
      setIsRightOpen(false)
    } else {
      setIsSidebarOpen(initialSidebarOpen)
      setIsRightOpen(initialRightOpen)
    }
  }, [isMobile, isTabletOrBelow, initialSidebarOpen, initialRightOpen])

  useEffect(() => {
    const anyDrawerOpen = (isMobile && isSidebarOpen) || isRightOpen
    const el = document.querySelector('.chat-page')
    if (el instanceof HTMLElement) {
      el.style.overflow = anyDrawerOpen ? 'hidden' : ''
    }
    return () => {
      const el = document.querySelector('.chat-page')
      if (el instanceof HTMLElement) {
        el.style.overflow = ''
      }
    }
  }, [isMobile, isSidebarOpen, isRightOpen])

  return (
    <div className="chat-page" data-testid="chat-shell">
      <header className="chat-titlebar">
        <div className="chat-titlebar__left">
          <button
            className="chat-titlebar__btn"
            aria-label="切换侧边栏"
            title="切换侧边栏"
            onClick={() => setIsSidebarOpen((v) => !v)}
            data-testid="chat-sidebar-toggle"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
        <div className="chat-titlebar__title">{title}</div>
        <div className="chat-titlebar__right">
          {user && (
            <div className="chat-titlebar__user" data-testid="chat-titlebar-user">
              <span className="chat-titlebar__username" data-testid="username-display">{user.username}</span>
              {onLogout && (
                <button
                  className="chat-titlebar__logout"
                  onClick={onLogout}
                  data-testid="chat-titlebar-logout"
                  title="退出登录"
                >
                  退出
                </button>
              )}
            </div>
          )}
          <FloatingSettingsMenu />
          <button
            className="chat-titlebar__btn"
            aria-label="切换右侧栏"
            title="切换右侧栏"
            onClick={() => setIsRightOpen((v) => !v)}
            data-testid="chat-right-toggle"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="15" y1="3" x2="15" y2="21" />
              <line x1="15" y1="12" x2="21" y2="12" />
            </svg>
          </button>
        </div>
      </header>

      <div className="chat-shell">
        {isMobile && isSidebarOpen && (
          <div
            className="chat-drawer-backdrop"
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
            data-testid="chat-left-backdrop"
          />
        )}
        <aside className={`chat-sidebar ${isSidebarOpen ? '' : 'collapsed'}`} role="dialog" aria-modal="true" data-testid="chat-sidebar">
          {sidebar}
        </aside>

        <main className="chat-main" data-testid="chat-main">
          {children}
        </main>

        {isTabletOrBelow && isRightOpen && (
          <div
            className="chat-drawer-backdrop"
            onClick={() => setIsRightOpen(false)}
            aria-hidden="true"
            data-testid="chat-right-backdrop"
          />
        )}
        <aside className={`chat-right-sidebar ${isRightOpen ? '' : 'collapsed'}`} role="dialog" aria-modal="true" data-testid="chat-right-sidebar">
          {rightPanel}
        </aside>
      </div>
    </div>
  )
}

export default ChatShell
