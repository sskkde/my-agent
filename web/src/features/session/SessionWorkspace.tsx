import React from 'react'
import SessionConsoleTab from './SessionConsoleTab'
import type { TabId } from '../../navigation/navigation-config'
import type { AuthContext } from '../../commands/types'

interface SessionWorkspaceProps {
  setActiveTab?: (tabId: TabId) => void
  auth?: AuthContext
  /**
   * Initial session ID from URL routing (optional).
   * When provided, used to select a specific session on mount/URL change.
   * Takes precedence over localStorage via resolveSessionId in the route layer.
   */
  initialSessionId?: string
  /**
   * Tab change handler for navigation compatibility.
   * Passed through to SessionConsoleTab for cross-section navigation.
   */
  onTabChange?: (tab: TabId) => void
}

/**
 * SessionWorkspace wraps SessionConsoleTab with product-level semantics.
 * This is the default landing surface for the Chat product section.
 *
 * Preserves all SessionConsoleTab behavior and selectors including:
 * - data-testid="session-message-input"
 * - data-testid="session-send-button"
 * - localStorage key "session-console-selected-session"
 *
 * Supports URL-driven session selection via initialSessionId prop (Task 10).
 */
const SessionWorkspace: React.FC<SessionWorkspaceProps> = ({ setActiveTab, auth, initialSessionId, onTabChange }) => {
  return (
    <div data-testid="session-workspace" className="session-workspace">
      <SessionConsoleTab setActiveTab={onTabChange ?? setActiveTab} auth={auth} initialSessionId={initialSessionId} />
    </div>
  )
}

export default SessionWorkspace
