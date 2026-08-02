import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import ContextDeskPanel from '../context/ContextDeskPanel'
import { useAuth } from '../../context/AuthContext'
import { ICONS } from '../../navigation/icons'
import { navigationToRoute } from '../../router/route-mapping'
import {
  getModalComponent,
  getModalDestination,
  MODAL_DESTINATION_MAP,
  MODAL_DESTINATIONS,
  type ModalDestination,
  type ModalDestinationEntry,
  type ModalDestinationGroup,
} from './modal-destination-registry'
import { useSecondaryModalHost } from './secondary-modal-host-contract'
import './floating-settings.css'

const DEFAULT_MODAL_DESTINATION: ModalDestination = MODAL_DESTINATIONS[0] ?? 'dashboard'
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const MODAL_GROUPS = [
  'monitor',
  'resource',
  'automation',
  'extension',
  'sessions',
  'approvals',
  'todos',
  'agents',
  'admin',
  'settings',
  'settings-categories',
] as const satisfies readonly ModalDestinationGroup[]

const GROUP_LABELS: Record<ModalDestinationGroup, string> = {
  monitor: '导航 · 监控',
  resource: '资源',
  automation: '自动化',
  extension: '扩展',
  sessions: '会话',
  approvals: '审批',
  todos: '待办',
  agents: '代理',
  admin: '管理',
  settings: '系统设置',
  'settings-categories': '设置分类',
}

const GROUP_ICON_KEYS: Record<ModalDestinationGroup, string> = {
  monitor: 'eye',
  resource: 'database',
  automation: 'gitBranch',
  extension: 'plug',
  sessions: 'list',
  approvals: 'checkCircle',
  todos: 'checkSquare',
  agents: 'activity',
  admin: 'shield',
  settings: 'settings',
  'settings-categories': 'settings',
}

interface BackgroundState {
  readonly element: HTMLElement
  readonly ariaHidden: string | null
  readonly inert: boolean | null
}

function hasInertProperty(element: HTMLElement): element is HTMLElement & { inert: boolean } {
  return 'inert' in element
}

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return []
  }
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.closest('[hidden], [inert]') && element.getClientRects().length > 0,
  )
}

function restoreFocus(element: HTMLElement | null): void {
  if (!element?.isConnected) {
    return
  }
  requestAnimationFrame(() => {
    if (element.isConnected) {
      element.focus({ preventScroll: true })
    }
  })
}

function navigateDestination(
  destination: ModalDestination,
  navigate: (path: string) => void,
  closeModal: () => void,
): void {
  switch (destination) {
    case 'settings-general':
    case 'settings-appearance':
    case 'settings-provider':
    case 'settings-agent':
      return
    default:
      navigate(navigationToRoute(destination))
      closeModal()
  }
}

function CloseIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function ChevronIcon({ expanded }: { expanded: boolean }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d={expanded ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
    </svg>
  )
}

const SecondaryModal: React.FC = () => {
  const { destination, sessionId, closeModal } = useSecondaryModalHost()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const scrimRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)
  const [activeDestination, setActiveDestination] = useState<ModalDestination>(DEFAULT_MODAL_DESTINATION)
  const [isContextOpen, setIsContextOpen] = useState(false)
  const isOpen = destination !== null

  const groupedDestinations = useMemo(
    () =>
      MODAL_GROUPS.map((group) => ({
        group,
        entries: MODAL_DESTINATIONS.map((id) => MODAL_DESTINATION_MAP[id]).filter(
          (entry) => entry.group === group,
        ),
      })).filter(({ entries }) => entries.length > 0),
    [],
  )

  useEffect(() => {
    if (!isOpen || !destination) {
      return
    }
    setActiveDestination(destination)
  }, [destination, isOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const mediaQuery = window.matchMedia('(max-width: 640px)')
    const syncContextVisibility = () => setIsContextOpen(!mediaQuery.matches)
    syncContextVisibility()
    mediaQuery.addEventListener('change', syncContextVisibility)

    const activeElement = document.activeElement
    previouslyFocusedRef.current = activeElement instanceof HTMLElement ? activeElement : null
    const originalOverflow = document.body.style.overflow
    const backgroundStates: BackgroundState[] = []

    for (const child of Array.from(document.body.children)) {
      if (!(child instanceof HTMLElement) || child === scrimRef.current) {
        continue
      }
      backgroundStates.push({
        element: child,
        ariaHidden: child.getAttribute('aria-hidden'),
        inert: hasInertProperty(child) ? child.inert : null,
      })
      child.setAttribute('aria-hidden', 'true')
      if (hasInertProperty(child)) {
        child.inert = true
      }
    }

    document.body.style.overflow = 'hidden'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeModal()
        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const dialog = dialogRef.current
      const focusable = getFocusableElements(dialog)
      if (!dialog || focusable.length === 0) {
        event.preventDefault()
        dialog?.focus({ preventScroll: true })
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      const focusInside = active instanceof HTMLElement && dialog.contains(active)

      if (event.shiftKey && (!focusInside || active === first)) {
        event.preventDefault()
        last.focus({ preventScroll: true })
      } else if (!event.shiftKey && (!focusInside || active === last)) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    const focusFrame = requestAnimationFrame(() => {
      const first = getFocusableElements(dialogRef.current)[0]
      if (first) {
        first.focus({ preventScroll: true })
      } else {
        dialogRef.current?.focus({ preventScroll: true })
      }
    })

    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
      mediaQuery.removeEventListener('change', syncContextVisibility)
      document.body.style.overflow = originalOverflow

      for (const state of backgroundStates) {
        if (state.ariaHidden === null) {
          state.element.removeAttribute('aria-hidden')
        } else {
          state.element.setAttribute('aria-hidden', state.ariaHidden)
        }
        if (hasInertProperty(state.element) && state.inert !== null) {
          state.element.inert = state.inert
        }
      }

      restoreFocus(previouslyFocusedRef.current)
      previouslyFocusedRef.current = null
    }
  }, [closeModal, isOpen])

  const handleGroupSelect = useCallback((entries: readonly ModalDestinationEntry[]) => {
    const firstEntry = entries[0]
    if (firstEntry) {
      setActiveDestination(firstEntry.id)
    }
  }, [])

  const handleDestinationSelect = useCallback(
    (entry: ModalDestinationEntry) => {
      setActiveDestination(entry.id)
      navigateDestination(entry.id, navigate, closeModal)
    },
    [closeModal, navigate],
  )
  const handleModalTabChange = useCallback(() => undefined, [])

  if (!isOpen || typeof document === 'undefined') {
    return null
  }

  const activeEntry = getModalDestination(activeDestination) ?? MODAL_DESTINATION_MAP[DEFAULT_MODAL_DESTINATION]
  const activeGroup = activeEntry.group
  const ModalComponent = getModalComponent(activeDestination)
  const ContextIcon = ICONS.database

  return createPortal(
    <div
      ref={scrimRef}
      className="secondary-modal__scrim"
      data-testid="secondary-modal-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          closeModal()
        }
      }}
    >
      <div
        ref={dialogRef}
        id="floating-settings-panel"
        className="floating-settings__panel floating-settings__panel--tabs"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        aria-describedby="floating-settings-content"
        data-testid="floating-settings-panel"
        tabIndex={-1}
      >
        <div className="floating-settings__modal-layout" data-context-open={isContextOpen}>
          <nav className="floating-settings__tabnav" aria-label="设置导航" role="tablist">
            {groupedDestinations.map(({ group, entries }) => {
              const GroupIcon = ICONS[GROUP_ICON_KEYS[group]]
              const groupSelected = entries.some((entry) => entry.id === activeDestination)
              return (
                <div className="floating-settings__group" key={group} role="group" aria-label={GROUP_LABELS[group]}>
                  <button
                    type="button"
                    className="floating-settings__section-title"
                    role="tab"
                    aria-selected={groupSelected}
                    data-testid={`settings-tab-nav-${group}`}
                    onClick={() => handleGroupSelect(entries)}
                  >
                    {GroupIcon && <GroupIcon className="floating-settings__section-title-icon" />}
                    <span>{GROUP_LABELS[group]}</span>
                  </button>
                  <div className="floating-settings__group-items">
                    {entries.map((entry) => {
                      const Icon = ICONS[entry.iconKey]
                      const isActive = activeDestination === entry.id
                      return (
                        <button
                          type="button"
                          key={entry.id}
                          className={`floating-settings__tab${isActive ? ' floating-settings__tab--active' : ''}`}
                          role="tab"
                          aria-selected={isActive}
                          aria-controls="floating-settings-content"
                          data-testid={entry.testId}
                          onClick={() => handleDestinationSelect(entry)}
                        >
                          {Icon && <Icon width={16} height={16} className="floating-settings__tab-icon" />}
                          <span className="floating-settings__tab-label">{entry.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </nav>

          <div className="floating-settings__content">
            <div className="floating-settings__content-header">
              <div className="floating-settings__content-heading">
                <span className="floating-settings__content-kicker">{GROUP_LABELS[activeGroup]}</span>
                <span className="floating-settings__content-title">{activeEntry.label}</span>
              </div>
              <div className="floating-settings__content-actions">
                <button
                  type="button"
                  className="floating-settings__context-toggle"
                  aria-expanded={isContextOpen}
                  aria-controls="secondary-modal-context-desk"
                  data-testid="secondary-modal-context-desk-toggle"
                  onClick={() => setIsContextOpen((open) => !open)}
                >
                  {ContextIcon && <ContextIcon aria-hidden="true" />}
                  <span>上下文书桌</span>
                  <ChevronIcon expanded={isContextOpen} />
                </button>
                <button
                  type="button"
                  className="floating-settings__close"
                  aria-label="关闭设置"
                  onClick={closeModal}
                >
                  <CloseIcon />
                </button>
              </div>
            </div>

            <div id="floating-settings-content" className="floating-settings__content-body">
              <div data-testid={`nav-content-${activeGroup}`} className="floating-settings__nav-content">
                <ModalComponent sessionId={sessionId} onTabChange={handleModalTabChange} />
              </div>
            </div>

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

          {isContextOpen && (
            <aside
              id="secondary-modal-context-desk"
              className="floating-settings__context-shell"
              aria-label="上下文书桌"
              data-testid="secondary-modal-context-desk"
            >
              <div className="floating-settings__context-header">
                <span className="floating-settings__context-header-title">上下文书桌</span>
                <button
                  type="button"
                  className="floating-settings__context-close"
                  aria-label="折叠上下文书桌"
                  data-testid="secondary-modal-context-desk-close"
                  onClick={() => setIsContextOpen(false)}
                >
                  <ChevronIcon expanded />
                </button>
              </div>
              <div className="floating-settings__context-body">
                <ContextDeskPanel sessionId={sessionId} />
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default SecondaryModal
