import React from 'react'
import SecondaryNav from '../common/SecondaryNav'
import { CONTAINER_PAGE_CONFIGS, getTabComponent } from '../common/container-composition'
import type { TabId } from '../../navigation/navigation-config'
import { getNavItemById } from '../../navigation/navigation-config'

interface AdminPageProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

/**
 * AdminPage - Container page for the Admin product section.
 * Renders a header, secondary navigation, and the selected tab component.
 *
 * Admin section includes: settings, admin
 */
const AdminPage: React.FC<AdminPageProps> = ({ activeTab, onTabChange }) => {
  const config = CONTAINER_PAGE_CONFIGS.admin
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
    <div data-testid="container-page-admin" className="admin-page">
      <div className="admin-page__header">
        <h2 className="admin-page__title">{config.label}</h2>
      </div>
      <SecondaryNav items={navItems} activeTabId={activeTab} onTabChange={onTabChange} />
      <div className="admin-page__content">
        <TabComponent onTabChange={onTabChange} />
      </div>
    </div>
  )
}

export default AdminPage
