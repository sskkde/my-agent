import React from 'react'
import SettingsList from '../../components/settings/SettingsList'
import SettingsRow from '../../components/settings/SettingsRow'
import { ICONS } from '../../navigation/icons'
import type { TabId } from '../../navigation/navigation-config'
import type { NavFunctionGroup } from '../../navigation/nav-groups-v2'

export interface NavMenuContentProps {
  group: NavFunctionGroup
  activeTab?: TabId
  onNavigate: (tabId: TabId) => void
}

/**
 * NavMenuContent - renders a function-domain group of navigation items
 * as a SettingsList of clickable SettingsRow items.
 *
 * Clicking a row calls onNavigate(tabId), which triggers URL navigation
 * and closes the floating panel.
 */
const NavMenuContent: React.FC<NavMenuContentProps> = ({ group, activeTab, onNavigate }) => {
  return (
    <div className="floating-settings__nav-content" data-testid={`nav-content-${group.id}`}>
      <SettingsList>
        {group.items.map((item) => {
          const Icon = ICONS[item.iconKey]
          return (
            <SettingsRow
              key={item.id}
              title={item.label}
              description={item.description}
              icon={Icon ? <Icon width={16} height={16} /> : undefined}
              active={activeTab === item.id}
              onClick={() => onNavigate(item.id)}
              testId={item.testId}
            />
          )
        })}
      </SettingsList>
    </div>
  )
}

export default NavMenuContent
