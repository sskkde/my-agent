import React, { useEffect, useState, useCallback } from 'react'
import { getSettings } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import ProviderManager from './ProviderManager'
import SubagentConfig from './SubagentConfig'
import type { SettingsConfig } from '../../api/types'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import { type AppTheme, readStoredTheme, persistTheme } from '../../theme-storage'

const THEME_OPTIONS: Array<{ value: AppTheme; label: string; description: string }> = [
  { value: 'default', label: '默认主题', description: '清爽中性的默认界面' },
  { value: 'warm-paper', label: 'Warm Paper', description: '温润纸张质感与低对比墨色' },
]

interface SettingsData {
  settings: SettingsConfig | null
  loading: boolean
  error: Error | null
}

interface SettingsContentProps {
  /** When true, omits the page-level header (used inside floating popover). */
  embedMode?: boolean
}

const SettingsContent: React.FC<SettingsContentProps> = ({ embedMode = false }) => {
  const { isAuthenticated } = useAuth()
  const [theme, setTheme] = useState<AppTheme>(() => readStoredTheme())
  const [data, setData] = useState<SettingsData>({
    settings: null,
    loading: true,
    error: null,
  })

  const fetchData = useCallback(async () => {
    setData((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const response = await getSettings()
      setData({
        settings: response.settings,
        loading: false,
        error: null,
      })
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

  const handleThemeChange = useCallback((selectedTheme: AppTheme) => {
    setTheme(selectedTheme)
    persistTheme(selectedTheme)
  }, [])

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
                    />
                    <span className="theme-option__content">
                      <span className="theme-option__label">{option.label}</span>
                      <span className="theme-option__description">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

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
