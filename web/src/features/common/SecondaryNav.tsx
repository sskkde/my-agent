import React from 'react'
import type { TabId } from '../../navigation/navigation-config'

export interface SecondaryNavItem {
  id: TabId
  label: string
}

export interface SecondaryNavProps {
  items: SecondaryNavItem[]
  activeTabId: TabId
  onTabChange: (tabId: TabId) => void
  className?: string
}

/**
 * SecondaryNav - Secondary navigation component for container pages.
 * Renders tab items with button semantics and supports active state styling.
 */
const SecondaryNav: React.FC<SecondaryNavProps> = ({
  items,
  activeTabId,
  onTabChange,
  className = '',
}) => {
  const handleKeyDown = (e: React.KeyboardEvent, tabId: TabId) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onTabChange(tabId)
    }
  }

  // Handle empty items array gracefully
  if (items.length === 0) {
    return (
      <nav className={`secondary-nav ${className}`.trim()} role="tablist" aria-label="二级导航">
        <div className="secondary-nav__empty">暂无导航项</div>
      </nav>
    )
  }

  return (
    <nav className={`secondary-nav ${className}`.trim()} role="tablist" aria-label="二级导航">
      {items.map((item) => {
        const isActive = activeTabId === item.id
        return (
          <button
            key={item.id}
            role="tab"
            data-testid={`secondary-nav-${item.id}`}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onTabChange(item.id)}
            onKeyDown={(e) => handleKeyDown(e, item.id)}
            className={`secondary-nav__item ${isActive ? 'secondary-nav__item--active' : ''}`}
            type="button"
          >
            {item.label}
          </button>
        )
      })}
    </nav>
  )
}

export default SecondaryNav
