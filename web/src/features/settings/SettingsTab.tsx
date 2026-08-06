import React, { useState } from 'react'
import type { TabId, SettingsCategoryId } from '../../navigation/navigation-config'
import { ICONS } from '../../navigation/icons'
import SettingsList from '../../components/settings/SettingsList'
import SettingsRow from '../../components/settings/SettingsRow'
import { TAB_COMPONENT_MAPPING } from '../common/container-composition'

interface SettingsCategoryEntry {
  id: SettingsCategoryId
  label: string
  description: string
  iconKey: string
}

const SETTINGS_CATEGORIES: SettingsCategoryEntry[] = [
  { id: 'settings-general', label: '通用', description: '本地化与界面偏好', iconKey: 'settings' },
  { id: 'settings-appearance', label: '外观', description: '主题样式', iconKey: 'info' },
  { id: 'settings-provider', label: 'Provider', description: '服务提供商凭据与模型', iconKey: 'server' },
  { id: 'settings-agent', label: '代理', description: '子代理 LLM 配置', iconKey: 'activity' },
]

interface SettingsTabProps {
  sessionId?: string | null
  onTabChange?: (tabId: TabId) => void
}

/**
 * Settings overview: lists the four settings categories.
 *
 * When rendered inside the secondary modal (onTabChange provided), clicking a
 * category row delegates navigation to the modal (the modal switches its
 * active destination and unmounts this overview). When rendered standalone
 * (no onTabChange), it falls back to in-panel category switching.
 */
const SettingsTab: React.FC<SettingsTabProps> = ({ onTabChange }) => {
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>('settings-general')
  const isDelegated = typeof onTabChange === 'function'

  const handleCategoryClick = (categoryId: SettingsCategoryId) => {
    if (onTabChange) {
      onTabChange(categoryId as unknown as TabId)
      return
    }
    setActiveCategory(categoryId)
  }

  const ActiveComponent = isDelegated ? null : (TAB_COMPONENT_MAPPING[activeCategory] as React.ComponentType)

  return (
    <div className="settings-panel" data-testid="settings-panel">
      <div className="content-header">
        <h2>设置</h2>
      </div>

      <div className="content-body">
        <SettingsList>
          {SETTINGS_CATEGORIES.map((category) => {
            const Icon = ICONS[category.iconKey]
            return (
              <SettingsRow
                key={category.id}
                title={category.label}
                description={category.description}
                icon={Icon ? <Icon width={16} height={16} /> : undefined}
                onClick={() => handleCategoryClick(category.id)}
                active={!isDelegated && activeCategory === category.id}
                testId={`settings-nav-${category.id}`}
              />
            )
          })}
        </SettingsList>

        {ActiveComponent && <ActiveComponent />}

        <div className="settings-notice" data-testid="settings-notice">
          <p>安全提示: API 密钥和敏感配置信息不会在此显示</p>
        </div>
      </div>
    </div>
  )
}

export default SettingsTab
