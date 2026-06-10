import React, { useMemo } from 'react'
import { NAV_GROUPS, TabId } from '../navigation/navigation-config'
import { ICONS } from '../navigation/icons'
import type { ProductSection } from '../navigation/product-navigation'
import { getAllTabsForSection } from '../navigation/product-navigation'

export type { TabId }

interface TabNavProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  isExpanded?: boolean
  activeSection?: ProductSection
}

const TabNav: React.FC<TabNavProps> = ({ activeTab, onTabChange, isExpanded = true, activeSection }) => {
  const handleKeyDown = (e: React.KeyboardEvent, tabId: TabId) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onTabChange(tabId)
    }
  }

  const filteredGroups = useMemo(() => {
    if (!activeSection) {
      return NAV_GROUPS
    }

    const sectionTabIds = new Set(getAllTabsForSection(activeSection))

    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => sectionTabIds.has(item.id)),
    })).filter((group) => group.items.length > 0)
  }, [activeSection])

  return (
    <nav role="tablist" aria-label="主导航">
      {filteredGroups.map((group) => (
        <section key={group.id} data-testid={group.testId}>
          {isExpanded && <div className="nav-section__label">{group.label}</div>}
          {group.items.map((item) => {
            const IconComponent = ICONS[item.iconKey]
            return (
              <button
                key={item.id}
                role="tab"
                data-testid={item.testId}
                aria-selected={activeTab === item.id}
                onClick={() => onTabChange(item.id)}
                onKeyDown={(e) => handleKeyDown(e, item.id)}
                className={`tab-button ${activeTab === item.id ? 'active' : ''}`}
              >
                {IconComponent && <IconComponent className="nav-item__icon" aria-hidden="true" />}
                <span className={`nav-item__text ${!isExpanded ? 'nav-item__text--hidden' : ''}`}>{item.label}</span>
              </button>
            )
          })}
        </section>
      ))}
    </nav>
  )
}

export default TabNav
