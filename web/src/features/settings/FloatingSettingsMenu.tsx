import React, { useCallback } from 'react'
import { ICONS } from '../../navigation/icons'
import { MODAL_DESTINATIONS } from './modal-destination-registry'
import { useOptionalSecondaryModalHost } from './secondary-modal-host-contract'
import './floating-settings.css'

const DEFAULT_MODAL_DESTINATION = MODAL_DESTINATIONS[0] ?? 'dashboard'

const FloatingSettingsMenu: React.FC = () => {
  const modalHost = useOptionalSecondaryModalHost()
  const isOpen = modalHost?.destination !== null && modalHost?.destination !== undefined
  const SettingsIcon = ICONS.settings

  const handleToggle = useCallback(() => {
    if (!modalHost) {
      return
    }
    if (isOpen) {
      modalHost.closeModal()
      return
    }
    modalHost.openModal(DEFAULT_MODAL_DESTINATION)
  }, [isOpen, modalHost])

  return (
    <div className="floating-settings">
      <button
        type="button"
        className="floating-settings__trigger"
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-controls="floating-settings-panel"
        aria-label="设置"
        title="设置"
        data-testid="floating-settings-trigger"
      >
        {SettingsIcon && <SettingsIcon width={18} height={18} />}
      </button>
    </div>
  )
}

export default FloatingSettingsMenu
