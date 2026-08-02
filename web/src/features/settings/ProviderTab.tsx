import React from 'react'
import { useAuth } from '../../context/AuthContext'
import ProviderManager from './ProviderManager'

const ProviderTab: React.FC = () => {
  const { isAuthenticated } = useAuth()

  return (
    <div className="settings-tab-content" data-testid="settings-provider-tab">
      <ProviderManager isAuthenticated={isAuthenticated} />
    </div>
  )
}

export default ProviderTab
