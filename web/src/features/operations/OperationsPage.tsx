import React from 'react'
import { getTabComponent } from '../common/container-composition'
import type { TabId } from '../../navigation/navigation-config'

interface OperationsPageProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

/**
 * OperationsPage - Container page for the Operations product section.
 * Renders the selected tab component. Navigation is handled by the sidebar.
 *
 * Operations section includes: agent-monitor, skills, agents, connectors, dlq
 */
const OperationsPage: React.FC<OperationsPageProps> = ({ activeTab, onTabChange }) => {
  // Get the component for the active tab
  const TabComponent = getTabComponent(activeTab)

  return (
    <div data-testid="container-page-operations" className="operations-page">
      <TabComponent onTabChange={onTabChange} />
    </div>
  )
}

export default OperationsPage
