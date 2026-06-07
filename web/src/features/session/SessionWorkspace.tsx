import React from 'react'
import SessionConsoleTab from './SessionConsoleTab'
import type { TabId } from '../../components/TabNav'
import type { AuthContext } from '../../commands/types'

interface SessionWorkspaceProps {
  setActiveTab?: (tabId: TabId) => void
  auth?: AuthContext
}

/**
 * SessionWorkspace wraps SessionConsoleTab with product-level semantics.
 * This is the default landing surface for the Chat product section.
 *
 * Preserves all SessionConsoleTab behavior and selectors including:
 * - data-testid="session-message-input"
 * - data-testid="session-send-button"
 * - localStorage key "session-console-selected-session"
 */
const SessionWorkspace: React.FC<SessionWorkspaceProps> = ({ setActiveTab, auth }) => {
  return (
    <div data-testid="session-workspace">
      <SessionConsoleTab setActiveTab={setActiveTab} auth={auth} />
    </div>
  )
}

export default SessionWorkspace
