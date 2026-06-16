import React from 'react'
import { renderTabComponent } from '../common/container-composition'
import type { TabId } from '../../navigation/navigation-config'

interface WorkspacePageProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  sessionId?: string | null
}

/**
 * WorkspacePage - Container page for the Workspace product section.
 * Renders the selected tab component. Navigation is handled by the sidebar.
 *
 * Workspace section includes: dashboard, sessions, usage, logs-debug, channels,
 * instances, status, workflows, approvals, triggers, memory, observability
 */
const WorkspacePage: React.FC<WorkspacePageProps> = ({ activeTab, onTabChange, sessionId }) => {
  return (
    <div data-testid="container-page-workspace" className="workspace-page">
      {renderTabComponent(activeTab, { onTabChange, sessionId })}
    </div>
  )
}

export default WorkspacePage
