import { createContext, useContext } from 'react'

export interface AgentShellSidebarContextValue {
  openNavDrawer: () => void
  closeNavDrawer: () => void
}

export const AgentShellSidebarContext = createContext<AgentShellSidebarContextValue | null>(null)

export const useAgentShellSidebar = (): AgentShellSidebarContextValue | null => {
  return useContext(AgentShellSidebarContext)
}
