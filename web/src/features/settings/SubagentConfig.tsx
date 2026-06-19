import React, { useState, useEffect, useCallback } from 'react'
import {
  getSubagentDefinitions,
  getSubagentPreference,
  updateSubagentPreference,
  resetSubagentPreference,
  getProviders,
  ApiClientError,
} from '../../api/client'
import type { SubagentDefinition, SubagentPreference, SubagentFallbackMode, ProviderSummary } from '../../api/types'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'

interface SubagentConfigProps {
  isAuthenticated: boolean
}

interface SubagentFormData {
  providerId: string
  model: string
  fallbackMode: SubagentFallbackMode
}

const FALLBACK_MODE_OPTIONS: { value: SubagentFallbackMode; label: string; description: string }[] = [
  { value: 'none', label: '不回退', description: '失败时不切换其他提供商' },
  { value: 'same_provider', label: '同提供商回退', description: '失败时仅尝试同一提供商的兼容模型' },
  { value: 'any_compatible', label: '任意兼容回退', description: '失败时尝试任意兼容提供商或模型' },
]

const SubagentConfig: React.FC<SubagentConfigProps> = ({ isAuthenticated }) => {
  const [definitions, setDefinitions] = useState<SubagentDefinition[]>([])
  const [preferences, setPreferences] = useState<Record<string, SubagentPreference>>({})
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [expandedType, setExpandedType] = useState<string | null>(null)
  const [savingType, setSavingType] = useState<string | null>(null)
  const [resettingType, setResettingType] = useState<string | null>(null)
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({})
  const [formData, setFormData] = useState<Record<string, SubagentFormData>>({})

  const fetchData = useCallback(async () => {
    if (!isAuthenticated) return

    setLoading(true)
    setError(null)
    try {
      const [defsRes, providersData] = await Promise.all([getSubagentDefinitions(), getProviders()])

      const preferenceEntries = await Promise.all(
        defsRes.definitions.map(
          async (def) => [def.agentProfile, (await getSubagentPreference(def.agentProfile)).preference] as const,
        ),
      )
      const preferencesByProfile: Record<string, SubagentPreference> = {}
      for (const [profile, preference] of preferenceEntries) {
        if (preference) {
          preferencesByProfile[profile] = preference
        }
      }

      setDefinitions(defsRes.definitions)
      setPreferences(preferencesByProfile)
      setProviders(providersData)

      const initialFormData: Record<string, SubagentFormData> = {}
      defsRes.definitions.forEach((def) => {
        const pref = preferencesByProfile[def.agentProfile]
        initialFormData[def.agentProfile] = {
          providerId: pref?.providerId ?? '',
          model: pref?.model ?? '',
          fallbackMode: pref?.fallbackMode ?? def.providerPolicy.fallbackMode,
        }
      })
      setFormData(initialFormData)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('加载子代理配置失败'))
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleToggleExpand = (profile: string) => {
    setExpandedType((prev) => (prev === profile ? null : profile))
    setSaveErrors((prev) => ({ ...prev, [profile]: '' }))
  }

  const handleInputChange = (profile: string, field: keyof SubagentFormData, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [profile]: {
        ...prev[profile],
        [field]: value,
      },
    }))
    setSaveErrors((prev) => ({ ...prev, [profile]: '' }))
  }

  const handleSave = async (profile: string) => {
    const data = formData[profile]
    setSavingType(profile)
    setSaveErrors((prev) => ({ ...prev, [profile]: '' }))

    try {
      const request: { providerId?: string | null; model?: string | null; fallbackMode?: SubagentFallbackMode } = {}

      if (data.providerId) {
        request.providerId = data.providerId
      }
      if (data.model.trim()) {
        request.model = data.model.trim()
      }
      request.fallbackMode = data.fallbackMode

      await updateSubagentPreference(profile, request)
      await fetchData()
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : '保存配置失败'
      setSaveErrors((prev) => ({ ...prev, [profile]: message }))
    } finally {
      setSavingType(null)
    }
  }

  const handleReset = async (profile: string) => {
    if (!confirm('确定要重置此子代理的配置吗？这将恢复到默认设置。')) {
      return
    }

    setResettingType(profile)
    setSaveErrors((prev) => ({ ...prev, [profile]: '' }))

    try {
      await resetSubagentPreference(profile)
      await fetchData()
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : '重置配置失败'
      setSaveErrors((prev) => ({ ...prev, [profile]: message }))
    } finally {
      setResettingType(null)
    }
  }

  const getProviderDisplayName = (providerId: string | null | undefined): string => {
    if (!providerId) return '默认'
    const provider = providers.find((p) => p.providerId === providerId)
    return provider?.displayName || providerId
  }

  const getEffectiveConfig = (profile: string) => {
    const def = definitions.find((d) => d.agentProfile === profile)
    const pref = preferences[profile]

    return {
      providerId: pref?.providerId ?? def?.providerPolicy.defaultProviderId ?? null,
      model: pref?.model ?? def?.providerPolicy.defaultModel ?? null,
      fallbackMode: pref?.fallbackMode ?? def?.providerPolicy.fallbackMode ?? 'any_compatible',
      hasOverride:
        !!pref && (!!pref.providerId || !!pref.model || pref.fallbackMode !== def?.providerPolicy.fallbackMode),
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="settings-section">
        <h3>子代理配置</h3>
        <p className="settings-empty">请先登录以配置子代理</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="settings-section subagent-config">
        <h3>子代理配置</h3>
        <LoadingSpinner label="加载子代理配置..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="settings-section subagent-config">
        <h3>子代理配置</h3>
        <ErrorMessage error={error} retry={{ onClick: fetchData }} />
      </div>
    )
  }

  if (definitions.length === 0) {
    return (
      <div className="settings-section subagent-config">
        <h3>子代理配置</h3>
        <p className="settings-empty">暂无可用的子代理类型</p>
      </div>
    )
  }

  return (
    <div className="settings-section subagent-config">
      <div className="subagent-config-header">
        <h3>子代理配置</h3>
        <span className="subagent-config-hint">为每个子代理类型单独配置 LLM 提供商</span>
      </div>

      <div className="subagent-list">
        {definitions.map((def) => {
          const isExpanded = expandedType === def.agentProfile
          const effective = getEffectiveConfig(def.agentProfile)
          const currentFormData = formData[def.agentProfile] || {
            providerId: '',
            model: '',
            fallbackMode: def.providerPolicy.fallbackMode,
          }
          const saveError = saveErrors[def.agentProfile]

          return (
            <div key={def.agentProfile} className="subagent-card">
              <div
                className="subagent-card-header"
                onClick={() => handleToggleExpand(def.agentProfile)}
                data-testid={`subagent-card-${def.agentProfile}`}
              >
                <div className="subagent-info">
                  <span className="subagent-name">{def.displayName}</span>
                  <span className="subagent-type-badge">{def.agentProfile}</span>
                  {def.agentType !== def.agentProfile && (
                    <span className="subagent-runtime-badge">{def.agentType}</span>
                  )}
                  {effective.hasOverride && <span className="subagent-override-badge">已配置</span>}
                </div>
                <div className="subagent-effective-info">
                  <span className="effective-provider">{getProviderDisplayName(effective.providerId)}</span>
                  {effective.model && <span className="effective-model">{effective.model}</span>}
                </div>
                <button
                  className="subagent-expand-btn"
                  aria-expanded={isExpanded}
                  data-testid={`subagent-expand-${def.agentProfile}`}
                >
                  {isExpanded ? '收起' : '展开'}
                </button>
              </div>

              {isExpanded && (
                <div className="subagent-card-body">
                  <p className="subagent-description">{def.description}</p>
                  {(def.providerPolicy.requiredCapabilities?.length ?? 0) > 0 && (
                    <div className="subagent-capabilities">
                      <span className="capabilities-label">能力:</span>
                      <div className="capabilities-list">
                        {def.providerPolicy.requiredCapabilities?.map((cap) => (
                          <span key={cap} className="capability-tag">
                            {cap}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="subagent-form">
                    <div className="form-group">
                      <label htmlFor={`provider-${def.agentProfile}`}>服务提供商</label>
                      <select
                        id={`provider-${def.agentProfile}`}
                        value={currentFormData.providerId}
                        onChange={(e) => handleInputChange(def.agentProfile, 'providerId', e.target.value)}
                        className="input-field"
                        data-testid={`subagent-provider-${def.agentProfile}`}
                      >
                        <option value="">使用默认</option>
                        {providers.map((provider) => (
                          <option key={provider.providerId} value={provider.providerId}>
                            {provider.displayName}
                          </option>
                        ))}
                      </select>
                      <span className="form-hint">留空则使用全局默认提供商</span>
                    </div>

                    <div className="form-group">
                      <label htmlFor={`model-${def.agentProfile}`}>模型</label>
                      <input
                        id={`model-${def.agentProfile}`}
                        type="text"
                        value={currentFormData.model}
                        onChange={(e) => handleInputChange(def.agentProfile, 'model', e.target.value)}
                        placeholder="例如: gpt-4, claude-3-opus"
                        className="input-field"
                        data-testid={`subagent-model-${def.agentProfile}`}
                      />
                      <span className="form-hint">留空则使用提供商默认模型</span>
                    </div>

                    <div className="form-group">
                      <label htmlFor={`fallback-${def.agentProfile}`}>失败模式</label>
                      <select
                        id={`fallback-${def.agentProfile}`}
                        value={currentFormData.fallbackMode}
                        onChange={(e) =>
                          handleInputChange(def.agentProfile, 'fallbackMode', e.target.value as SubagentFallbackMode)
                        }
                        className="input-field"
                        data-testid={`subagent-fallback-${def.agentProfile}`}
                      >
                        {FALLBACK_MODE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <span className="form-hint">
                        {FALLBACK_MODE_OPTIONS.find((o) => o.value === currentFormData.fallbackMode)?.description}
                      </span>
                    </div>

                    {saveError && (
                      <div className="subagent-save-error" data-testid={`subagent-error-${def.agentProfile}`}>
                        {saveError}
                      </div>
                    )}

                    <div className="subagent-actions">
                      <button
                        className="secondary-button"
                        onClick={() => handleReset(def.agentProfile)}
                        disabled={savingType === def.agentProfile || resettingType === def.agentProfile}
                        data-testid={`subagent-reset-${def.agentProfile}`}
                      >
                        {resettingType === def.agentProfile ? '重置中...' : '重置'}
                      </button>
                      <button
                        className="primary-button"
                        onClick={() => handleSave(def.agentProfile)}
                        disabled={savingType === def.agentProfile || resettingType === def.agentProfile}
                        data-testid={`subagent-save-${def.agentProfile}`}
                      >
                        {savingType === def.agentProfile ? '保存中...' : '保存配置'}
                      </button>
                    </div>
                  </div>

                  <div className="subagent-effective-section">
                    <h4>当前生效配置</h4>
                    <div className="effective-config-grid">
                      <div className="effective-item">
                        <span className="effective-label">提供商:</span>
                        <span className={`effective-value${!effective.providerId ? ' not-configured' : ''}`}>
                          {effective.providerId ? getProviderDisplayName(effective.providerId) : '未配置'}
                        </span>
                      </div>
                      <div className="effective-item">
                        <span className="effective-label">模型:</span>
                        <span className={`effective-value${!effective.model ? ' not-configured' : ''}`}>
                          {effective.model ?? '未配置'}
                        </span>
                      </div>
                      <div className="effective-item">
                        <span className="effective-label">失败模式:</span>
                        <span className="effective-value">
                          {FALLBACK_MODE_OPTIONS.find((o) => o.value === effective.fallbackMode)?.label}
                        </span>
                      </div>
                      <div className="effective-item">
                        <span className="effective-label">用户覆盖:</span>
                        <span className={`effective-value ${effective.hasOverride ? 'has-override' : ''}`}>
                          {effective.hasOverride ? '已启用' : '未设置'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default SubagentConfig
