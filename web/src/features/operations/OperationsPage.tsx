import React from 'react'
import SecondaryNav from '../common/SecondaryNav'
import { CONTAINER_PAGE_CONFIGS, getTabComponent } from '../common/container-composition'
import type { TabId } from '../../navigation/navigation-config'
import { getNavItemById } from '../../navigation/navigation-config'

interface OperationsPageProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

/**
 * OperationsPage - Container page for the Operations product section.
 * Renders a header, secondary navigation, and the selected tab component.
 *
 * Operations section includes: agent-monitor, skills, agents, connectors, dlq
 */
const OperationsPage: React.FC<OperationsPageProps> = ({ activeTab, onTabChange }) => {
  const config = CONTAINER_PAGE_CONFIGS.operations
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
    <div data-testid="container-page-operations" className="operations-page">
      <div className="operations-page__header">
        <h2 className="operations-page__title">{config.label}</h2>
      </div>
      <SecondaryNav items={navItems} activeTabId={activeTab} onTabChange={onTabChange} />
      <div className="operations-page__content">
        <TabComponent onTabChange={onTabChange} />
      </div>
    </div>
  )
}

export default OperationsPage
