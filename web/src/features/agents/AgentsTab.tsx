import React, { useState, useEffect, useCallback } from 'react'
import {
  getAgentConfig,
  updateAgentConfig,
  resetAgentConfigOverride,
  getProviders,
  getTools,
  getSkills,
  ApiClientError,
} from '../../api/client'
import type {
  AgentConfig,
  ProviderSummary,
  ToolSummary,
  SkillSummary,
  UpdateAgentGlobalConfigRequest,
  UpdateAgentUserOverrideRequest,
} from '../../api/types'
import LoadingSpinner from '../../components/LoadingSpinner'
import { getSkillTypeLabel, getToolDisplayName } from '../../i18n/labels'

interface FormData {
  providerId: string
  model: string
  systemPrompt: string
  routingPrompt: string
  allowedToolIds: string[]
  allowedSkillIds: string[]
  routingTimeoutMs: number
  toolScopeMode: 'inherit' | 'all' | 'none' | 'custom'
}

const initialFormData: FormData = {
  providerId: '',
  model: '',
  systemPrompt: '',
  routingPrompt: '',
  allowedToolIds: [],
  allowedSkillIds: [],
  routingTimeoutMs: 60000,
  toolScopeMode: 'custom',
}

const AGENT_ID = 'foreground.default'
const MIN_TIMEOUT = 1 // seconds
const MAX_TIMEOUT = 60 // seconds (matching backend max of 60000ms)

const AgentsTab: React.FC = () => {
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  const [tools, setTools] = useState<ToolSummary[]>([])
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [formData, setFormData] = useState<FormData>(initialFormData)
  const [activeScope, setActiveScope] = useState<'global' | 'override'>('global')
  const [hasOverride, setHasOverride] = useState(false)
  const [overrideTimingTouched, setOverrideTimingTouched] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [configData, providersData, toolsData, skillsData] = await Promise.all([
        getAgentConfig(AGENT_ID),
        getProviders(),
        getTools(),
        getSkills(),
      ])

      setConfig(configData)
      setProviders(providersData)
      setTools(toolsData.tools)
      setSkills(skillsData.skills)
      setHasOverride(configData.userOverride !== null)
      setOverrideTimingTouched(false)

      const effective = configData.effective
      const toolScopeMode =
        configData.userOverride?.allowedToolIds === null
          ? 'inherit'
          : configData.userOverride?.allowedToolIds?.length === 0
            ? 'none'
            : configData.userOverride?.allowedToolIds?.length === toolsData.tools.length
              ? 'all'
              : 'custom'
      setFormData({
        providerId: effective.providerId,
        model: effective.model,
        systemPrompt: effective.systemPrompt ?? '',
        routingPrompt: effective.routingPrompt ?? '',
        allowedToolIds: effective.allowedToolIds,
        allowedSkillIds: effective.allowedSkillIds,
        routingTimeoutMs: effective.routingTimeoutMs,
        toolScopeMode,
      })
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : '加载配置失败'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleInputChange = (field: keyof FormData, value: string | number | string[]) => {
    if (field === 'routingTimeoutMs' && activeScope === 'override') {
      setOverrideTimingTouched(true)
    }
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleToolToggle = (toolId: string) => {
    setFormData((prev) => {
      const current = prev.allowedToolIds
      const updated = current.includes(toolId) ? current.filter((id) => id !== toolId) : [...current, toolId]
      return { ...prev, allowedToolIds: updated, toolScopeMode: 'custom' }
    })
  }

  const handleToolScopeModeChange = (mode: 'inherit' | 'all' | 'none' | 'custom') => {
    setFormData((prev) => {
      if (mode === 'inherit') {
        return { ...prev, allowedToolIds: [], toolScopeMode: 'inherit' }
      }
      if (mode === 'all') {
        return { ...prev, allowedToolIds: tools.map((t) => t.name), toolScopeMode: 'all' }
      }
      if (mode === 'none') {
        return { ...prev, allowedToolIds: [], toolScopeMode: 'none' }
      }
      return { ...prev, toolScopeMode: 'custom' }
    })
  }

  const handleSkillToggle = (skillId: string) => {
    setFormData((prev) => {
      const current = prev.allowedSkillIds
      const updated = current.includes(skillId) ? current.filter((id) => id !== skillId) : [...current, skillId]
      return { ...prev, allowedSkillIds: updated }
    })
  }

  const handleSelectAllTools = () => {
    setFormData((prev) => ({
      ...prev,
      allowedToolIds: tools.map((t) => t.name),
    }))
  }

  const handleDeselectAllTools = () => {
    setFormData((prev) => ({ ...prev, allowedToolIds: [] }))
  }

  const handleSelectAllSkills = () => {
    setFormData((prev) => ({
      ...prev,
      allowedSkillIds: skills.map((s) => s.skillId),
    }))
  }

  const handleDeselectAllSkills = () => {
    setFormData((prev) => ({ ...prev, allowedSkillIds: [] }))
  }

  const validateForm = (): boolean => {
    if (!formData.providerId) {
      setSaveError('请选择服务提供商')
      return false
    }
    if (!formData.model.trim()) {
      setSaveError('请输入模型ID')
      return false
    }
    if (formData.routingTimeoutMs < MIN_TIMEOUT * 1000 || formData.routingTimeoutMs > MAX_TIMEOUT * 1000) {
      setSaveError(`超时时间必须在 ${MIN_TIMEOUT}-${MAX_TIMEOUT} 秒之间`)
      return false
    }
    return true
  }

  const handleSave = async () => {
    if (!validateForm()) return

    setSaving(true)
    setSaveError(null)

    try {
      const baseUpdateRequest = {
        providerId: formData.providerId,
        model: formData.model,
        systemPrompt: formData.systemPrompt,
        routingPrompt: formData.routingPrompt,
        allowedToolIds:
          activeScope === 'override' && formData.toolScopeMode === 'inherit' ? undefined : formData.allowedToolIds,
        allowedSkillIds: formData.allowedSkillIds,
      }
      const updateRequest: UpdateAgentGlobalConfigRequest | UpdateAgentUserOverrideRequest =
        activeScope === 'global'
          ? {
              ...baseUpdateRequest,
              routingTimeoutMs: formData.routingTimeoutMs,
              repairAttempts: config?.global.repairAttempts ?? config?.effective.repairAttempts ?? 1,
            }
          : {
              ...baseUpdateRequest,
              ...(overrideTimingTouched ? { routingTimeoutMs: formData.routingTimeoutMs } : {}),
            }

      await updateAgentConfig(AGENT_ID, activeScope, updateRequest)
      await fetchData()
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : '保存配置失败'
      setSaveError(message)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    if (!hasOverride) {
      if (config) {
        const global = config.global
        setOverrideTimingTouched(false)
        setFormData({
          providerId: global.providerId,
          model: global.model,
          systemPrompt: global.systemPrompt ?? '',
          routingPrompt: global.routingPrompt ?? '',
          allowedToolIds: global.allowedToolIds,
          allowedSkillIds: global.allowedSkillIds,
          routingTimeoutMs: global.routingTimeoutMs,
          toolScopeMode: 'custom',
        })
      }
      return
    }

    if (!confirm('确定要重置用户覆盖配置吗？这将恢复到全局默认设置。')) {
      return
    }

    setResetting(true)
    setSaveError(null)

    try {
      await resetAgentConfigOverride(AGENT_ID)
      await fetchData()
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : '重置配置失败'
      setSaveError(message)
    } finally {
      setResetting(false)
    }
  }

  const handleScopeChange = (scope: 'global' | 'override') => {
    setActiveScope(scope)
    setSaveError(null)
    setOverrideTimingTouched(false)

    if (config) {
      if (scope === 'global') {
        const global = config.global
        setFormData({
          providerId: global.providerId,
          model: global.model,
          systemPrompt: global.systemPrompt ?? '',
          routingPrompt: global.routingPrompt ?? '',
          allowedToolIds: global.allowedToolIds,
          allowedSkillIds: global.allowedSkillIds,
          routingTimeoutMs: global.routingTimeoutMs,
          toolScopeMode: 'custom',
        })
      } else {
        const override = config.userOverride
        const effective = config.effective
        const overrideToolIds = override?.allowedToolIds ?? effective.allowedToolIds
        const derivedToolScopeMode =
          override?.allowedToolIds === null
            ? 'inherit'
            : overrideToolIds.length === 0
              ? 'none'
              : overrideToolIds.length === tools.length
                ? 'all'
                : 'custom'
        setFormData({
          providerId: override?.providerId ?? effective.providerId,
          model: override?.model ?? effective.model,
          systemPrompt: override?.systemPrompt ?? effective.systemPrompt ?? '',
          routingPrompt: override?.routingPrompt ?? effective.routingPrompt ?? '',
          allowedToolIds: overrideToolIds,
          allowedSkillIds: override?.allowedSkillIds ?? effective.allowedSkillIds,
          routingTimeoutMs: override?.routingTimeoutMs ?? effective.routingTimeoutMs,
          toolScopeMode: derivedToolScopeMode,
        })
      }
    }
  }

  const getProviderDisplayName = (providerId: string): string => {
    const provider = providers.find((p) => p.providerId === providerId)
    return provider?.displayName || providerId
  }

  if (loading) {
    return (
      <div data-testid="agents-panel" className="agents-panel">
        <div className="content-header">
          <h2>代理配置</h2>
        </div>
        <div className="content-body">
          <LoadingSpinner label="加载代理配置..." />
        </div>
      </div>
    )
  }

  if (error || !config?.effective || !config.global) {
    const displayError = error || '配置数据不完整，请重试'
    return (
      <div data-testid="agents-panel" className="agents-panel">
        <div className="content-header">
          <h2>代理配置</h2>
        </div>
        <div className="content-body">
          <div className="agents-error" data-testid="agents-error">
            <p>{displayError}</p>
            <button className="retry-button" onClick={fetchData} data-testid="agents-retry-btn">
              重试
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="agents-panel" className="agents-panel">
      <div className="content-header">
        <h2>代理配置</h2>
      </div>

      <div className="content-body">
        <div className="agents-section">
          <h3>配置范围</h3>
          <div className="scope-selector" data-testid="scope-selector">
            <button
              className={`scope-btn ${activeScope === 'global' ? 'active' : ''}`}
              onClick={() => handleScopeChange('global')}
              data-testid="scope-global-btn"
            >
              全局默认
            </button>
            <button
              className={`scope-btn ${activeScope === 'override' ? 'active' : ''}`}
              onClick={() => handleScopeChange('override')}
              data-testid="scope-override-btn"
            >
              用户覆盖
              {hasOverride && <span className="override-badge">已设置</span>}
            </button>
          </div>
          <p className="scope-hint">
            {activeScope === 'global' ? '修改全局默认配置，影响所有用户。' : '设置用户特定的覆盖配置，仅影响当前用户。'}
          </p>
        </div>

        <div className="agents-section">
          <h3>模型配置</h3>
          {!config.effective.providerId && (
            <div className="unconfigured-banner" data-testid="unconfigured-banner">
              全局代理尚未配置服务提供商和模型，请先设置后再使用代理功能。
            </div>
          )}

          <div className="form-group">
            <label htmlFor="providerId">服务提供商 *</label>
            <select
              id="providerId"
              value={formData.providerId}
              onChange={(e) => handleInputChange('providerId', e.target.value)}
              className="input-field"
              data-testid="provider-select"
            >
              <option value="">选择提供商...</option>
              {providers.map((provider) => (
                <option key={provider.providerId} value={provider.providerId}>
                  {provider.displayName}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="model">模型 *</label>
            <input
              id="model"
              type="text"
              value={formData.model}
              onChange={(e) => handleInputChange('model', e.target.value)}
              placeholder="例如: gpt-4, claude-3-opus, llama2"
              className="input-field"
              data-testid="model-input"
            />
          </div>
        </div>

        <div className="agents-section">
          <h3>提示词配置</h3>

          <div className="form-group">
            <label htmlFor="systemPrompt">系统提示词</label>
            <textarea
              id="systemPrompt"
              value={formData.systemPrompt}
              onChange={(e) => handleInputChange('systemPrompt', e.target.value)}
              placeholder="输入系统提示词..."
              className="input-field textarea-field"
              rows={4}
              data-testid="system-prompt-textarea"
            />
            <span className="form-hint">定义代理的基本行为和角色。</span>
          </div>

          <div className="form-group">
            <label htmlFor="routingPrompt">路由提示词</label>
            <textarea
              id="routingPrompt"
              value={formData.routingPrompt}
              onChange={(e) => handleInputChange('routingPrompt', e.target.value)}
              placeholder="输入路由提示词..."
              className="input-field textarea-field"
              rows={4}
              data-testid="routing-prompt-textarea"
            />
            <span className="form-hint">定义任务路由和决策逻辑。</span>
          </div>
        </div>

        <div className="agents-section">
          <h3>允许的工具</h3>
          {activeScope === 'override' && (
            <div className="tool-scope-mode" data-testid="tool-scope-mode">
              <label className="radio-label">
                <input
                  type="radio"
                  name="toolScopeMode"
                  value="inherit"
                  checked={formData.toolScopeMode === 'inherit'}
                  onChange={() => handleToolScopeModeChange('inherit')}
                  data-testid="tool-scope-inherit"
                />
                <span>继承全局</span>
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  name="toolScopeMode"
                  value="all"
                  checked={formData.toolScopeMode === 'all'}
                  onChange={() => handleToolScopeModeChange('all')}
                  data-testid="tool-scope-all"
                />
                <span>允许所有工具</span>
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  name="toolScopeMode"
                  value="none"
                  checked={formData.toolScopeMode === 'none'}
                  onChange={() => handleToolScopeModeChange('none')}
                  data-testid="tool-scope-none"
                />
                <span>不允许任何工具</span>
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  name="toolScopeMode"
                  value="custom"
                  checked={formData.toolScopeMode === 'custom'}
                  onChange={() => handleToolScopeModeChange('custom')}
                  data-testid="tool-scope-custom"
                />
                <span>自定义</span>
              </label>
            </div>
          )}
          {formData.toolScopeMode === 'custom' && (
            <>
              <div className="multi-select-actions">
                <button className="action-link" onClick={handleSelectAllTools} data-testid="select-all-tools-btn">
                  全选
                </button>
                <button className="action-link" onClick={handleDeselectAllTools} data-testid="deselect-all-tools-btn">
                  取消全选
                </button>
              </div>
              <div className="multi-select-grid" data-testid="tools-multi-select">
                {tools.map((tool) => (
                  <label key={tool.name} className="multi-select-item">
                    <input
                      type="checkbox"
                      checked={formData.allowedToolIds.includes(tool.name)}
                      onChange={() => handleToolToggle(tool.name)}
                      data-testid={`tool-checkbox-${tool.name}`}
                    />
                    <span className="multi-select-label">
                      <span className="multi-select-name">{getToolDisplayName(tool.name)}</span>
                      <span className="multi-select-desc">{tool.description}</span>
                    </span>
                  </label>
                ))}
              </div>
              {tools.length === 0 && <p className="empty-hint">暂无可用的工具</p>}
            </>
          )}
        </div>

        <div className="agents-section">
          <h3>允许的技能</h3>
          <div className="multi-select-actions">
            <button className="action-link" onClick={handleSelectAllSkills} data-testid="select-all-skills-btn">
              全选
            </button>
            <button className="action-link" onClick={handleDeselectAllSkills} data-testid="deselect-all-skills-btn">
              取消全选
            </button>
          </div>
          <div className="multi-select-grid" data-testid="skills-multi-select">
            {skills.map((skill) => (
              <label key={skill.skillId} className="multi-select-item">
                <input
                  type="checkbox"
                  checked={formData.allowedSkillIds.includes(skill.skillId)}
                  onChange={() => handleSkillToggle(skill.skillId)}
                  data-testid={`skill-checkbox-${skill.skillId}`}
                />
                <span className="multi-select-label">
                  <span className="multi-select-name">{skill.name}</span>
                  <span className={`type-badge ${skill.type.toLowerCase()}`}>{getSkillTypeLabel(skill.type)}</span>
                </span>
              </label>
            ))}
          </div>
          {skills.length === 0 && <p className="empty-hint">暂无可用的技能</p>}
        </div>

        <div className="agents-section">
          <h3>超时配置</h3>
          <div className="form-group">
            <label htmlFor="routingTimeoutMs">
              路由超时时间 (秒) *
              <span className="timeout-range">
                {MIN_TIMEOUT}-{MAX_TIMEOUT}
              </span>
            </label>
            <input
              id="routingTimeoutMs"
              type="number"
              min={MIN_TIMEOUT}
              max={MAX_TIMEOUT}
              value={Math.round(formData.routingTimeoutMs / 1000)}
              onChange={(e) =>
                handleInputChange('routingTimeoutMs', (parseInt(e.target.value, 10) || MIN_TIMEOUT) * 1000)
              }
              className="input-field timeout-input"
              data-testid="timeout-input"
            />
            <span className="form-hint">
              路由请求的超时时间，范围 {MIN_TIMEOUT}-{MAX_TIMEOUT} 秒。
            </span>
          </div>
        </div>

        {saveError && (
          <div className="agents-save-error" data-testid="agents-save-error">
            {saveError}
          </div>
        )}

        <div className="agents-actions">
          <button
            className="secondary-button"
            onClick={handleReset}
            disabled={saving || resetting}
            data-testid="agents-reset-btn"
          >
            {resetting ? '重置中...' : '重置'}
          </button>
          <button
            className="primary-button"
            onClick={handleSave}
            disabled={saving || resetting}
            data-testid="agents-save-btn"
          >
            {saving ? '保存中...' : '保存配置'}
          </button>
        </div>

        {config && (
          <div className="agents-section agents-section--info">
            <h3>当前生效配置</h3>
            <div className="effective-config">
              <div className="effective-item">
                <span className="effective-label">提供商:</span>
                <span
                  className={`effective-value${!config.effective.providerId ? ' not-configured' : ''}`}
                  data-testid="effective-provider"
                >
                  {config.effective.providerId ? getProviderDisplayName(config.effective.providerId) : '未配置'}
                </span>
              </div>
              <div className="effective-item">
                <span className="effective-label">模型:</span>
                <span
                  className={`effective-value${!config.effective.model ? ' not-configured' : ''}`}
                  data-testid="effective-model"
                >
                  {config.effective.model ?? '未配置'}
                </span>
              </div>
              <div className="effective-item">
                <span className="effective-label">路由超时:</span>
                <span className="effective-value" data-testid="effective-timeout">
                  {Math.round(config.effective.routingTimeoutMs / 1000)} 秒
                </span>
              </div>
              <div className="effective-item">
                <span className="effective-label">允许工具:</span>
                <span className="effective-value" data-testid="effective-tools">
                  {config.effective.allowedToolIds.length} 个
                </span>
              </div>
              <div className="effective-item">
                <span className="effective-label">允许技能:</span>
                <span className="effective-value" data-testid="effective-skills">
                  {config.effective.allowedSkillIds.length} 个
                </span>
              </div>
              <div className="effective-item">
                <span className="effective-label">用户覆盖:</span>
                <span
                  className={`effective-value ${hasOverride ? 'has-override' : ''}`}
                  data-testid="effective-override"
                >
                  {hasOverride ? '已启用' : '未设置'}
                </span>
              </div>
              {config.effective.resolvedPromptType && (
                <div className="effective-item">
                  <span className="effective-label">提示词类型:</span>
                  <span className="effective-value" data-testid="effective-prompt-type">
                    {config.effective.resolvedPromptType}
                  </span>
                </div>
              )}
              {config.effective.resolvedPromptVersion && (
                <div className="effective-item">
                  <span className="effective-label">提示词版本:</span>
                  <span className="effective-value" data-testid="effective-prompt-version">
                    {config.effective.resolvedPromptVersion}
                  </span>
                </div>
              )}
              {config.effective.promptFallbackReason && (
                <div className="effective-item">
                  <span className="effective-label">提示词回退原因:</span>
                  <span className="effective-value" data-testid="effective-prompt-fallback">
                    {config.effective.promptFallbackReason === 'UNKNOWN_PROMPT_VERSION' ? '未知版本' : '未知类型'}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AgentsTab
