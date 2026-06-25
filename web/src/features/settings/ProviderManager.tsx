import React, { useState, useEffect, useCallback } from 'react'
import {
  getProviders,
  createProvider,
  updateProvider,
  deleteProvider,
  testProvider,
  ApiClientError,
} from '../../api/client'
import type {
  ProviderSummary,
  ProviderType,
  CreateProviderRequest,
  UpdateProviderRequest,
  TestProviderResponse,
} from '../../api/types'
import ErrorMessage from '../../components/ErrorMessage'
import LoadingSpinner from '../../components/LoadingSpinner'

interface ProviderManagerProps {
  isAuthenticated: boolean
}

interface ProviderFormData {
  providerType: ProviderType
  displayName: string
  apiKey: string
  baseUrl: string
  selectedModel: string
}

const PROVIDER_TYPE_OPTIONS: { value: ProviderType; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'ollama', label: 'Ollama (本地)' },
  { value: 'custom', label: '自定义' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'dashscope', label: 'DashScope (阿里云)' },
  { value: 'volcengine', label: '火山引擎 (豆包)' },
  { value: 'qianfan', label: '千帆 (百度)' },
  { value: 'zhipu', label: '智谱 AI' },
  { value: 'moonshot', label: 'Moonshot (月之暗面)' },
  { value: 'minimax', label: 'MiniMax' },
  { value: 'jdcloud-yanxi', label: '京东云言犀' },
  { value: 'mimo', label: 'MiMo' },
  { value: 'iflytek-spark', label: '讯飞星火' },
  { value: 'stepfun', label: '阶跃星辰' },
  { value: 'hunyuan', label: '混元 (腾讯)' },
  { value: 'siliconflow', label: 'SiliconFlow (硅基流动)' },
]

const getProviderTypeLabel = (type: ProviderType): string => {
  const option = PROVIDER_TYPE_OPTIONS.find((o) => o.value === type)
  return option?.label || type
}

const initialFormData: ProviderFormData = {
  providerType: 'openai',
  displayName: '',
  apiKey: '',
  baseUrl: '',
  selectedModel: '',
}

const requiresApiKey = (providerType: ProviderType): boolean => providerType !== 'ollama'
const requiresBaseUrl = (providerType: ProviderType): boolean => providerType === 'ollama' || providerType === 'custom'

/** Domestic providers have built-in base URLs and only need an API key. */
const isDomesticProvider = (providerType: ProviderType): boolean =>
  !['openai', 'openrouter', 'ollama', 'custom'].includes(providerType)

const ProviderManager: React.FC<ProviderManagerProps> = ({ isAuthenticated }) => {
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ProviderSummary | null>(null)
  const [formData, setFormData] = useState<ProviderFormData>(initialFormData)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{
    providerId: string
    result: TestProviderResponse
  } | null>(null)
  const [deletingProviderId, setDeletingProviderId] = useState<string | null>(null)
  const [togglingProviderId, setTogglingProviderId] = useState<string | null>(null)

  const fetchProviders = useCallback(async () => {
    if (!isAuthenticated) return

    setLoading(true)
    setError(null)
    try {
      const data = await getProviders()
      setProviders(data)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('加载提供商列表失败'))
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  const handleOpenAddModal = () => {
    setEditingProvider(null)
    setFormData(initialFormData)
    setFormErrors({})
    setTestResult(null)
    setIsModalOpen(true)
  }

  const handleOpenEditModal = (provider: ProviderSummary) => {
    setEditingProvider(provider)
    setFormData({
      providerType: provider.providerType,
      displayName: provider.displayName || '',
      apiKey: '',
      baseUrl: provider.baseUrl || '',
      selectedModel: provider.selectedModel || '',
    })
    setFormErrors({})
    setTestResult(null)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setEditingProvider(null)
    setFormData(initialFormData)
    setFormErrors({})
    setTestResult(null)
  }

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {}

    if (!formData.displayName.trim()) {
      errors.displayName = '请输入显示名称'
    }

    if (requiresBaseUrl(formData.providerType) && !formData.baseUrl.trim()) {
      errors.baseUrl = formData.providerType === 'custom' ? '自定义提供商需要指定 Base URL' : 'Ollama 需要指定 Base URL'
    }

    if (!editingProvider && requiresApiKey(formData.providerType) && !formData.apiKey.trim()) {
      errors.apiKey = '请输入 API Key'
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) return

    try {
      if (editingProvider) {
        // Update existing provider
        const updateData: UpdateProviderRequest = {
          displayName: formData.displayName,
          baseUrl: formData.baseUrl || undefined,
          selectedModel: formData.selectedModel || undefined,
          enabled: editingProvider.enabled,
        }

        // Only include API key if user entered a new one
        if (formData.apiKey.trim()) {
          updateData.apiKey = formData.apiKey
        }

        await updateProvider(editingProvider.providerId, updateData)
      } else {
        // Create new provider
        const createData: CreateProviderRequest = {
          providerType: formData.providerType,
          displayName: formData.displayName,
          baseUrl: formData.baseUrl || undefined,
          selectedModel: formData.selectedModel || undefined,
        }

        if (formData.apiKey.trim()) {
          createData.apiKey = formData.apiKey
        }

        await createProvider(createData)
      }

      handleCloseModal()
      await fetchProviders()
    } catch (err) {
      const error = err instanceof Error ? err : new Error('保存失败')
      setFormErrors({ submit: error.message })
    }
  }

  const handleTestConnection = async (providerId: string) => {
    setTestingProviderId(providerId)
    setTestResult(null)

    try {
      const result = await testProvider(providerId)
      setTestResult({ providerId, result })
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : '测试连接失败'
      setTestResult({
        providerId,
        result: {
          success: false,
          latencyMs: 0,
          error: message,
        },
      })
    } finally {
      setTestingProviderId(null)
    }
  }

  const handleDelete = async (providerId: string) => {
    if (!confirm('确定要删除此提供商吗？此操作不可恢复。')) {
      return
    }

    setDeletingProviderId(providerId)

    try {
      await deleteProvider(providerId)
      await fetchProviders()
    } catch (err) {
      setError(err instanceof Error ? err : new Error('删除失败'))
    } finally {
      setDeletingProviderId(null)
    }
  }

  const handleToggleEnabled = async (provider: ProviderSummary) => {
    setTogglingProviderId(provider.providerId)

    try {
      await updateProvider(provider.providerId, {
        enabled: !provider.enabled,
      })
      await fetchProviders()
    } catch (err) {
      setError(err instanceof Error ? err : new Error('更新状态失败'))
    } finally {
      setTogglingProviderId(null)
    }
  }

  const getLastTestStatusClass = (status: string | null): string => {
    switch (status) {
      case 'success':
        return 'test-status-success'
      case 'failed':
        return 'test-status-failed'
      default:
        return 'test-status-none'
    }
  }

  const getLastTestStatusText = (status: string | null): string => {
    switch (status) {
      case 'success':
        return '成功'
      case 'failed':
        return '失败'
      default:
        return '未测试'
    }
  }

  const envProviders = providers.filter((p) => p.source === 'env')
  const customProviders = providers.filter((p) => p.source !== 'env')

  if (!isAuthenticated) {
    return (
      <div className="settings-section">
        <h3>服务提供商管理</h3>
        <p className="settings-empty">请先登录以管理提供商</p>
      </div>
    )
  }

  return (
    <div className="settings-section provider-manager">
      <div className="provider-manager-header">
        <h3>服务提供商管理</h3>
        <button
          className="primary-button add-provider-btn"
          onClick={handleOpenAddModal}
          disabled={loading}
          data-testid="add-provider-btn"
        >
          添加提供商
        </button>
      </div>

      {error && <ErrorMessage error={error} retry={{ onClick: fetchProviders }} data-testid="provider-error" />}

      {loading && providers.length === 0 ? (
        <LoadingSpinner label="加载提供商列表..." />
      ) : (
        <>
          {/* Custom Providers */}
          {customProviders.length > 0 && (
            <div className="providers-group">
              <h4 className="providers-group-title">自定义提供商</h4>
              <div className="providers-list">
                {customProviders.map((provider) => (
                  <div
                    key={provider.providerId}
                    className="provider-card"
                    data-testid={`provider-${provider.providerId}`}
                  >
                    <div className="provider-card-header">
                      <div className="provider-info">
                        <span className="provider-type-badge">{getProviderTypeLabel(provider.providerType)}</span>
                        <span className="provider-name">{provider.displayName}</span>
                      </div>
                      <div className="provider-actions">
                        <label className="toggle-switch">
                          <input
                            type="checkbox"
                            checked={provider.enabled}
                            onChange={() => handleToggleEnabled(provider)}
                            disabled={togglingProviderId === provider.providerId}
                            data-testid={`provider-toggle-${provider.providerId}`}
                          />
                          <span className="toggle-slider"></span>
                        </label>
                        <button
                          className="action-btn test-btn"
                          onClick={() => handleTestConnection(provider.providerId)}
                          disabled={testingProviderId === provider.providerId}
                          data-testid={`provider-test-${provider.providerId}`}
                        >
                          {testingProviderId === provider.providerId ? '测试中...' : '测试连接'}
                        </button>
                        <button
                          className="action-btn edit-btn"
                          onClick={() => handleOpenEditModal(provider)}
                          data-testid={`provider-edit-${provider.providerId}`}
                        >
                          编辑
                        </button>
                        <button
                          className="action-btn delete-btn"
                          onClick={() => handleDelete(provider.providerId)}
                          disabled={deletingProviderId === provider.providerId}
                          data-testid={`provider-delete-${provider.providerId}`}
                        >
                          {deletingProviderId === provider.providerId ? '删除中...' : '删除'}
                        </button>
                      </div>
                    </div>

                    <div className="provider-card-details">
                      <div className="provider-detail">
                        <span className="detail-label">状态:</span>
                        <span
                          className={`detail-value status-badge ${
                            provider.enabled ? 'status-enabled' : 'status-disabled'
                          }`}
                        >
                          {provider.enabled ? '已启用' : '已禁用'}
                        </span>
                      </div>
                      <div className="provider-detail">
                        <span className="detail-label">配置:</span>
                        <span
                          className={`detail-value status-badge ${
                            provider.configured ? 'status-configured' : 'status-unconfigured'
                          }`}
                        >
                          {provider.configured ? '已配置' : '未配置'}
                        </span>
                      </div>
                      {provider.apiKeyLast4 && (
                        <div className="provider-detail">
                          <span className="detail-label">API Key:</span>
                          <span className="detail-value api-key-mask">****{provider.apiKeyLast4}</span>
                        </div>
                      )}
                      {provider.baseUrl && (
                        <div className="provider-detail">
                          <span className="detail-label">Base URL:</span>
                          <span className="detail-value">{provider.baseUrl}</span>
                        </div>
                      )}
                      {provider.selectedModel && (
                        <div className="provider-detail">
                          <span className="detail-label">模型:</span>
                          <span className="detail-value">{provider.selectedModel}</span>
                        </div>
                      )}
                      <div className="provider-detail">
                        <span className="detail-label">连接测试:</span>
                        <span className={`detail-value test-status ${getLastTestStatusClass(provider.lastTestStatus)}`}>
                          {getLastTestStatusText(provider.lastTestStatus)}
                          {provider.lastTestedAt && (
                            <span className="test-timestamp">
                              {' '}
                              ({new Date(provider.lastTestedAt).toLocaleString()})
                            </span>
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Test Result */}
                    {testResult?.providerId === provider.providerId && (
                      <div
                        className={`test-result ${testResult.result.success ? 'test-success' : 'test-failed'}`}
                        data-testid={`test-result-${provider.providerId}`}
                      >
                        {testResult.result.success ? (
                          <>
                            <span className="test-result-icon">✓</span>
                            <span className="test-result-text">
                              连接成功! 延迟: {testResult.result.latencyMs}ms
                              {testResult.result.modelCount !== undefined &&
                                `, 可用模型: ${testResult.result.modelCount}个`}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="test-result-icon">✗</span>
                            <span className="test-result-text">连接失败: {testResult.result.error}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Environment Providers */}
          {envProviders.length > 0 && (
            <div className="providers-group">
              <h4 className="providers-group-title">环境变量配置</h4>
              <div className="providers-list">
                {envProviders.map((provider) => (
                  <div
                    key={provider.providerId}
                    className="provider-card provider-card--readonly"
                    data-testid={`env-provider-${provider.providerId}`}
                  >
                    <div className="provider-card-header">
                      <div className="provider-info">
                        <span className="provider-type-badge">{getProviderTypeLabel(provider.providerType)}</span>
                        <span className="provider-name">{provider.displayName}</span>
                        <span className="env-badge">环境变量配置</span>
                      </div>
                      <div className="provider-actions">
                        <button
                          className="action-btn test-btn"
                          onClick={() => handleTestConnection(provider.providerId)}
                          disabled={testingProviderId === provider.providerId}
                          data-testid={`env-provider-test-${provider.providerId}`}
                        >
                          {testingProviderId === provider.providerId ? '测试中...' : '测试连接'}
                        </button>
                      </div>
                    </div>

                    <div className="provider-card-details">
                      <div className="provider-detail">
                        <span className="detail-label">状态:</span>
                        <span
                          className={`detail-value status-badge ${
                            provider.enabled ? 'status-enabled' : 'status-disabled'
                          }`}
                        >
                          {provider.enabled ? '已启用' : '已禁用'}
                        </span>
                      </div>
                      <div className="provider-detail">
                        <span className="detail-label">配置:</span>
                        <span
                          className={`detail-value status-badge ${
                            provider.configured ? 'status-configured' : 'status-unconfigured'
                          }`}
                        >
                          {provider.configured ? '已配置' : '未配置'}
                        </span>
                      </div>
                      {provider.apiKeyLast4 && (
                        <div className="provider-detail">
                          <span className="detail-label">API Key:</span>
                          <span className="detail-value api-key-mask">****{provider.apiKeyLast4}</span>
                        </div>
                      )}
                      <div className="provider-detail">
                        <span className="detail-label">连接测试:</span>
                        <span className={`detail-value test-status ${getLastTestStatusClass(provider.lastTestStatus)}`}>
                          {getLastTestStatusText(provider.lastTestStatus)}
                        </span>
                      </div>
                    </div>

                    {/* Test Result */}
                    {testResult?.providerId === provider.providerId && (
                      <div className={`test-result ${testResult.result.success ? 'test-success' : 'test-failed'}`}>
                        {testResult.result.success ? (
                          <>
                            <span className="test-result-icon">✓</span>
                            <span className="test-result-text">
                              连接成功! 延迟: {testResult.result.latencyMs}ms
                              {testResult.result.modelCount !== undefined &&
                                `, 可用模型: ${testResult.result.modelCount}个`}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="test-result-icon">✗</span>
                            <span className="test-result-text">连接失败: {testResult.result.error}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {providers.length === 0 && !loading && (
            <div className="providers-empty" data-testid="providers-empty">
              <p>暂无服务提供商</p>
              <p className="providers-empty-hint">点击上方按钮添加提供商</p>
            </div>
          )}
        </>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="modal-overlay" data-testid="provider-modal">
          <div className="modal-content">
            <div className="modal-header">
              <h4>{editingProvider ? '编辑提供商' : '添加提供商'}</h4>
              <button className="modal-close" onClick={handleCloseModal} data-testid="modal-close">
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} className="provider-form">
              <div className="form-group">
                <label htmlFor="providerType">提供商类型 *</label>
                <select
                  id="providerType"
                  value={formData.providerType}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      providerType: e.target.value as ProviderType,
                    }))
                  }
                  disabled={!!editingProvider}
                  className="input-field"
                  data-testid="provider-type-select"
                >
                  {PROVIDER_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {editingProvider && <span className="form-hint">提供商类型不可修改</span>}
              </div>

              <div className="form-group">
                <label htmlFor="displayName">显示名称 *</label>
                <input
                  id="displayName"
                  type="text"
                  value={formData.displayName}
                  onChange={(e) => setFormData((prev) => ({ ...prev, displayName: e.target.value }))}
                  placeholder="例如: 我的 OpenAI 账户"
                  className={`input-field ${formErrors.displayName ? 'input-error' : ''}`}
                  data-testid="provider-display-name"
                />
                {formErrors.displayName && <span className="form-error">{formErrors.displayName}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="apiKey">
                  API Key
                  {requiresApiKey(formData.providerType) && !editingProvider && (
                    <span className="required-mark">*</span>
                  )}
                </label>
                <input
                  id="apiKey"
                  type="password"
                  value={formData.apiKey}
                  onChange={(e) => setFormData((prev) => ({ ...prev, apiKey: e.target.value }))}
                  placeholder={editingProvider ? '留空以保持当前密钥' : '输入您的 API Key'}
                  className={`input-field ${formErrors.apiKey ? 'input-error' : ''}`}
                  data-testid="provider-api-key"
                />
                {formErrors.apiKey && <span className="form-error">{formErrors.apiKey}</span>}
                {editingProvider && <span className="form-hint">留空以保持当前密钥不变</span>}
                {formData.providerType === 'ollama' && <span className="form-hint">Ollama 本地部署不需要 API Key</span>}
                {formData.providerType === 'custom' && (
                  <span className="form-hint">用于访问自定义 OpenAI 兼容接口的 Bearer API Key</span>
                )}
                {isDomesticProvider(formData.providerType) && (
                  <span className="form-hint">国内提供商已内置 Base URL，只需填写 API Key</span>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="baseUrl">
                  Base URL
                  {requiresBaseUrl(formData.providerType) && <span className="required-mark">*</span>}
                </label>
                <input
                  id="baseUrl"
                  type="url"
                  value={formData.baseUrl}
                  onChange={(e) => setFormData((prev) => ({ ...prev, baseUrl: e.target.value }))}
                  placeholder={
                    formData.providerType === 'ollama'
                      ? 'http://localhost:11434'
                      : formData.providerType === 'custom'
                        ? 'https://api.example.com/v1'
                        : '可选，留空使用默认地址'
                  }
                  className={`input-field ${formErrors.baseUrl ? 'input-error' : ''}`}
                  data-testid="provider-base-url"
                />
                {formErrors.baseUrl && <span className="form-error">{formErrors.baseUrl}</span>}
                {formData.providerType === 'ollama' && (
                  <span className="form-hint">Ollama 需要指定 Base URL，默认为 http://localhost:11434</span>
                )}
                {formData.providerType === 'custom' && (
                  <span className="form-hint">填写 OpenAI 兼容接口地址；如果不含 /v1，测试时会自动请求 /v1/models</span>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="selectedModel">默认模型</label>
                <input
                  id="selectedModel"
                  type="text"
                  value={formData.selectedModel}
                  onChange={(e) => setFormData((prev) => ({ ...prev, selectedModel: e.target.value }))}
                  placeholder="例如: gpt-4, claude-3-opus, qwen-plus"
                  className="input-field"
                  data-testid="provider-model"
                />
                <span className="form-hint">可选，留空则使用提供商默认模型</span>
              </div>

              {formErrors.submit && <div className="form-submit-error">{formErrors.submit}</div>}

              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleCloseModal}
                  data-testid="modal-cancel"
                >
                  取消
                </button>
                <button type="submit" className="primary-button" data-testid="modal-submit">
                  {editingProvider ? '保存更改' : '添加提供商'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default ProviderManager
