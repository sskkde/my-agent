import React, { useState, useEffect, useMemo, useCallback } from 'react'
import TabNav, { TabId } from '../components/TabNav'
import { NAV_GROUPS, getNavItemById, NavGroup } from '../navigation/navigation-config'
import { ICONS } from '../navigation/icons'
import {
  PRODUCT_SECTIONS,
  PRODUCT_SECTION_LABELS,
  getProductSection,
  type ProductSection,
} from '../navigation/product-navigation'
import type { UserMetadata } from '../api/types'
import ContextDeskPanel from '../features/context/ContextDeskPanel'
import logoUrl from '../assets/logo.svg?url'
import type {
  ApprovalCardData,
  MemoryCardData,
  RunsCardData,
  ToolActivityCardData,
} from '../features/context/card-contracts'
import type { CardState } from '../features/context/card-state'
import { loading } from '../features/context/card-state'
import { AgentShellSidebarContext } from './AgentShellSidebarContext'
import '../styles.css'

interface AgentShellProps {
  children: React.ReactNode
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  onToggleNavCollapsed?: () => void
  isNavCollapsed?: boolean
  user?: UserMetadata | null
  onLogout?: () => void
  sessionId?: string | null
  contextDeskCards?: {
    approvalState: CardState<ApprovalCardData>
    memoryState: CardState<MemoryCardData>
    runsState: CardState<RunsCardData>
    toolActivityState: CardState<ToolActivityCardData>
  }
}

const AgentShell: React.FC<AgentShellProps> = ({
  children,
  activeTab,
  onTabChange,
  onToggleNavCollapsed,
  isNavCollapsed: controlledNavCollapsed,
  user,
  onLogout,
  sessionId,
  contextDeskCards,
}) => {
  const [internalNavCollapsed, setInternalNavCollapsed] = useState(false)
  const [isNavDrawerOpen, setIsNavDrawerOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [isContextDeskOpen, setIsContextDeskOpen] = useState(false)
  const [chatSidebarContent, setChatSidebarContent] = useState<React.ReactNode | null>(null)

  const isNavCollapsed = controlledNavCollapsed !== undefined ? controlledNavCollapsed : internalNavCollapsed

  const defaultContextDeskCards = {
    approvalState: loading(),
    memoryState: loading(),
    runsState: loading(),
    toolActivityState: loading(),
  }

  const cards = contextDeskCards || defaultContextDeskCards

  // Determine active product section
  const activeProductSection = useMemo(() => getProductSection(activeTab), [activeTab])

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

  const openNavDrawer = useCallback(() => {
    setIsNavDrawerOpen(true)
  }, [])

  const closeNavDrawer = useCallback(() => {
    setIsNavDrawerOpen(false)
  }, [])

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

  const handleProductSectionClick = (section: ProductSection) => {
    switch (section) {
      case 'chat':
        onTabChange('session-console')
        break
      case 'workspace':
        onTabChange('dashboard')
        break
      case 'operations':
        onTabChange('agent-monitor')
        break
      case 'admin':
        onTabChange('settings')
        break
    }
  }

  const handleToggleContextDesk = () => {
    setIsContextDeskOpen((prev) => !prev)
  }

  const handleCloseContextDesk = () => {
    setIsContextDeskOpen(false)
  }

  const sidebarContextValue = useMemo(
    () => ({
      setChatSidebarContent,
      openNavDrawer,
      closeNavDrawer,
    }),
    [openNavDrawer, closeNavDrawer],
  )

  const contextDeskMode = isMobile ? 'drawer' : 'companion'
  const contextDeskLabel = isContextDeskOpen ? 'Collapse context desk' : 'Open context desk'

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

  const shellClasses = [
    'shell',
    'agent-shell',
    isNavCollapsed ? 'shell--nav-collapsed' : '',
    isNavDrawerOpen ? 'shell--nav-drawer-open' : '',
    isMobile ? 'shell--mobile' : '',
    isContextDeskOpen ? 'shell--context-desk-open' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const CollapseIcon = ICONS.chevronLeft

  const renderChatHeader = () => (
    <nav className="product-nav product-nav--chat" data-testid="product-nav" role="navigation" aria-label="Product sections">
      <div className="product-nav__brand">
        <img className="product-nav__brand-logo" src={logoUrl} alt="" aria-hidden="true" />
        <span className="product-nav__brand-name">My Agent</span>
      </div>

      <div className="product-nav__switcher">
        <button
          className={`product-nav__switch ${activeProductSection === 'chat' ? 'product-nav__switch--active' : ''}`}
          onClick={() => handleProductSectionClick('chat')}
          data-testid="product-nav-chat"
          aria-current={activeProductSection === 'chat' ? 'page' : undefined}
        >
          聊天
        </button>
        <button
          className={`product-nav__switch ${activeProductSection === 'workspace' ? 'product-nav__switch--active' : ''}`}
          onClick={() => handleProductSectionClick('workspace')}
          data-testid="product-nav-workspace"
          aria-current={activeProductSection === 'workspace' ? 'page' : undefined}
        >
          工作区
        </button>
        <div className="product-nav__more">
          <button
            className={`product-nav__switch ${activeProductSection === 'operations' ? 'product-nav__switch--active' : ''}`}
            onClick={() => handleProductSectionClick('operations')}
            data-testid="product-nav-operations"
            aria-current={activeProductSection === 'operations' ? 'page' : undefined}
          >
            运维
          </button>
          <button
            className={`product-nav__switch ${activeProductSection === 'admin' ? 'product-nav__switch--active' : ''}`}
            onClick={() => handleProductSectionClick('admin')}
            data-testid="product-nav-admin"
            aria-current={activeProductSection === 'admin' ? 'page' : undefined}
          >
            管理
          </button>
        </div>
      </div>

      <div className="product-nav__controls">
        <button
          data-testid="context-desk-toggle"
          className="context-desk-toggle context-desk-toggle--chat"
          onClick={handleToggleContextDesk}
          aria-expanded={isContextDeskOpen}
          aria-label={contextDeskLabel}
          title="Context Desk"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="9" x2="15" y2="9" />
            <line x1="9" y1="12" x2="15" y2="12" />
            <line x1="9" y1="15" x2="15" y2="15" />
          </svg>
        </button>

        {user && (
          <div className="topbar__user topbar__user--chat" data-testid="topbar-user">
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
      </div>
    </nav>
  )

  return (
    <AgentShellSidebarContext.Provider value={sidebarContextValue}>
      <div data-testid="agent-shell" className="agent-shell-container">
      {/* Product Navigation Bar */}
      {activeProductSection === 'chat' ? (
        renderChatHeader()
      ) : (
        <nav className="product-nav" data-testid="product-nav" role="navigation" aria-label="Product sections">
          {PRODUCT_SECTIONS.map((section) => (
            <button
              key={section}
              className={`product-nav__item ${activeProductSection === section ? 'product-nav__item--active' : ''}`}
              onClick={() => handleProductSectionClick(section)}
              data-testid={`product-nav-${section}`}
              aria-current={activeProductSection === section ? 'page' : undefined}
            >
              {PRODUCT_SECTION_LABELS[section]}
            </button>
          ))}
        </nav>
      )}

      {/* Main Shell Content - preserves app-shell compatibility */}
      <div data-testid="app-shell" className={shellClasses}>
        <header data-testid="topbar" className="shell__topbar">
          <div className="topbar__breadcrumb">{breadcrumb}</div>

          {activeProductSection !== 'chat' && (
            <button
              data-testid="context-desk-toggle"
              className="context-desk-toggle"
              onClick={handleToggleContextDesk}
              aria-expanded={isContextDeskOpen}
              aria-label={contextDeskLabel}
              title="Context Desk"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="9" x2="15" y2="9" />
                <line x1="9" y1="12" x2="15" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            </button>
          )}

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
              <h1 className="sidebar-shell__brand">
                <img className="sidebar-shell__brand-logo" src={logoUrl} alt="" aria-hidden="true" />
                <span className="sidebar-shell__brand-name">Agent Platform</span>
              </h1>
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
              <div className="sidebar-shell__primary-nav">
                <TabNav activeTab={activeTab} onTabChange={handleTabChange} activeSection={activeProductSection} />
              </div>
              {activeProductSection === 'chat' && chatSidebarContent && (
                <div className="sidebar-shell__session-panel" data-testid="sidebar-session-panel">
                  {chatSidebarContent}
                </div>
              )}
            </div>

            <div className="sidebar-shell__footer">
              <span className="version-badge">v1.0.0</span>
            </div>
          </aside>
        </div>

        {/* Center Stage - main content area */}
        <main
          data-testid="center-stage"
          className={`shell__content center-stage ${activeProductSection === 'chat' ? 'shell__content--chat' : ''}`}
        >
          {children}
        </main>

        {/* Context Desk Panel - desktop companion, mobile drawer */}
        {isContextDeskOpen && (
          <aside
            data-testid="context-desk-panel"
            className={`context-desk context-desk--${contextDeskMode}`}
            aria-label="Context desk"
          >
            <div className="context-desk__header">
              <h2 className="context-desk__title">Context Desk</h2>
              <button
                data-testid="context-desk-close"
                className="context-desk__close"
                onClick={handleCloseContextDesk}
                aria-label="Close context desk"
                type="button"
              >
                ✕
              </button>
            </div>
            <div className="context-desk__body">
              <ContextDeskPanel
                approvalState={cards.approvalState}
                memoryState={cards.memoryState}
                runsState={cards.runsState}
                toolActivityState={cards.toolActivityState}
                sessionId={sessionId}
                activeTab={activeTab}
                maxItems={5}
                testId="context-desk-panel-content"
              />
            </div>
          </aside>
        )}
      </div>
      </div>
    </AgentShellSidebarContext.Provider>
  )
}

export default AgentShell
