import React from 'react'
import SettingsContent from './SettingsContent'

const SettingsTab: React.FC = () => {
  return (
    <div data-testid="settings-panel" className="settings-panel">
      <SettingsContent />
    </div>
  )
}

export default SettingsTab
