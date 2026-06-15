import React, { useState, useEffect, useMemo, useCallback } from 'react'
import TabNav, { TabId } from '../components/TabNav'

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
import { AgentShellSidebarContext } from './AgentShellSidebarContext'
import packageInfo from '../../package.json'
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
}) => {
  // Determine active product section first for initial state calculation
  const activeProductSection = useMemo(() => getProductSection(activeTab), [activeTab])
  
  const [internalNavCollapsed, setInternalNavCollapsed] = useState(false)
  const [isNavDrawerOpen, setIsNavDrawerOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  // 桌面 Chat 模式默认打开右侧面板，其他模式默认关闭
  const [isContextDeskOpen, setIsContextDeskOpen] = useState(() => activeProductSection === 'chat')
  const [chatSidebarContent, setChatSidebarContent] = useState<React.ReactNode | null>(null)
  const [hasUserToggledContextDesk, setHasUserToggledContextDesk] = useState(false)

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

  // 根据产品区域和移动状态自动调整右侧面板
  useEffect(() => {
    // 用户手动操作优先，不再自动调整
    if (hasUserToggledContextDesk) {
      return
    }

    const shouldBeOpen = activeProductSection === 'chat' && !isMobile
    
    if (shouldBeOpen !== isContextDeskOpen) {
      setIsContextDeskOpen(shouldBeOpen)
    }
  }, [activeProductSection, isMobile, hasUserToggledContextDesk, isContextDeskOpen])

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
    setHasUserToggledContextDesk(true)
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
  const contextDeskLabel = isContextDeskOpen ? '收起书桌' : '展开书桌'

  const shellClasses = [
    'shell',
    'agent-shell',
    `shell--${activeProductSection}`,
    isNavCollapsed ? 'shell--nav-collapsed' : '',
    isNavDrawerOpen ? 'shell--nav-drawer-open' : '',
    isMobile ? 'shell--mobile' : '',
    isContextDeskOpen ? 'shell--context-desk-open' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const CollapseIcon = ICONS.chevronLeft

  const userControls = (
    <>
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
    </>
  )

  const contextDeskToggle = (
    <button
      data-testid="context-desk-toggle"
      className="context-desk-toggle context-desk-toggle--chat"
      onClick={handleToggleContextDesk}
      aria-expanded={isContextDeskOpen}
      aria-controls="context-desk-panel"
      aria-label={contextDeskLabel}
      title="书桌"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="9" y1="9" x2="15" y2="9" />
        <line x1="9" y1="12" x2="15" y2="12" />
        <line x1="9" y1="15" x2="15" y2="15" />
      </svg>
    </button>
  )

  const mobileNavToggle = (
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
  )

  const renderControls = () => (
    <div className="product-nav__controls">
      {contextDeskToggle}
      {userControls}
      {mobileNavToggle}
    </div>
  )

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
          {PRODUCT_SECTION_LABELS.chat}
        </button>
        <button
          className={`product-nav__switch ${activeProductSection === 'workspace' ? 'product-nav__switch--active' : ''}`}
          onClick={() => handleProductSectionClick('workspace')}
          data-testid="product-nav-workspace"
          aria-current={activeProductSection === 'workspace' ? 'page' : undefined}
        >
          {PRODUCT_SECTION_LABELS.workspace}
        </button>
        <div className="product-nav__more">
          <button
            className={`product-nav__switch ${activeProductSection === 'operations' ? 'product-nav__switch--active' : ''}`}
            onClick={() => handleProductSectionClick('operations')}
            data-testid="product-nav-operations"
            aria-current={activeProductSection === 'operations' ? 'page' : undefined}
          >
            {PRODUCT_SECTION_LABELS.operations}
          </button>
          <button
            className={`product-nav__switch ${activeProductSection === 'admin' ? 'product-nav__switch--active' : ''}`}
            onClick={() => handleProductSectionClick('admin')}
            data-testid="product-nav-admin"
            aria-current={activeProductSection === 'admin' ? 'page' : undefined}
          >
            {PRODUCT_SECTION_LABELS.admin}
          </button>
        </div>
      </div>

      {renderControls()}
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
          <div className="product-nav__switcher">
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
          </div>
          {renderControls()}
        </nav>
      )}

      {/* Main Shell Content - preserves app-shell compatibility */}
      <div data-testid="app-shell" className={shellClasses}>
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
            {activeProductSection !== 'chat' && (
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
            )}

            <div className="sidebar-shell__body">
              {activeProductSection !== 'chat' && (
                <div className="sidebar-shell__primary-nav">
                  <TabNav activeTab={activeTab} onTabChange={handleTabChange} activeSection={activeProductSection} />
                </div>
              )}
              {activeProductSection === 'chat' && chatSidebarContent && (
                <div className="sidebar-shell__session-panel" data-testid="sidebar-session-panel">
                  {chatSidebarContent}
                </div>
              )}
            </div>

            <div className="sidebar-shell__footer">
              <span className="version-badge">v{packageInfo.version}</span>
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
        {isContextDeskOpen && contextDeskMode === 'drawer' && (
          <div
            data-testid="context-desk-backdrop"
            className="context-desk-backdrop"
            aria-hidden="true"
            onClick={handleCloseContextDesk}
          />
        )}
        {isContextDeskOpen && (
          <aside
            id="context-desk-panel"
            data-testid="context-desk-panel"
            className={`context-desk context-desk--${contextDeskMode}`}
            aria-label="书桌"
          >
            <div className="context-desk__body">
              <ContextDeskPanel
                sessionId={sessionId}
                activeTab={activeTab}
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
