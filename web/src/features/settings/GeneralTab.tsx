import React from 'react'
import { useSettingsData } from './useSettingsData'
import SettingsList from '../../components/settings/SettingsList'
import SettingsRow from '../../components/settings/SettingsRow'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import { type ThinkingLevel } from '../../commands/preferences'

const THINKING_LEVEL_OPTIONS: Array<{ value: ThinkingLevel; label: string }> = [
  { value: 'off', label: '关闭' },
  { value: 'minimal', label: '极简' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

interface PrefToggleProps {
  checked: boolean
  disabled: boolean
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  testId: string
}

const PrefToggle: React.FC<PrefToggleProps> = ({ checked, disabled, onChange, testId }) => (
  <label className="setting-toggle">
    <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} data-testid={testId} />
    <span className="setting-toggle__track" />
  </label>
)

const GeneralTab: React.FC = () => {
  const { loading, error, commandPrefs, savingPrefs, handleCommandPrefChange, fetchData } = useSettingsData()

  if (loading) {
    return <LoadingSpinner size="large" label="加载设置..." />
  }

  if (error) {
    return <ErrorMessage error={error} retry={{ onClick: fetchData }} size="large" />
  }

  return (
    <div className="settings-tab-content" data-testid="settings-general-tab">
      <h3 className="settings-section-title">控制台偏好</h3>
      <SettingsList testId="command-prefs-section">
        <SettingsRow
          title="详细输出"
          description="显示更多运行日志"
          control={
            <PrefToggle
              checked={commandPrefs.verbose}
              disabled={savingPrefs}
              onChange={(e) => handleCommandPrefChange('verbose', e.target.checked)}
              testId="pref-verbose"
            />
          }
        />
        <SettingsRow
          title="显示推理摘要"
          description="展示模型推理过程"
          control={
            <PrefToggle
              checked={commandPrefs.reasoningVisible}
              disabled={savingPrefs}
              onChange={(e) => handleCommandPrefChange('reasoningVisible', e.target.checked)}
              testId="pref-reasoning"
            />
          }
        />
        <SettingsRow
          title="思考级别"
          description="推理深度"
          control={
            <select
              value={commandPrefs.thinkingLevel}
              onChange={(e) => handleCommandPrefChange('thinkingLevel', e.target.value as ThinkingLevel)}
              disabled={savingPrefs}
              className="setting-select"
              data-testid="pref-thinking-level"
            >
              {THINKING_LEVEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          }
        />
      </SettingsList>
    </div>
  )
}

export default GeneralTab
