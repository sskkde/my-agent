import React from 'react'
import { getTabComponent } from '../common/container-composition'
import type { TabId } from '../../navigation/navigation-config'

interface AdminPageProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

/**
 * AdminPage - Container page for the Admin product section.
 * Renders the selected tab component. Navigation is handled by the sidebar.
 *
 * Admin section includes: settings, admin
 */
const AdminPage: React.FC<AdminPageProps> = ({ activeTab, onTabChange }) => {
  // Get the component for the active tab
  const TabComponent = getTabComponent(activeTab)

  return (
    <div data-testid="container-page-admin" className="admin-page">
      <TabComponent onTabChange={onTabChange} />
    </div>
  )
}

export default AdminPage
