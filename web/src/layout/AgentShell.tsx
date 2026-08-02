import React, { useMemo } from 'react'
import ChatShell from '../features/session/chat/ChatShell'
import ContextDeskPanel from '../features/context/ContextDeskPanel'
import { getNavItemById } from '../navigation/navigation-config'
import { getProductSection } from '../navigation/product-navigation'
import type { TabId } from '../components/TabNav'
import type { UserMetadata } from '../api/types'
import { AgentShellSidebarContext } from './AgentShellSidebarContext'
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
  sessionId,
}) => {
  const activeProductSection = useMemo(() => getProductSection(activeTab), [activeTab])
  const isChat = activeProductSection === 'chat'

  const navItem = getNavItemById(activeTab)
  const title = navItem?.label ?? 'Agent Platform'

  const sidebarContextValue = useMemo(
    () => ({
      setChatSidebarContent: (_content: React.ReactNode | null) => {},
      openNavDrawer: () => {},
      closeNavDrawer: () => {},
    }),
    [],
  )

  if (isChat) {
    return (
      <AgentShellSidebarContext.Provider value={sidebarContextValue}>
        <div data-testid="agent-shell" className="agent-shell-container">
          <div data-testid="app-shell" className="shell shell--chat">
            <main data-testid="center-stage" className="shell__content shell__content--chat">
              {children}
            </main>
          </div>
        </div>
      </AgentShellSidebarContext.Provider>
    )
  }

  return (
    <AgentShellSidebarContext.Provider value={sidebarContextValue}>
      <div data-testid="agent-shell" className="agent-shell-container">
        <div data-testid="app-shell">
          <ChatShell
            title={title}
            sidebar={null}
            rightPanel={<ContextDeskPanel sessionId={sessionId} activeTab={activeTab} />}
            initialSidebarOpen={false}
            initialRightOpen={true}
          >
            {children}
          </ChatShell>
        </div>
      </div>
    </AgentShellSidebarContext.Provider>
  )
}

export default AgentShell
