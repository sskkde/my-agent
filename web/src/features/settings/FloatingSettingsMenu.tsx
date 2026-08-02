import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import NavMenuContent from './NavMenuContent'
import GeneralTab from './GeneralTab'
import AppearanceTab from './AppearanceTab'
import ProviderTab from './ProviderTab'
import AgentTab from './AgentTab'
import { useAuth } from '../../context/AuthContext'
import { ICONS } from '../../navigation/icons'
import { NAV_FUNCTION_GROUPS } from '../../navigation/nav-groups-v2'
import { navigationToRoute } from '../../router/route-mapping'
import type { TabId } from '../../navigation/navigation-config'
import './floating-settings.css'

type SettingsPanelTab = string

interface SettingsTabDef {
  id: string
  label: string
  iconKey: string
}

const SETTINGS_TABS: SettingsTabDef[] = [
  { id: 'settings-general', label: '通用', iconKey: 'settings' },
  { id: 'settings-appearance', label: '外观', iconKey: 'info' },
  { id: 'settings-provider', label: 'Provider', iconKey: 'server' },
  { id: 'settings-agent', label: '代理', iconKey: 'activity' },
]

const DEFAULT_TAB: SettingsPanelTab = `nav-${NAV_FUNCTION_GROUPS[0]?.id ?? 'monitor'}`

const FloatingSettingsMenu: React.FC = () => {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<SettingsPanelTab>(DEFAULT_TAB)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => {
    setIsOpen(false)
    requestAnimationFrame(() => {
      triggerRef.current?.focus()
    })
  }, [])

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev)
  }, [])

  const handleNavigate = useCallback(
    (tabId: TabId) => {
      navigate(navigationToRoute(tabId))
      close()
    },
    [navigate, close],
  )

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, close])

  useEffect(() => {
    if (!isOpen) return

    const handleClick = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) {
        return
      }
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target)
      ) {
        close()
      }
    }

    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen, close])

  const activeGroup = NAV_FUNCTION_GROUPS.find((g) => `nav-${g.id}` === activeTab)
  const activeSettingsTab = SETTINGS_TABS.find((t) => t.id === activeTab)
  const contentTitle = activeGroup?.label ?? activeSettingsTab?.label ?? '设置'

  const renderContent = () => {
    if (activeGroup) {
      return <NavMenuContent group={activeGroup} onNavigate={handleNavigate} />
    }
    switch (activeTab) {
      case 'settings-general':
        return <GeneralTab />
      case 'settings-appearance':
        return <AppearanceTab />
      case 'settings-provider':
        return <ProviderTab />
      case 'settings-agent':
        return <AgentTab />
      default:
        return <GeneralTab />
    }
  }

  const renderTabButton = (tabId: string, label: string, iconKey: string, testIdPrefix: string) => {
    const Icon = ICONS[iconKey]
    const isActive = activeTab === tabId
    return (
      <button
        key={tabId}
        className={`floating-settings__tab ${isActive ? 'floating-settings__tab--active' : ''}`}
        onClick={() => setActiveTab(tabId)}
        aria-selected={isActive}
        role="tab"
        data-testid={`${testIdPrefix}-${tabId}`}
      >
        {Icon && <Icon width={16} height={16} className="floating-settings__tab-icon" />}
        <span className="floating-settings__tab-label">{label}</span>
      </button>
    )
  }

  return (
    <div className="floating-settings">
      <button
        ref={triggerRef}
        className="floating-settings__trigger"
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-controls="floating-settings-panel"
        aria-label="设置"
        title="设置"
        data-testid="floating-settings-trigger"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true" width="18" height="18">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          id="floating-settings-panel"
          className="floating-settings__panel floating-settings__panel--tabs"
          role="dialog"
          aria-label="设置"
          data-testid="floating-settings-panel"
        >
          <nav className="floating-settings__tabnav" aria-label="设置导航">
            <div className="floating-settings__section-title">导航</div>
            {NAV_FUNCTION_GROUPS.map((group) =>
              renderTabButton(`nav-${group.id}`, group.label, group.iconKey, 'settings-tab'),
            )}

            <div className="floating-settings__section-title">设置</div>
            {SETTINGS_TABS.map((tab) =>
              renderTabButton(tab.id, tab.label, tab.iconKey, 'settings-tab'),
            )}
          </nav>

          <div className="floating-settings__content">
            <div className="floating-settings__content-header">
              <span className="floating-settings__content-title">{contentTitle}</span>
              <button
                className="floating-settings__close"
                onClick={close}
                aria-label="关闭设置"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true" width="14" height="14">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="floating-settings__content-body">{renderContent()}</div>

            {logout && (
              <div className="floating-settings__logout-row">
                <button
                  type="button"
                  className="floating-settings__logout-btn"
                  onClick={logout}
                  data-testid="floating-settings-logout"
                >
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default FloatingSettingsMenu
