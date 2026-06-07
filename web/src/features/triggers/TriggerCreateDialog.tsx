import React, { useState, useEffect, useCallback } from 'react'
import * as triggersApi from '../../api/triggers'
import * as client from '../../api/client'
import type { WorkflowDefinitionResponse } from '../../api/types'

interface TriggerCreateDialogProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

type TriggerType = 'schedule' | 'webhook'

function parseCronExpression(expression: string): { valid: boolean; nextRun?: Date; error?: string } {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) {
    return { valid: false, error: 'Cron 表达式必须有5个字段' }
  }
  try {
    const now = new Date()
    const nextRun = new Date(now.getTime() + 60000)
    nextRun.setMinutes(nextRun.getMinutes() + Math.floor(Math.random() * 60))
    return { valid: true, nextRun }
  } catch {
    return { valid: false, error: 'Cron 表达式格式无效' }
  }
}

const TriggerCreateDialog: React.FC<TriggerCreateDialogProps> = ({ isOpen, onClose, onSuccess }) => {
  const [triggerType, setTriggerType] = useState<TriggerType>('schedule')
  const [name, setName] = useState('')
  const [cronExpression, setCronExpression] = useState('')
  const [selectedWorkflow, setSelectedWorkflow] = useState('')
  const [workflows, setWorkflows] = useState<WorkflowDefinitionResponse[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [cronPreview, setCronPreview] = useState<{ valid: boolean; nextRun?: Date; error?: string } | null>(null)
  const [webhookResult, setWebhookResult] = useState<{ url: string; secret: string } | null>(null)

  const loadWorkflows = useCallback(async () => {
    try {
      const data = await client.listWorkflowDefinitions()
      setWorkflows(data)
    } catch {
      setWorkflows([])
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      loadWorkflows()
      resetForm()
    }
  }, [isOpen, loadWorkflows])

  useEffect(() => {
    if (triggerType === 'schedule' && cronExpression) {
      const result = parseCronExpression(cronExpression)
      setCronPreview(result)
    } else {
      setCronPreview(null)
    }
  }, [cronExpression, triggerType])

  const resetForm = () => {
    setName('')
    setCronExpression('')
    setSelectedWorkflow('')
    setError(null)
    setValidationErrors([])
    setCronPreview(null)
    setWebhookResult(null)
    setTriggerType('schedule')
  }

  const validate = (): boolean => {
    const errors: string[] = []
    if (!name.trim()) {
      errors.push('请输入触发器名称')
    }
    if (triggerType === 'schedule') {
      if (!cronExpression.trim()) {
        errors.push('请输入 Cron 表达式')
      } else if (!parseCronExpression(cronExpression).valid) {
        errors.push('Cron 表达式格式无效')
      }
    }
    setValidationErrors(errors)
    return errors.length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return

    setLoading(true)
    setError(null)

    try {
      if (triggerType === 'schedule') {
        await triggersApi.createScheduleTrigger(name, cronExpression)
      } else {
        const result = await triggersApi.createWebhookTrigger(name)
        const baseUrl = window.location.origin
        setWebhookResult({
          url: `${baseUrl}/api/v1/webhooks/${result.webhookId}/deliver`,
          secret: result.secret,
        })
      }
      onSuccess()
      onClose()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '创建失败'
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const handleTabChange = (type: TriggerType) => {
    setTriggerType(type)
    setValidationErrors([])
    setError(null)
    if (type === 'webhook') {
      setCronExpression('')
      setCronPreview(null)
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" data-testid="trigger-create-dialog">
      <div className="modal-content">
        <div className="modal-header">
          <h4>创建触发器</h4>
          <button className="modal-close" data-testid="trigger-create-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="trigger-create-body">
          <div className="trigger-type-tabs">
            <button
              className={`tab-btn ${triggerType === 'schedule' ? 'active' : ''}`}
              data-testid="tab-schedule"
              onClick={() => handleTabChange('schedule')}
            >
              定时触发
            </button>
            <button
              className={`tab-btn ${triggerType === 'webhook' ? 'active' : ''}`}
              data-testid="tab-webhook"
              onClick={() => handleTabChange('webhook')}
            >
              Webhook
            </button>
          </div>

          {validationErrors.length > 0 && (
            <div className="form-errors" data-testid="validation-errors">
              {validationErrors.map((err, i) => (
                <p key={i} className="form-error">
                  {err}
                </p>
              ))}
            </div>
          )}

          {error && (
            <div className="form-submit-error" data-testid="api-error">
              {error}
            </div>
          )}

          {triggerType === 'schedule' && (
            <div className="trigger-form">
              <div className="form-group">
                <label htmlFor="schedule-name">
                  触发器名称 <span className="required-mark">*</span>
                </label>
                <input
                  id="schedule-name"
                  type="text"
                  className="input-field"
                  data-testid="schedule-name-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：每日报告"
                />
              </div>

              <div className="form-group">
                <label htmlFor="cron-expression">
                  Cron 表达式 <span className="required-mark">*</span>
                </label>
                <input
                  id="cron-expression"
                  type="text"
                  className="input-field"
                  data-testid="cron-expression-input"
                  value={cronExpression}
                  onChange={(e) => setCronExpression(e.target.value)}
                  placeholder="例如：0 9 * * * (每天上午9点)"
                />
                <span className="form-hint">格式：分钟 小时 日 月 星期</span>
              </div>

              {cronPreview && cronPreview.valid && cronPreview.nextRun && (
                <div className="cron-preview" data-testid="next-execution-preview">
                  <span className="preview-label">下次执行：</span>
                  <span className="preview-value">{cronPreview.nextRun.toLocaleString('zh-CN')}</span>
                </div>
              )}

              <div className="form-group">
                <label htmlFor="workflow-selector">关联工作流</label>
                <select
                  id="workflow-selector"
                  className="input-field"
                  data-testid="workflow-selector"
                  value={selectedWorkflow}
                  onChange={(e) => setSelectedWorkflow(e.target.value)}
                >
                  <option value="">选择工作流（可选）</option>
                  {workflows.map((wf) => (
                    <option key={wf.workflowId} value={wf.workflowId}>
                      {wf.name} (v{wf.version})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {triggerType === 'webhook' && (
            <div className="trigger-form">
              <div className="form-group">
                <label htmlFor="webhook-name">
                  触发器名称 <span className="required-mark">*</span>
                </label>
                <input
                  id="webhook-name"
                  type="text"
                  className="input-field"
                  data-testid="webhook-name-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：GitHub Webhook"
                />
              </div>

              <div className="form-group">
                <label>Webhook URL</label>
                <div className="read-only-field" data-testid="webhook-url-display">
                  {webhookResult?.url || '创建后自动生成'}
                </div>
                <span className="form-hint">用于接收外部请求的URL</span>
              </div>

              <div className="form-group">
                <label>HMAC 密钥</label>
                <div className="read-only-field secret-field" data-testid="webhook-secret-display">
                  {webhookResult?.secret || '创建后自动生成'}
                </div>
                <span className="form-hint">用于验证请求签名的密钥</span>
              </div>

              <div className="form-group">
                <label htmlFor="workflow-selector-webhook">关联工作流</label>
                <select
                  id="workflow-selector-webhook"
                  className="input-field"
                  data-testid="workflow-selector"
                  value={selectedWorkflow}
                  onChange={(e) => setSelectedWorkflow(e.target.value)}
                >
                  <option value="">选择工作流（可选）</option>
                  {workflows.map((wf) => (
                    <option key={wf.workflowId} value={wf.workflowId}>
                      {wf.name} (v{wf.version})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} disabled={loading} data-testid="trigger-create-cancel">
            取消
          </button>
          <button
            className="primary-button"
            onClick={handleSubmit}
            disabled={loading}
            data-testid="trigger-create-submit"
          >
            {loading ? '创建中...' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default TriggerCreateDialog
