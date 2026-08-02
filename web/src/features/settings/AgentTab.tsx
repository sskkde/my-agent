import React from 'react'
import { useAuth } from '../../context/AuthContext'
import SubagentConfig from './SubagentConfig'

const AgentTab: React.FC = () => {
  const { isAuthenticated } = useAuth()

  return (
    <div className="settings-tab-content" data-testid="settings-agent-tab">
      <SubagentConfig isAuthenticated={isAuthenticated} />
    </div>
  )
}

export default AgentTab
