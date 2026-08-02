import { useEffect, useState, useCallback } from 'react'
import { getSettings, updateSettings, ApiClientError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
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
import type { SettingsConfig, UpdateSettingsRequest } from '../../api/types'

interface SettingsDataState {
  settings: SettingsConfig | null
  loading: boolean
  error: Error | null
}

export interface SettingsData {
  settings: SettingsConfig | null
  loading: boolean
  error: Error | null
  theme: AppTheme
  commandPrefs: CommandPreferences
  savingTheme: boolean
  savingPrefs: boolean
  saveError: string | null
  isAuthenticated: boolean
  handleThemeChange: (theme: AppTheme) => void
  handleCommandPrefChange: (field: keyof CommandPreferences, value: boolean | ThinkingLevel) => void
  fetchData: () => void
}

export function useSettingsData(): SettingsData {
  const { isAuthenticated } = useAuth()
  const [theme, setTheme] = useState<AppTheme>(() => readStoredTheme())
  const [commandPrefs, setCommandPrefs] = useState<CommandPreferences>(() => loadPreferences())
  const [savingTheme, setSavingTheme] = useState(false)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [data, setData] = useState<SettingsDataState>({
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

  const handleThemeChange = useCallback(async (selectedTheme: AppTheme) => {
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
  }, [])

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

  return {
    settings: data.settings,
    loading: data.loading,
    error: data.error,
    theme,
    commandPrefs,
    savingTheme,
    savingPrefs,
    saveError,
    isAuthenticated,
    handleThemeChange,
    handleCommandPrefChange,
    fetchData,
  }
}
