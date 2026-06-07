import React from 'react'
import { NAV_GROUPS, TabId } from '../navigation/navigation-config'
import { ICONS } from '../navigation/icons'

export type { TabId }

interface TabNavProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  isExpanded?: boolean
}

const TabNav: React.FC<TabNavProps> = ({ activeTab, onTabChange, isExpanded = true }) => {
  const handleKeyDown = (e: React.KeyboardEvent, tabId: TabId) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onTabChange(tabId)
    }
  }

  return (
    <nav role="tablist" aria-label="主导航">
      {NAV_GROUPS.map((group) => (
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
