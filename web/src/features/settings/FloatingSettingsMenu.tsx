import React, { useState, useRef, useCallback, useEffect } from 'react'
import SettingsContent from './SettingsContent'
import './floating-settings.css'

const FloatingSettingsMenu: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => {
    setIsOpen(false)
    // Return focus to trigger after close
    requestAnimationFrame(() => {
      triggerRef.current?.focus()
    })
  }, [])

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev)
  }, [])

  // Close on Escape
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

  // Close on outside click
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
          className="floating-settings__panel"
          role="dialog"
          aria-label="设置"
          data-testid="floating-settings-panel"
        >
          <div className="floating-settings__panel-header">
            <span className="floating-settings__panel-title">设置</span>
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
          <div className="floating-settings__panel-body">
            <SettingsContent embedMode />
          </div>
        </div>
      )}
    </div>
  )
}

export default FloatingSettingsMenu
