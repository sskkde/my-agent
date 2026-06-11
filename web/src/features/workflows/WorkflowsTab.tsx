import React, { useCallback, useEffect, useState } from 'react'
import * as client from '../../api/client'
import type {
  WorkflowDraftResponse,
  WorkflowDefinitionResponse,
  WorkflowRunResponse,
  WorkflowStep,
  WorkflowStepType,
  WorkflowValidationIssue,
} from '../../api/types'

const SUPPORTED_STEP_TYPES: WorkflowStepType[] = ['tool_call', 'agent_run', 'subagent_run', 'approval', 'wait']

const STEP_TYPE_LABELS: Record<WorkflowStepType, string> = {
  tool_call: '工具调用',
  agent_run: '代理运行',
  subagent_run: '子代理运行',
  approval: '审批',
  wait: '等待',
}

const DRAFT_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  validating: '验证中',
  invalid: '无效',
  published: '已发布',
}

const RUN_STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  queued: '已排队',
  running: '运行中',
  waiting_for_user: '等待用户',
  waiting_for_approval: '等待审批',
  waiting_for_external_event: '等待外部事件',
  sleeping: '休眠中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  timeout: '已超时',
}

const VALIDATION_ISSUE_LABELS: Record<string, string> = {
  MISSING_NAME: '缺少工作流名称',
  NO_STEPS: '缺少步骤',
  MISSING_STEP_NAME: '缺少步骤名称',
  MISSING_TOOL_NAME: '缺少工具名称',
}

function localizeStepType(stepType: string): string {
  return STEP_TYPE_LABELS[stepType as WorkflowStepType] ?? '未知步骤类型'
}

function localizeDraftStatus(status: string): string {
  return DRAFT_STATUS_LABELS[status] ?? '未知状态'
}

function localizeRunStatus(status: string): string {
  return RUN_STATUS_LABELS[status] ?? '未知状态'
}

function localizeValidationIssueCode(code: string): string {
  return VALIDATION_ISSUE_LABELS[code] ?? '校验问题'
}

function createEmptyStep(index: number): WorkflowStep {
  return {
    stepId: `step-${Date.now()}-${index}`,
    stepType: 'tool_call',
    name: '',
    description: '',
    config: {},
  }
}

function computeNextStepIds(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map((step, i) => ({
    ...step,
    nextStepId: i < steps.length - 1 ? steps[i + 1].stepId : undefined,
  }))
}

const WorkflowsTab: React.FC = () => {
  const [drafts, setDrafts] = useState<WorkflowDraftResponse[]>([])
  const [definitions, setDefinitions] = useState<WorkflowDefinitionResponse[]>([])
  const [activeDraft, setActiveDraft] = useState<WorkflowDraftResponse | null>(null)
  const [workflowName, setWorkflowName] = useState('')
  const [workflowDescription, setWorkflowDescription] = useState('')
  const [steps, setSteps] = useState<WorkflowStep[]>(() => [createEmptyStep(0)])
  const [validationIssues, setValidationIssues] = useState<WorkflowValidationIssue[]>([])
  const [validated, setValidated] = useState(false)
  const [publishedDefinition, setPublishedDefinition] = useState<WorkflowDefinitionResponse | null>(null)
  const [runResult, setRunResult] = useState<WorkflowRunResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDrafts = useCallback(async () => {
    try {
      const data = await client.listWorkflowDrafts()
      setDrafts(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载草稿失败')
    }
  }, [])

  const loadDefinitions = useCallback(async () => {
    try {
      const data = await client.listWorkflowDefinitions()
      setDefinitions(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载定义失败')
    }
  }, [])

  useEffect(() => {
    loadDrafts()
    loadDefinitions()
  }, [loadDrafts, loadDefinitions])

  const handleNewDraft = () => {
    setActiveDraft(null)
    setWorkflowName('')
    setWorkflowDescription('')
    setSteps([createEmptyStep(0)])
    setValidationIssues([])
    setValidated(false)
    setPublishedDefinition(null)
    setRunResult(null)
    setError(null)
  }

  const handleSelectDraft = (draft: WorkflowDraftResponse) => {
    setActiveDraft(draft)
    setWorkflowName(draft.name)
    setWorkflowDescription(draft.description ?? '')
    setSteps(draft.steps.length > 0 ? [...draft.steps] : [createEmptyStep(0)])
    setValidationIssues(draft.validationIssues)
    setValidated(false)
    setPublishedDefinition(null)
    setRunResult(null)
    setError(null)
  }

  const handleAddStep = () => {
    setSteps((prev) => [...prev, createEmptyStep(prev.length)])
    setValidated(false)
    setPublishedDefinition(null)
    setRunResult(null)
  }

  const handleRemoveStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index))
    setValidated(false)
    setPublishedDefinition(null)
    setRunResult(null)
  }

  const handleStepChange = (index: number, field: keyof WorkflowStep, value: string) => {
    setSteps((prev) =>
      prev.map((step, i) => {
        if (i !== index) return step
        if (field === 'config') return step
        return { ...step, [field]: value }
      }),
    )
    setValidated(false)
    setPublishedDefinition(null)
    setRunResult(null)
  }

  const handleStepConfigChange = (index: number, configField: string, value: string) => {
    setSteps((prev) =>
      prev.map((step, i) => {
        if (i !== index) return step
        return {
          ...step,
          config: { ...step.config, [configField]: value || undefined },
        }
      }),
    )
    setValidated(false)
    setPublishedDefinition(null)
    setRunResult(null)
  }

  const handleStepRequiresApprovalChange = (index: number, checked: boolean) => {
    setSteps((prev) =>
      prev.map((step, i) => {
        if (i !== index) return step
        return { ...step, requiresApproval: checked }
      }),
    )
    setValidated(false)
    setPublishedDefinition(null)
    setRunResult(null)
  }

  const handleMoveStep = (index: number, direction: 'up' | 'down') => {
    setSteps((prev) => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
      return next
    })
    setValidated(false)
    setPublishedDefinition(null)
    setRunResult(null)
  }

  const handleSaveDraft = async () => {
    setLoading(true)
    setError(null)
    try {
      const orderedSteps = computeNextStepIds(steps)
      if (activeDraft) {
        const updated = await client.updateWorkflowDraft(activeDraft.draftId, {
          name: workflowName,
          description: workflowDescription || undefined,
          steps: orderedSteps,
        })
        setActiveDraft(updated)
        setSteps([...updated.steps])
      } else {
        const created = await client.createWorkflowDraft({
          name: workflowName,
          description: workflowDescription || undefined,
          steps: orderedSteps,
        })
        setActiveDraft(created)
        setSteps([...created.steps])
      }
      await loadDrafts()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setLoading(false)
    }
  }

  const handleValidate = async () => {
    if (!activeDraft) {
      const issues: WorkflowValidationIssue[] = []
      if (!workflowName.trim()) {
        issues.push({ code: 'MISSING_NAME', message: '工作流名称不能为空', severity: 'error' })
      }
      if (steps.length === 0) {
        issues.push({ code: 'NO_STEPS', message: '至少需要一个步骤', severity: 'error' })
      }
      for (let i = 0; i < steps.length; i++) {
        if (!steps[i].name.trim()) {
          issues.push({
            code: 'MISSING_STEP_NAME',
            message: `步骤 ${i + 1} 名称不能为空`,
            stepId: steps[i].stepId,
            severity: 'error',
          })
        }
        if (steps[i].stepType === 'tool_call' && !steps[i].config.toolName) {
          issues.push({
            code: 'MISSING_TOOL_NAME',
            message: `步骤 ${i + 1} (工具调用) 缺少工具名称`,
            stepId: steps[i].stepId,
            severity: 'error',
          })
        }
      }
      setValidationIssues(issues)
      setValidated(true)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const orderedSteps = computeNextStepIds(steps)
      await client.updateWorkflowDraft(activeDraft.draftId, {
        name: workflowName,
        description: workflowDescription || undefined,
        steps: orderedSteps,
      })
      const result = await client.validateWorkflowDraft(activeDraft.draftId)
      setValidationIssues(result.issues)
      setValidated(true)
      const refreshed = await client.getWorkflowDraft(activeDraft.draftId)
      setActiveDraft(refreshed)
      setSteps([...refreshed.steps])
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证失败')
    } finally {
      setLoading(false)
    }
  }

  const handlePublish = async () => {
    if (!activeDraft) return
    if (!validated) {
      setError('请先验证工作流后再发布')
      return
    }
    if (validationIssues.some((i) => i.severity === 'error')) {
      setError('存在验证错误，请先修复后再发布')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const def = await client.publishWorkflowDraft(activeDraft.draftId)
      setPublishedDefinition(def)
      await loadDefinitions()
      await loadDrafts()
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布失败')
    } finally {
      setLoading(false)
    }
  }

  const handleRun = async () => {
    const defId = publishedDefinition?.workflowId
    if (!defId) return
    setLoading(true)
    setError(null)
    try {
      const result = await client.startWorkflowRun(defId)
      setRunResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动运行失败')
    } finally {
      setLoading(false)
    }
  }

  const hasErrors = validationIssues.some((i) => i.severity === 'error')
  const canPublish = activeDraft && validated && !hasErrors

  return (
    <div data-testid="workflows-panel" className="workflows-panel">
      <section className="workflows-sidebar">
        <div className="workflows-sidebar-header">
          <h4>工作流列表</h4>
          <button className="primary-button" onClick={handleNewDraft} data-testid="workflow-new-draft">
            新建
          </button>
        </div>
        <div className="workflows-draft-list">
          {drafts.length === 0 && <p className="empty-state">暂无草稿</p>}
          {drafts.map((d) => (
            <button
              key={d.draftId}
              className={`workflows-draft-item ${activeDraft?.draftId === d.draftId ? 'active' : ''}`}
              onClick={() => handleSelectDraft(d)}
              data-testid={`workflow-draft-${d.draftId}`}
            >
              <span className="draft-name">{d.name}</span>
              <span className="draft-status">{localizeDraftStatus(d.status)}</span>
            </button>
          ))}
        </div>
        {definitions.length > 0 && (
          <>
            <div className="workflows-sidebar-divider" />
            <div className="workflows-sidebar-header">
              <h4>已发布</h4>
            </div>
            <div className="workflows-draft-list">
              {definitions.map((def) => (
                <div key={def.workflowId} className="workflows-definition-item">
                  <span className="draft-name">{def.name}</span>
                  <span className="draft-status">v{def.version}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="workflows-editor">
        <div className="workflows-editor-header">
          <h3>{activeDraft ? '编辑工作流' : '新建工作流'}</h3>
          <div className="workflows-editor-actions">
            <button
              className="secondary-button"
              onClick={handleSaveDraft}
              disabled={loading || !workflowName.trim()}
              data-testid="workflow-save"
            >
              {loading ? '保存中...' : '保存'}
            </button>
          </div>
        </div>

        {error && (
          <div className="workflows-error" data-testid="workflow-error">
            {error}
          </div>
        )}

        <div className="workflows-form">
          <div className="form-group">
            <label htmlFor="workflow-name">
              工作流名称 <span className="required-mark">*</span>
            </label>
            <input
              id="workflow-name"
              type="text"
              className="input-field"
              data-testid="workflow-name-input"
              value={workflowName}
              onChange={(e) => {
                setWorkflowName(e.target.value)
                setValidated(false)
                setPublishedDefinition(null)
                setRunResult(null)
              }}
              placeholder="输入工作流名称"
            />
          </div>

          <div className="form-group">
            <label htmlFor="workflow-desc">描述</label>
            <input
              id="workflow-desc"
              type="text"
              className="input-field"
              data-testid="workflow-description-input"
              value={workflowDescription}
              onChange={(e) => {
                setWorkflowDescription(e.target.value)
                setValidated(false)
                setPublishedDefinition(null)
                setRunResult(null)
              }}
              placeholder="可选描述"
            />
          </div>
        </div>

        <div className="workflows-steps-section">
          <div className="workflows-steps-header">
            <h4>步骤</h4>
            <button className="secondary-button" onClick={handleAddStep} data-testid="workflow-add-step">
              + 添加步骤
            </button>
          </div>

          {steps.length === 0 && (
            <p className="empty-state" data-testid="workflow-no-steps">
              暂无步骤，请添加
            </p>
          )}

          <div className="workflows-steps-list">
            {steps.map((step, index) => (
              <div key={step.stepId} className="workflows-step-card" data-testid={`workflow-step-${index}`}>
                <div className="workflows-step-header">
                  <span className="step-index">#{index + 1}</span>
                  <div className="step-reorder">
                    <button
                      className="step-reorder-btn"
                      onClick={() => handleMoveStep(index, 'up')}
                      disabled={index === 0}
                      data-testid={`workflow-step-up-${index}`}
                      aria-label="上移"
                    >
                      ↑
                    </button>
                    <button
                      className="step-reorder-btn"
                      onClick={() => handleMoveStep(index, 'down')}
                      disabled={index === steps.length - 1}
                      data-testid={`workflow-step-down-${index}`}
                      aria-label="下移"
                    >
                      ↓
                    </button>
                    <button
                      className="step-remove-btn"
                      onClick={() => handleRemoveStep(index)}
                      data-testid={`workflow-step-remove-${index}`}
                      aria-label="删除"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <div className="workflows-step-fields">
                  <div className="form-group">
                    <label>
                      步骤名称 <span className="required-mark">*</span>
                    </label>
                    <input
                      type="text"
                      className="input-field"
                      data-testid={`workflow-step-title-${index}`}
                      value={step.name}
                      onChange={(e) => handleStepChange(index, 'name', e.target.value)}
                      placeholder="步骤名称"
                    />
                  </div>

                  <div className="form-group">
                    <label>步骤类型</label>
                    <select
                      className="input-field"
                      data-testid={`workflow-step-type-${index}`}
                      value={step.stepType}
                      onChange={(e) => handleStepChange(index, 'stepType', e.target.value)}
                    >
                      {SUPPORTED_STEP_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {localizeStepType(t)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {step.stepType === 'tool_call' && (
                    <div className="form-group">
                      <label>工具名称</label>
                      <input
                        type="text"
                        className="input-field"
                        data-testid={`workflow-step-toolName-${index}`}
                        value={step.config.toolName ?? ''}
                        onChange={(e) => handleStepConfigChange(index, 'toolName', e.target.value)}
                        placeholder="例如: status.query"
                      />
                    </div>
                  )}

                  {step.stepType === 'subagent_run' && (
                    <div className="form-group">
                      <label>子代理类型</label>
                      <input
                        type="text"
                        className="input-field"
                        data-testid={`workflow-step-subagentType-${index}`}
                        value={step.config.subagentType ?? ''}
                        onChange={(e) => handleStepConfigChange(index, 'subagentType', e.target.value)}
                        placeholder="子代理类型"
                      />
                    </div>
                  )}

                  <div className="form-group">
                    <label>描述</label>
                    <input
                      type="text"
                      className="input-field"
                      data-testid={`workflow-step-description-${index}`}
                      value={step.description ?? ''}
                      onChange={(e) => handleStepChange(index, 'description', e.target.value)}
                      placeholder="可选描述"
                    />
                  </div>

                  {step.stepType !== 'approval' && (
                    <div className="form-group">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          data-testid={`workflow-step-requiresApproval-${index}`}
                          checked={step.requiresApproval ?? false}
                          onChange={(e) => handleStepRequiresApprovalChange(index, e.target.checked)}
                        />
                        需要审批
                      </label>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="workflows-actions">
          <button
            className="secondary-button"
            onClick={handleValidate}
            disabled={loading}
            data-testid="workflow-validate"
          >
            验证
          </button>
          <button
            className="primary-button"
            onClick={handlePublish}
            disabled={loading || !canPublish}
            data-testid="workflow-publish"
          >
            发布
          </button>
          {(publishedDefinition || (activeDraft && activeDraft.status === 'published')) && (
            <button className="primary-button" onClick={handleRun} disabled={loading} data-testid="workflow-run">
              运行
            </button>
          )}
        </div>

        {validationIssues.length > 0 && (
          <div className="workflows-validation-errors" data-testid="workflow-validation-errors">
            <h4>验证问题</h4>
            <ul>
              {validationIssues.map((issue, i) => (
                <li key={i} className={`validation-issue ${issue.severity}`}>
                  <span className="issue-code">[{localizeValidationIssueCode(issue.code)}]</span> {issue.message}
                  {issue.stepId && <span className="issue-step"> (步骤: {issue.stepId})</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {runResult && (
          <div className="workflows-run-result" data-testid="workflow-run-result">
            <h4>运行状态</h4>
            <div className="run-info">
              <div className="run-field">
                <span className="run-label">运行 ID:</span>
                <span className="run-value" data-testid="workflow-run-id">
                  {runResult.workflowRunId}
                </span>
              </div>
              <div className="run-field">
                <span className="run-label">状态:</span>
                <span className="run-value" data-testid="workflow-run-status">
                  {localizeRunStatus(runResult.status)}
                </span>
              </div>
              <div className="run-field">
                <span className="run-label">定义 ID:</span>
                <span className="run-value">{runResult.definitionId}</span>
              </div>
              {runResult.stepRuns.length > 0 && (
                <div className="run-steps">
                  <span className="run-label">步骤:</span>
                  {runResult.stepRuns.map((sr) => (
                    <div key={sr.stepRunId} className="run-step-item">
                      {sr.stepId}: {localizeRunStatus(sr.status)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

export default WorkflowsTab
