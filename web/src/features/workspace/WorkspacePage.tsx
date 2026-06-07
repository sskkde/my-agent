import React from 'react'
import SecondaryNav from '../common/SecondaryNav'
import { CONTAINER_PAGE_CONFIGS, getTabComponent } from '../common/container-composition'
import type { TabId } from '../../navigation/navigation-config'
import { getNavItemById } from '../../navigation/navigation-config'

interface WorkspacePageProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

/**
 * WorkspacePage - Container page for the Workspace product section.
 * Renders a header, secondary navigation, and the selected tab component.
 *
 * Workspace section includes: dashboard, sessions, usage, logs-debug, channels,
 * instances, status, workflows, approvals, triggers, memory, observability
 */
const WorkspacePage: React.FC<WorkspacePageProps> = ({ activeTab, onTabChange }) => {
  const config = CONTAINER_PAGE_CONFIGS.workspace
  const tabs = config.tabs

  // Build nav items with labels from navigation config
  const navItems = tabs.map((tabId) => {
    const navItem = getNavItemById(tabId)
    return {
      id: tabId,
      label: navItem?.label ?? tabId,
    }
  })

  // Get the component for the active tab
  const TabComponent = getTabComponent(activeTab)

  return (
    <div data-testid="container-page-workspace" className="workspace-page">
      <div className="workspace-page__header">
        <h2 className="workspace-page__title">{config.label}</h2>
      </div>
      <SecondaryNav items={navItems} activeTabId={activeTab} onTabChange={onTabChange} />
      <div className="workspace-page__content">
        <TabComponent onTabChange={onTabChange} />
      </div>
    </div>
  )
}

export default WorkspacePage
