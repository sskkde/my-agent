import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import * as adminApi from '../../api/admin'
import { createApiKey } from '../../api/admin'
import { getReadiness } from '../../api/client'
import type { CreateApiKeyResponse } from '../../api/types'
import ErrorMessage from '../../components/ErrorMessage'
import './Setup.css'

export interface SetupStep {
  id: string
  title: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'warning' | 'error'
  optional?: boolean
}

export interface ProductionReadinessItem {
  id: string
  label: string
  description: string
  status: 'ok' | 'warning' | 'error' | 'pending'
  details?: string
}

interface ProductionSetupChecklistProps {
  onComplete?: () => void
}

const ProductionSetupChecklist: React.FC<ProductionSetupChecklistProps> = ({ onComplete }) => {
  const { setupUser } = useAuth()

  const [currentStep, setCurrentStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [apiKeyName, setApiKeyName] = useState('Production API Key')
  const [createdApiKey, setCreatedApiKey] = useState<CreateApiKeyResponse | null>(null)
  const [apiKeyCopied, setApiKeyCopied] = useState(false)

  const [readinessItems, setReadinessItems] = useState<ProductionReadinessItem[]>([])
  const [checkingReadiness, setCheckingReadiness] = useState(false)

  const steps: SetupStep[] = [
    {
      id: 'admin_user',
      title: '创建管理员账户',
      description: '创建第一个管理员账户以管理平台',
      status: currentStep > 0 ? 'completed' : currentStep === 0 ? 'in_progress' : 'pending',
    },
    {
      id: 'api_key',
      title: '创建 API 密钥',
      description: '创建用于程序化访问的 API 密钥',
      status: currentStep > 1 ? 'completed' : currentStep === 1 ? 'in_progress' : 'pending',
      optional: true,
    },
    {
      id: 'readiness_check',
      title: '生产就绪检查',
      description: '检查生产环境配置是否完整',
      status: currentStep > 2 ? 'completed' : currentStep === 2 ? 'in_progress' : 'pending',
    },
  ]

  const checkProductionReadiness = useCallback(async () => {
    setCheckingReadiness(true)
    try {
      const items: ProductionReadinessItem[] = []

      // Check connector health (separate API)
      try {
        const connectorHealth = await adminApi.getConnectorHealth()
        const hasUnhealthy = connectorHealth.connectors.some((c) => c.status === 'unhealthy')
        const hasDegraded = connectorHealth.connectors.some((c) => c.status === 'degraded')

        if (connectorHealth.connectors.length === 0) {
          items.push({
            id: 'connectors',
            label: '连接器配置',
            description: '没有配置任何连接器',
            status: 'warning',
            details: '连接器用于集成外部服务，如 GitHub、Google 等。可以在设置页面配置。',
          })
        } else if (hasUnhealthy) {
          items.push({
            id: 'connectors',
            label: '连接器状态',
            description: '部分连接器状态异常',
            status: 'error',
            details: `异常连接器: ${connectorHealth.connectors
              .filter((c) => c.status === 'unhealthy')
              .map((c) => c.displayName)
              .join(', ')}`,
          })
        } else if (hasDegraded) {
          items.push({
            id: 'connectors',
            label: '连接器状态',
            description: '部分连接器状态降级',
            status: 'warning',
            details: `降级连接器: ${connectorHealth.connectors
              .filter((c) => c.status === 'degraded')
              .map((c) => c.displayName)
              .join(', ')}`,
          })
        } else {
          items.push({
            id: 'connectors',
            label: '连接器状态',
            description: '所有连接器运行正常',
            status: 'ok',
          })
        }
      } catch {
        items.push({
          id: 'connectors',
          label: '连接器检查',
          description: '无法检查连接器状态',
          status: 'pending',
        })
      }

      // Fetch backend readiness items
      try {
        const readinessResponse = await getReadiness()
        for (const item of readinessResponse.items) {
          items.push({
            id: item.id,
            label: item.label,
            description: item.details,
            status: item.status,
            details: item.details,
          })
        }
      } catch (err) {
        // On API failure, show error items instead of marking OK
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        items.push({
          id: 'api_error',
          label: '后端状态检查失败',
          description: '无法从后端获取配置状态',
          status: 'error',
          details: `错误: ${errorMessage}`,
        })
      }

      items.push({
        id: 'database_backup',
        label: '数据库备份',
        description: '定期数据备份策略',
        status: 'warning',
        details: '请确保配置了定期数据库备份策略。SQLite 数据库文件位于 ./data/ 目录',
      })

      setReadinessItems(items)
    } finally {
      setCheckingReadiness(false)
    }
  }, [])

  useEffect(() => {
    if (currentStep === 2) {
      checkProductionReadiness()
    }
  }, [currentStep, checkProductionReadiness])

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!username.trim()) {
      setError(new Error('用户名不能为空'))
      return
    }

    if (password.length < 8) {
      setError(new Error('密码至少需要 8 个字符'))
      return
    }

    if (password !== confirmPassword) {
      setError(new Error('两次输入的密码不一致'))
      return
    }

    setLoading(true)
    try {
      await setupUser(username.trim(), password)
      setCurrentStep(1)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('创建管理员失败'))
    } finally {
      setLoading(false)
    }
  }

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!apiKeyName.trim()) {
      setError(new Error('API 密钥名称不能为空'))
      return
    }

    setLoading(true)
    try {
      const result = await createApiKey({
        name: apiKeyName.trim(),
        role: 'admin',
      })
      setCreatedApiKey(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('创建 API 密钥失败'))
    } finally {
      setLoading(false)
    }
  }

  const handleCopyApiKey = async () => {
    if (createdApiKey?.key) {
      await navigator.clipboard.writeText(createdApiKey.key)
      setApiKeyCopied(true)
      setTimeout(() => setApiKeyCopied(false), 2000)
    }
  }

  const handleSkipApiKey = () => {
    setCurrentStep(2)
  }

  const handleContinueAfterApiKey = () => {
    setCurrentStep(2)
  }

  const handleComplete = () => {
    onComplete?.()
  }

  const renderStepIndicator = () => (
    <div className="setup-steps-indicator">
      {steps.map((step, index) => (
        <div key={step.id} className={`setup-step-item ${step.status} ${currentStep === index ? 'active' : ''}`}>
          <div className="setup-step-number">{step.status === 'completed' ? '✓' : index + 1}</div>
          <div className="setup-step-info">
            <div className="setup-step-title">
              {step.title}
              {step.optional && <span className="optional-badge">可选</span>}
            </div>
            <div className="setup-step-desc">{step.description}</div>
          </div>
        </div>
      ))}
    </div>
  )

  const renderAdminUserStep = () => (
    <div className="setup-form-container">
      <h2 className="setup-form-title">创建管理员账户</h2>
      <p className="setup-form-subtitle">这是平台的第一个账户，将自动获得管理员权限</p>

      <form className="setup-form" onSubmit={handleCreateAdmin}>
        {error && <ErrorMessage error={error} size="small" data-testid="setup-admin-error" />}

        <div className="setup-field">
          <label htmlFor="admin-username" className="setup-label">
            用户名
          </label>
          <input
            id="admin-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="setup-input"
            placeholder="请输入管理员用户名"
            disabled={loading}
            data-testid="admin-username-input"
            autoComplete="username"
          />
        </div>

        <div className="setup-field">
          <label htmlFor="admin-password" className="setup-label">
            密码
          </label>
          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="setup-input"
            placeholder="至少 8 个字符"
            disabled={loading}
            data-testid="admin-password-input"
            autoComplete="new-password"
          />
        </div>

        <div className="setup-field">
          <label htmlFor="admin-confirm-password" className="setup-label">
            确认密码
          </label>
          <input
            id="admin-confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="setup-input"
            placeholder="再次输入密码"
            disabled={loading}
            data-testid="admin-confirm-password-input"
            autoComplete="new-password"
          />
        </div>

        <button type="submit" className="setup-submit-button" disabled={loading} data-testid="admin-create-submit">
          {loading ? '创建中...' : '创建管理员账户'}
        </button>
      </form>
    </div>
  )

  const renderApiKeyStep = () => (
    <div className="setup-form-container">
      <h2 className="setup-form-title">创建 API 密钥</h2>
      <p className="setup-form-subtitle">API 密钥用于程序化访问平台，如 CI/CD 集成、自动化脚本等</p>

      {createdApiKey ? (
        <div className="api-key-success">
          <div className="api-key-success-icon">✓</div>
          <h3>API 密钥已创建</h3>
          <p className="api-key-warning">请立即复制此密钥，它将不会再次显示</p>
          <div className="api-key-display">
            <code>{createdApiKey.key}</code>
            <button className="copy-button" onClick={handleCopyApiKey} data-testid="copy-api-key-btn">
              {apiKeyCopied ? '已复制!' : '复制'}
            </button>
          </div>
          <div className="api-key-info">
            <p>
              <strong>名称:</strong> {createdApiKey.name}
            </p>
            <p>
              <strong>前缀:</strong> {createdApiKey.prefix}
            </p>
            <p>
              <strong>角色:</strong> {createdApiKey.role}
            </p>
          </div>
          <button
            className="setup-submit-button"
            onClick={handleContinueAfterApiKey}
            data-testid="continue-after-api-key"
          >
            继续
          </button>
        </div>
      ) : (
        <form className="setup-form" onSubmit={handleCreateApiKey}>
          {error && <ErrorMessage error={error} size="small" data-testid="setup-api-key-error" />}

          <div className="setup-field">
            <label htmlFor="api-key-name" className="setup-label">
              密钥名称
            </label>
            <input
              id="api-key-name"
              type="text"
              value={apiKeyName}
              onChange={(e) => setApiKeyName(e.target.value)}
              className="setup-input"
              placeholder="例如: Production API Key"
              disabled={loading}
              data-testid="api-key-name-input"
            />
          </div>

          <div className="setup-actions">
            <button
              type="submit"
              className="setup-submit-button"
              disabled={loading}
              data-testid="api-key-create-submit"
            >
              {loading ? '创建中...' : '创建 API 密钥'}
            </button>
            <button
              type="button"
              className="setup-skip-button"
              onClick={handleSkipApiKey}
              disabled={loading}
              data-testid="skip-api-key-btn"
            >
              跳过此步骤
            </button>
          </div>
        </form>
      )}
    </div>
  )

  const renderReadinessStep = () => (
    <div className="setup-form-container">
      <h2 className="setup-form-title">生产就绪检查</h2>
      <p className="setup-form-subtitle">检查生产环境配置是否完整</p>

      {checkingReadiness ? (
        <div className="readiness-loading">
          <div className="loading-spinner"></div>
          <p>正在检查配置...</p>
        </div>
      ) : (
        <>
          <div className="readiness-checklist">
            {readinessItems.map((item) => (
              <div key={item.id} className={`readiness-item ${item.status}`} data-testid={`readiness-${item.id}`}>
                <div className="readiness-icon">
                  {item.status === 'ok' && '✓'}
                  {item.status === 'warning' && '⚠'}
                  {item.status === 'error' && '✗'}
                  {item.status === 'pending' && '○'}
                </div>
                <div className="readiness-content">
                  <div className="readiness-label">{item.label}</div>
                  <div className="readiness-description">{item.description}</div>
                  {item.details && <div className="readiness-details">{item.details}</div>}
                </div>
              </div>
            ))}
          </div>

          <div className="readiness-summary">
            <p>完成上述检查后，点击下方按钮完成设置向导。 您可以随时在管理控制台中查看和修改配置。</p>
          </div>

          <button className="setup-submit-button" onClick={handleComplete} data-testid="complete-setup-btn">
            完成设置
          </button>
        </>
      )}
    </div>
  )

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 0:
        return renderAdminUserStep()
      case 1:
        return renderApiKeyStep()
      case 2:
        return renderReadinessStep()
      default:
        return null
    }
  }

  return (
    <div className="setup-page" data-testid="production-setup-page">
      <div className="setup-container">
        <div className="setup-header">
          <h1 className="setup-title">Agent Platform 设置</h1>
          <p className="setup-subtitle">欢迎使用 Agent Platform 设置向导</p>
        </div>

        {renderStepIndicator()}

        <div className="setup-content">{renderCurrentStep()}</div>
      </div>
    </div>
  )
}

export default ProductionSetupChecklist
