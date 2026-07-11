import React, { useEffect, useState, useCallback } from 'react'
import { getSettings, updateSettings, ApiClientError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import ProviderManager from './ProviderManager'
import SubagentConfig from './SubagentConfig'
import type { SettingsConfig, UpdateSettingsRequest } from '../../api/types'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import {
  type AppTheme,
  readStoredTheme,
  persistTheme,
  applyDocumentTheme,
} from '../../theme-storage'
import {
  type ThinkingLevel,
  loadPreferences,
  savePreferences,
  type CommandPreferences,
} from '../../commands/preferences'

const THEME_OPTIONS: Array<{ value: AppTheme; label: string; description: string }> = [
  { value: 'default', label: '默认主题', description: '清爽中性的默认界面' },
  { value: 'warm-paper', label: 'Warm Paper', description: '温润纸张质感与低对比墨色' },
  { value: 'dark', label: '暗色模式', description: '深色背景降低视觉疲劳' },
]

const THINKING_LEVEL_OPTIONS: Array<{ value: ThinkingLevel; label: string }> = [
  { value: 'off', label: '关闭' },
  { value: 'minimal', label: '极简' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

interface SettingsData {
  settings: SettingsConfig | null
  loading: boolean
  error: Error | null
}

interface SettingsContentProps {
  embedMode?: boolean
}

const SettingsContent: React.FC<SettingsContentProps> = ({ embedMode = false }) => {
  const { isAuthenticated } = useAuth()
  const [theme, setTheme] = useState<AppTheme>(() => readStoredTheme())
  const [commandPrefs, setCommandPrefs] = useState<CommandPreferences>(() => loadPreferences())
  const [savingTheme, setSavingTheme] = useState(false)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [data, setData] = useState<SettingsData>({
    settings: null,
    loading: true,
    error: null,
  })

  const fetchData = useCallback(async () => {
    setData((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const response = await getSettings()
      const settings = response.settings
      setData({ settings, loading: false, error: null })

      if (settings.theme) {
        const backendTheme = settings.theme as AppTheme
        setTheme(backendTheme)
        applyDocumentTheme(backendTheme)
        persistTheme(backendTheme)
      }
      if (settings.commandPrefs) {
        const prefs: CommandPreferences = {
          verbose: settings.commandPrefs.verbose,
          reasoningVisible: settings.commandPrefs.reasoningVisible,
          thinkingLevel: settings.commandPrefs.thinkingLevel as ThinkingLevel,
        }
        setCommandPrefs(prefs)
        savePreferences(prefs)
      }
    } catch (err) {
      setData({
        settings: null,
        loading: false,
        error: err instanceof Error ? err : new Error('加载设置失败'),
      })
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleThemeChange = useCallback(
    async (selectedTheme: AppTheme) => {
      setTheme(selectedTheme)
      applyDocumentTheme(selectedTheme)
      persistTheme(selectedTheme)
      setSaveError(null)
      setSavingTheme(true)
      try {
        const request: UpdateSettingsRequest = { theme: selectedTheme }
        const response = await updateSettings(request)
        if (response.settings.theme) {
          const confirmed = response.settings.theme as AppTheme
          setTheme(confirmed)
          applyDocumentTheme(confirmed)
          persistTheme(confirmed)
        }
      } catch (err) {
        const message = err instanceof ApiClientError ? err.message : '保存主题失败'
        setSaveError(message)
      } finally {
        setSavingTheme(false)
      }
    },
    [],
  )

  const handleCommandPrefChange = useCallback(
    async (field: keyof CommandPreferences, value: boolean | ThinkingLevel) => {
      const updated = { ...commandPrefs, [field]: value }
      setCommandPrefs(updated)
      savePreferences(updated)
      setSaveError(null)
      setSavingPrefs(true)
      try {
        const request: UpdateSettingsRequest = {
          commandPrefs: {
            verbose: updated.verbose,
            reasoningVisible: updated.reasoningVisible,
            thinkingLevel: updated.thinkingLevel,
          },
        }
        const response = await updateSettings(request)
        if (response.settings.commandPrefs) {
          const confirmed: CommandPreferences = {
            verbose: response.settings.commandPrefs.verbose,
            reasoningVisible: response.settings.commandPrefs.reasoningVisible,
            thinkingLevel: response.settings.commandPrefs.thinkingLevel as ThinkingLevel,
          }
          setCommandPrefs(confirmed)
          savePreferences(confirmed)
        }
      } catch (err) {
        const message = err instanceof ApiClientError ? err.message : '保存偏好失败'
        setSaveError(message)
      } finally {
        setSavingPrefs(false)
      }
    },
    [commandPrefs],
  )

  const { settings, loading, error } = data

  return (
    <>
      {!embedMode && (
        <div className="content-header">
          <h2>设置</h2>
        </div>
      )}

      <div className={embedMode ? '' : 'content-body'}>
        {loading && (
          <div className="settings-loading" data-testid="settings-loading">
            <LoadingSpinner size="large" label="加载设置..." />
          </div>
        )}

        {error && <ErrorMessage error={error} retry={{ onClick: fetchData }} size="large" />}

        {!loading && !error && settings && (
          <div className="settings-content" data-testid="settings-content">
            <div className="settings-section">
              <h3>基本设置</h3>
              <div className="setting-item">
                <span className="setting-label">本地模式:</span>
                <span className="setting-value">
                  {settings.localOnly ? (
                    <span className="checkmark-yes" data-testid="local-only-yes">
                      ✓ 是
                    </span>
                  ) : (
                    <span className="checkmark-no">✗ 否</span>
                  )}
                </span>
              </div>
              <div className="setting-item">
                <span className="setting-label">数据保留天数:</span>
                <span className="setting-value" data-testid="retention-days">
                  {settings.retentionDays} 天
                </span>
              </div>
            </div>

            <div className="settings-section theme-settings-section" data-testid="theme-settings-section">
              <h3>外观主题</h3>
              <div className="theme-switcher" role="radiogroup" aria-label="选择界面主题">
                {THEME_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`theme-option ${theme === option.value ? 'theme-option--active' : ''}`}
                  >
                    <input
                      type="radio"
                      name="app-theme"
                      value={option.value}
                      checked={theme === option.value}
                      onChange={() => handleThemeChange(option.value)}
                      disabled={savingTheme}
                    />
                    <span className="theme-option__content">
                      <span className="theme-option__label">{option.label}</span>
                      <span className="theme-option__description">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="settings-section" data-testid="command-prefs-section">
              <h3>控制台偏好</h3>
              <div className="setting-item">
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={commandPrefs.verbose}
                    onChange={(e) => handleCommandPrefChange('verbose', e.target.checked)}
                    disabled={savingPrefs}
                    data-testid="pref-verbose"
                  />
                  <span className="setting-label">详细输出</span>
                </label>
              </div>
              <div className="setting-item">
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={commandPrefs.reasoningVisible}
                    onChange={(e) => handleCommandPrefChange('reasoningVisible', e.target.checked)}
                    disabled={savingPrefs}
                    data-testid="pref-reasoning"
                  />
                  <span className="setting-label">显示推理摘要</span>
                </label>
              </div>
              <div className="setting-item">
                <span className="setting-label">思考级别:</span>
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
              </div>
            </div>

            {saveError && (
              <div className="settings-save-error" data-testid="settings-save-error">
                {saveError}
              </div>
            )}

            <ProviderManager isAuthenticated={isAuthenticated} />

            <SubagentConfig isAuthenticated={isAuthenticated} />

            <div className="settings-notice" data-testid="settings-notice">
              <p>安全提示: API 密钥和敏感配置信息不会在此显示</p>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export default SettingsContent