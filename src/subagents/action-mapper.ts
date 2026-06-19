import type { RuntimeAction, RuntimeActionType, TargetRuntime } from '../dispatcher/types.js'
import type { RuntimeActionState, Source, TargetRef } from '../storage/runtime-action-store.js'
import type { SubagentTaskSpec } from './types.js'
import { generateId, ACTION_ID_PREFIX } from '../shared/ids.js'
import { normalizeAgentLabel, type NormalizedAgentLabel } from '../taxonomy/agent-label-normalizer.js'

export interface SourceRef {
  sourceType: 'foreground_turn' | 'workflow_step' | 'planner_run' | 'event_trigger'
  turnId?: string
  workflowRunId?: string
  workflowStepRunId?: string
  plannerRunId?: string
  eventId?: string
}

export interface LaunchSubagentPayload {
  /** Profile label (e.g. 'document_processor'), NOT a runtime boundary. See AgentType for lifecycle types. */
  agentType: string
  /** Capability profile identifier (e.g. 'document_processor'). Maps to AgentProfile.id in the taxonomy registry. */
  agentProfile: string
  taskSpec: SubagentTaskSpec
  parentContext?: unknown
  parentRunId?: string
  rootRunId?: string
  sourceRef?: SourceRef
}

export interface LaunchBackgroundSubagentPayload {
  /** Profile label (e.g. 'document_processor'), NOT a runtime boundary. See AgentType for lifecycle types. */
  agentType: string
  /** Capability profile identifier (e.g. 'document_processor'). Maps to AgentProfile.id in the taxonomy registry. */
  agentProfile: string
  taskSpec: SubagentTaskSpec
  launchSource: string
  priority?: number
  scheduledAt?: string
  expiresAt?: string
  sourceRef?: SourceRef
  artifactRefs?: string[]
}

const DEFAULT_INITIAL_STATUS: RuntimeActionState = 'created'

function buildSourceRefTargetRef(ref?: SourceRef): TargetRef {
  const targetRef: TargetRef = {}
  if (!ref) return targetRef

  switch (ref.sourceType) {
    case 'workflow_step':
      if (ref.workflowRunId) targetRef.workflowRunId = ref.workflowRunId
      if (ref.workflowStepRunId) targetRef.workflowStepRunId = ref.workflowStepRunId
      break
    case 'planner_run':
      if (ref.plannerRunId) targetRef.plannerRunId = ref.plannerRunId
      break
    case 'foreground_turn':
      // turnId is modelled via session context; no dedicated TargetRef field
      break
    case 'event_trigger':
      // eventId is stored in correlationId or causationId; no dedicated TargetRef field
      break
  }

  return targetRef
}

function buildSource(sourceRef?: SourceRef): Source {
  if (sourceRef?.sourceType === 'workflow_step') {
    return {
      sourceModule: 'subagent-action-mapper',
      sourceAction: 'workflow_step_launch',
    }
  }
  if (sourceRef?.sourceType === 'planner_run') {
    return {
      sourceModule: 'subagent-action-mapper',
      sourceAction: 'planner_launch',
    }
  }
  if (sourceRef?.sourceType === 'event_trigger') {
    return {
      sourceModule: 'subagent-action-mapper',
      sourceAction: 'event_triggered_launch',
    }
  }
  return {
    sourceModule: 'subagent-action-mapper',
    sourceAction: 'foreground_launch',
  }
}

function buildCorrelationId(sourceRef?: SourceRef): string | undefined {
  if (sourceRef?.sourceType === 'event_trigger' && sourceRef.eventId) {
    return sourceRef.eventId
  }
  return undefined
}

function nowISO(): string {
  return new Date().toISOString()
}

/**
 * Build a RuntimeAction for a synchronous (foreground) subagent launch.
 *
 * All action creation is server-side: the `source` and `targetRef` are
 * derived deterministically from the supplied `SourceRef`, never from LLM
 * suggestions.
 */
export function buildLaunchSubagentAction(input: {
  agentType: string
  agentProfile: string
  taskSpec: SubagentTaskSpec
  userId: string
  sessionId?: string
  sourceRef?: SourceRef
}): RuntimeAction {
  const actionId = generateId(ACTION_ID_PREFIX)
  const now = nowISO()

  const payload: LaunchSubagentPayload = {
    agentType: input.agentType,
    agentProfile: input.agentProfile,
    taskSpec: input.taskSpec,
    sourceRef: input.sourceRef,
  }

  const action: RuntimeAction = {
    actionId,
    actionType: 'launch_subagent' as RuntimeActionType,
    targetRuntime: 'subagent_runtime' as TargetRuntime,
    targetAction: 'launch',
    source: buildSource(input.sourceRef),
    userId: input.userId,
    sessionId: input.sessionId,
    targetRef: buildSourceRefTargetRef(input.sourceRef),
    payload: payload as unknown as Record<string, unknown>,
    correlationId: buildCorrelationId(input.sourceRef),
    createdAt: now,
    updatedAt: now,
    status: DEFAULT_INITIAL_STATUS,
  }

  return action
}

/**
 * Build a RuntimeAction for an asynchronous (background) subagent launch.
 *
 * All action creation is server-side: the `source` and `targetRef` are
 * derived deterministically from the supplied `SourceRef`, never from LLM
 * suggestions.
 */
export function buildLaunchBackgroundSubagentAction(input: {
  agentType: string
  agentProfile: string
  taskSpec: SubagentTaskSpec
  userId: string
  sessionId?: string
  launchSource: string
  priority?: number
  sourceRef?: SourceRef
}): RuntimeAction {
  const actionId = generateId(ACTION_ID_PREFIX)
  const now = nowISO()

  const payload: LaunchBackgroundSubagentPayload = {
    agentType: input.agentType,
    agentProfile: input.agentProfile,
    taskSpec: input.taskSpec,
    launchSource: input.launchSource,
    priority: input.priority,
    sourceRef: input.sourceRef,
  }

  const action: RuntimeAction = {
    actionId,
    actionType: 'launch_background_subagent' as RuntimeActionType,
    targetRuntime: 'subagent_runtime' as TargetRuntime,
    targetAction: 'launch_background',
    source: buildSource(input.sourceRef),
    userId: input.userId,
    sessionId: input.sessionId,
    targetRef: buildSourceRefTargetRef(input.sourceRef),
    payload: payload as unknown as Record<string, unknown>,
    correlationId: buildCorrelationId(input.sourceRef),
    createdAt: now,
    updatedAt: now,
    status: DEFAULT_INITIAL_STATUS,
  }

  return action
}

type KeywordRule = {
  keywords: string[]
  agentType: string
}

const INFERENCE_RULES: KeywordRule[] = [
  {
    keywords: ['pdf', 'word', '文档', '总结', '改写'],
    agentType: 'document_processor',
  },
  {
    keywords: ['图片', '截图', '识别', 'ocr', '图像'],
    agentType: 'image_processor',
  },
  {
    keywords: ['csv', 'excel', '表格', '数据', '统计'],
    agentType: 'data_processor',
  },
  {
    keywords: ['音频', '录音', '会议', '转写'],
    agentType: 'audio_processor',
  },
  {
    keywords: ['代码', 'bug', 'repo', 'typescript', 'python'],
    agentType: 'code_processor',
  },
  {
    keywords: ['调研', '搜索', '资料', '最新'],
    agentType: 'research_processor',
  },
]

const FALLBACK_AGENT_TYPE = 'research_processor'

/**
 * Infer which subagent type should handle a given message.
 *
 * Matching is purely server-side keyword matching — no LLM involvement.
 * Rules are evaluated in declaration order; the first match wins.
 * Returns `'research_processor'` normalized label when no keyword matches.
 */
export function inferSubagentType(input: {
  message: string
  suggestedTools?: string[]
  metadata?: Record<string, unknown>
}): NormalizedAgentLabel {
  const normalized = input.message.toLowerCase()

  for (const rule of INFERENCE_RULES) {
    for (const keyword of rule.keywords) {
      if (normalized.includes(keyword.toLowerCase())) {
        return normalizeAgentLabel(rule.agentType)
      }
    }
  }

  return normalizeAgentLabel(FALLBACK_AGENT_TYPE)
}

/**
 * Map a workflow step payload into a {@link LaunchSubagentPayload} suitable
 * for use with {@link buildLaunchSubagentAction}.
 *
 * The `stepConfig` should contain the task description and, optionally, an
 * explicit `agentType`.  If `agentType` is not provided it is inferred from
 * the step config's `description` and any `inputData` fields.
 */
export function mapWorkflowStepPayloadToLaunchSubagentPayload(payload: {
  stepRunId: string
  stepConfig: Record<string, unknown>
  inputData?: Record<string, unknown>
  workflowRunId?: string
}): LaunchSubagentPayload {
  const { stepRunId, stepConfig, inputData, workflowRunId } = payload

  const explicitAgentType =
    typeof stepConfig.agentType === 'string' && stepConfig.agentType.length > 0 ? stepConfig.agentType : undefined

  const description = typeof stepConfig.description === 'string' ? stepConfig.description : ''
  const inputStr = inputData ? JSON.stringify(inputData) : ''
  const inferred = inferSubagentType({ message: `${description} ${inputStr}` })

  const agentProfile = explicitAgentType ?? inferred.agentProfile
  const agentType = explicitAgentType ?? inferred.agentType

  const taskSpec: SubagentTaskSpec = {
    objective: description || String(stepConfig.description ?? ''),
    tools: Array.isArray(stepConfig.tools) ? (stepConfig.tools as string[]) : undefined,
    maxIterations: typeof stepConfig.maxIterations === 'number' ? stepConfig.maxIterations : undefined,
    timeoutMs: typeof stepConfig.timeoutMs === 'number' ? stepConfig.timeoutMs : undefined,
    agentType: agentProfile,
  }

  const sourceRef: SourceRef = {
    sourceType: 'workflow_step',
    workflowStepRunId: stepRunId,
    workflowRunId,
  }

  return {
    agentType,
    agentProfile,
    taskSpec,
    sourceRef,
  }
}
