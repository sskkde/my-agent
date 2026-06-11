import React, { createContext, useContext } from 'react'

export interface AgentShellSidebarContextValue {
  setChatSidebarContent: (content: React.ReactNode | null) => void
  openNavDrawer: () => void
  closeNavDrawer: () => void
}

export const AgentShellSidebarContext = createContext<AgentShellSidebarContextValue | null>(null)

export const useAgentShellSidebar = (): AgentShellSidebarContextValue | null => {
  return useContext(AgentShellSidebarContext)
}
