import React from 'react'
import { useSettingsData } from './useSettingsData'
import type { AppTheme } from '../../theme-storage'
import SettingsList from '../../components/settings/SettingsList'
import SettingsRow from '../../components/settings/SettingsRow'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'

const THEME_OPTIONS: Array<{ value: AppTheme; label: string; description: string }> = [
  { value: 'default', label: '默认主题', description: '清爽中性的默认界面' },
  { value: 'warm-paper', label: 'Warm Paper', description: '温润纸张质感与低对比墨色' },
  { value: 'dark', label: '暗色模式', description: '深色背景降低视觉疲劳' },
]

const AppearanceTab: React.FC = () => {
  const { theme, savingTheme, loading, error, handleThemeChange, fetchData } = useSettingsData()

  if (loading) {
    return <LoadingSpinner size="large" label="加载设置..." />
  }

  if (error) {
    return <ErrorMessage error={error} retry={{ onClick: fetchData }} size="large" />
  }

  return (
    <div className="settings-tab-content" data-testid="settings-appearance-tab">
      <h3 className="settings-section-title">外观主题</h3>
      <SettingsList>
        {THEME_OPTIONS.map((option) => (
          <SettingsRow
            key={option.value}
            title={option.label}
            description={option.description}
            active={theme === option.value}
            onClick={() => handleThemeChange(option.value)}
            testId={`theme-option-${option.value}`}
          />
        ))}
      </SettingsList>
      {savingTheme && <p className="settings-saving-hint">保存中...</p>}
    </div>
  )
}

export default AppearanceTab
