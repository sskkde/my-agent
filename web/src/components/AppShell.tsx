import React, { useState, useEffect, useMemo } from 'react'
import TabNav, { TabId } from './TabNav'
import { NAV_GROUPS, getNavItemById, NavGroup } from '../navigation/navigation-config'
import { ICONS } from '../navigation/icons'
import type { UserMetadata } from '../api/types'
import '../styles.css'

interface AppShellProps {
  children: React.ReactNode
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  onToggleNavCollapsed?: () => void
  isNavCollapsed?: boolean
  user?: UserMetadata | null
  onLogout?: () => void
}

const AppShell: React.FC<AppShellProps> = ({
  children,
  activeTab,
  onTabChange,
  onToggleNavCollapsed,
  isNavCollapsed: controlledNavCollapsed,
  user,
  onLogout,
}) => {
  const [internalNavCollapsed, setInternalNavCollapsed] = useState(false)
  const [isNavDrawerOpen, setIsNavDrawerOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  const isNavCollapsed = controlledNavCollapsed !== undefined ? controlledNavCollapsed : internalNavCollapsed

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      setIsMobile(false)
      return
    }

    const checkMobile = () => {
      const mobileQuery = window.matchMedia('(max-width: 1100px)')
      setIsMobile(mobileQuery.matches)
    }

    checkMobile()

    const mediaQuery = window.matchMedia('(max-width: 1100px)')
    const handleChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches)
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  const handleToggleNavCollapsed = () => {
    if (onToggleNavCollapsed) {
      onToggleNavCollapsed()
    } else {
      setInternalNavCollapsed((prev) => !prev)
    }
  }

  const handleToggleMobileDrawer = () => {
    setIsNavDrawerOpen((prev) => !prev)
  }

  const handleLogout = () => {
    if (onLogout) {
      onLogout()
    }
  }

  const handleTabChange = (tab: TabId) => {
    onTabChange(tab)
    if (isMobile) {
      setIsNavDrawerOpen(false)
    }
  }

  const breadcrumb = useMemo(() => {
    const navItem = getNavItemById(activeTab)
    if (!navItem) return 'Agent Platform'

    let group: NavGroup | undefined
    for (const g of NAV_GROUPS) {
      if (g.items.some((item) => item.id === activeTab)) {
        group = g
        break
      }
    }

    if (group) {
      return `Agent Platform › ${group.label} › ${navItem.label}`
    }

    return `Agent Platform › ${navItem.label}`
  }, [activeTab])

  useEffect(() => {
    const navItem = getNavItemById(activeTab)
    if (navItem) {
      document.title = `${navItem.label} - Agent Platform`
    } else {
      document.title = 'Agent Platform'
    }
  }, [activeTab])

  const shellClasses = [
    'shell',
    isNavCollapsed ? 'shell--nav-collapsed' : '',
    isNavDrawerOpen ? 'shell--nav-drawer-open' : '',
    isMobile ? 'shell--mobile' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const CollapseIcon = ICONS.chevronLeft

  return (
    <div data-testid="app-shell" className={shellClasses}>
      <header data-testid="topbar" className="shell__topbar">
        <div className="topbar__breadcrumb">{breadcrumb}</div>

        {user && (
          <div className="topbar__user" data-testid="topbar-user">
            <span className="topbar__username" data-testid="username-display">
              {user.username}
            </span>
            {onLogout && (
              <button
                className="topbar__logout-button"
                onClick={handleLogout}
                data-testid="logout-button"
                title="退出登录"
              >
                退出
              </button>
            )}
          </div>
        )}

        <button
          data-testid="mobile-nav-toggle"
          className="mobile-nav-toggle"
          onClick={handleToggleMobileDrawer}
          aria-expanded={isNavDrawerOpen}
          aria-controls="sidebar"
          aria-label={isNavDrawerOpen ? 'Close navigation' : 'Open navigation'}
        >
          <span className="sr-only">Menu</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </header>

      {isMobile && isNavDrawerOpen && (
        <div
          data-testid="mobile-nav-backdrop"
          className="mobile-nav-backdrop"
          aria-hidden="true"
          onClick={() => setIsNavDrawerOpen(false)}
        />
      )}

      <div className="shell__nav-wrapper">
        <aside
          data-testid="sidebar"
          id="sidebar"
          className={`sidebar-shell ${isNavCollapsed ? 'sidebar-shell--collapsed' : ''}`}
        >
          <div className="sidebar-shell__header">
            <h1 className="sidebar-shell__brand">Agent Platform</h1>
            <button
              data-testid="sidebar-collapse-toggle"
              className="sidebar-collapse-toggle"
              onClick={handleToggleNavCollapsed}
              aria-expanded={!isNavCollapsed}
              aria-controls="sidebar"
              aria-label={isNavCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={isNavCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <CollapseIcon className={`collapse-icon ${isNavCollapsed ? 'collapse-icon--flipped' : ''}`} />
            </button>
          </div>

          <div className="sidebar-shell__body">
            <TabNav activeTab={activeTab} onTabChange={handleTabChange} />
          </div>

          <div className="sidebar-shell__footer">
            <span className="version-badge">v1.0.0</span>
          </div>
        </aside>
      </div>

      <main data-testid="content-panel" className="shell__content">
        {children}
      </main>
    </div>
  )
}

export default AppShell
