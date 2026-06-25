// Context Manager Types
// Based on context_manager_responsibilities_io_and_summaries_v2_runtime_aligned.md

import type { AssistantPersonaProfile as _AssistantPersonaProfile } from '../foreground/types.js'

/** Re-export canonical AssistantPersonaProfile from foreground/types.ts */
export type AssistantPersonaProfile = _AssistantPersonaProfile

export type SourceType =
  | 'session_history'
  | 'conversation_state'
  | 'plan_state'
  | 'workflow_state'
  | 'background_run_state'
  | 'trigger_state'
  | 'approval_state'
  | 'memory'
  | 'tool_result'
  | 'subagent_result'
  | 'artifact'
  | 'attachment'
  | 'system_note'

export type SemanticType =
  | 'instruction'
  | 'fact'
  | 'constraint'
  | 'draft'
  | 'summary'
  | 'entity_state'
  | 'search_finding'
  | 'tool_output'
  | 'attachment_ref'
  | 'plan_view'
  | 'workflow_step_view'
  | 'background_run_view'
  | 'trigger_event'

export type RelatedRefs = {
  planId?: string
  planStepId?: string
  workflowId?: string
  workflowRunId?: string
  workflowStepId?: string
  backgroundRunId?: string
  subagentRunId?: string
  approvalId?: string
  artifactId?: string
  triggerId?: string
}

export type ContextItem = {
  itemId: string
  sourceType: SourceType
  sourceRef?: string
  semanticType: SemanticType
  content: string
  structuredPayload?: Record<string, unknown>
  relatedRefs?: RelatedRefs
  priority?: number
  recencyScore?: number
  relevanceScore?: number
  authorityScore?: number
  estimatedTokens?: number
  dedupeKey?: string
  freshnessTs?: string
  isPinned?: boolean
  isCompressible?: boolean
  isReplaceableByRef?: boolean
  requiresPairIntegrity?: boolean
  pairId?: string
  validUntil?: string
  supersedesKey?: string
}

export type AgentType = 'main' | 'subagent' | 'background' | 'workflow_step' | 'remote'

export type InvocationSource =
  | 'gateway_intent'
  | 'planner_execution'
  | 'workflow_step'
  | 'subagent_runtime'
  | 'background_subagent'
  | 'event_trigger_resume'
  | 'system'

export type TargetMode = 'interactive' | 'plan' | 'execute' | 'workflow_step' | 'background' | 'recovery'

export type HydratedSessionState = {
  sessionId: string
  userId: string
  conversationHistory?: ContextItem[]
  sessionMemory?: ContextItem
}

export type ConversationStateProjection = {
  sessionId: string
  recentTurns?: Array<{
    turnId: string
    role: 'user' | 'assistant'
    summary: string
  }>
  activeWork?: ActiveWorkProjection
}

export type ActiveWorkProjection = {
  activePlans?: Array<{ planId: string; status: string }>
  activeWorkflowRuns?: Array<{ workflowRunId: string; status: string }>
  activeBackgroundRuns?: Array<{ backgroundRunId: string; status: string }>
  pendingApprovals?: Array<{ approvalId: string; actionSummary: string }>
}

export type ExecutionPlan = {
  planId: string
  objective: string
  status: string
  steps: Array<{
    stepId: string
    description: string
    status: string
  }>
}

export type PlanContextView = {
  planId: string
  version: number
  objective: string
  currentStep?: {
    stepId: string
    title: string
    description?: string
    owner?: string
    assignedAgentType?: string
  }
  completedSummary?: string[]
  blockedItems?: string[]
  nextCandidateActions?: string[]
  todoSummary?: Array<{
    todoListId: string
    ownerAgentType: string
    status: string
  }>
}

export type WorkflowStepType =
  | 'agent_run'
  | 'subagent_run'
  | 'tool_call'
  | 'approval'
  | 'wait'
  | 'condition'
  | 'notification'
  | 'branch'
  | 'parallel'

export type WorkflowStepContextView = {
  workflowId: string
  workflowRunId: string
  stepId: string
  stepRunId: string
  workflowName?: string
  stepTitle: string
  stepType: WorkflowStepType
  inputSummary?: string
  requiredOutput?: Record<string, unknown>
  previousStepSummaries?: Array<{
    stepId: string
    status: string
    outputRef?: string
    summary?: string
  }>
  workflowConstraints?: string[]
  permissionMode?: string
}

export type BackgroundRunContextView = {
  backgroundRunId: string
  subagentRunId: string
  subagentCode: string
  agentType: AgentType
  objective: string
  status: string
  progressSummary?: string
  artifactRefs?: string[]
  pendingApprovalId?: string
  lastCheckpointRef?: string
}

export type TriggerSource = 'scheduler' | 'gateway' | 'connector' | 'mcp' | 'webhook' | 'approval_center' | 'system'

export type TriggerTargetType =
  | 'start_workflow'
  | 'launch_background_subagent'
  | 'resume_background_subagent'
  | 'resume_kernel_run'
  | 'send_notification'

export type RuntimeTriggerEvent = {
  eventId: string
  eventType: string
  source: TriggerSource
  payload?: Record<string, unknown>
}

export type TriggerContextView = {
  triggerId?: string
  eventId: string
  eventType: string
  source: TriggerSource
  payloadSummary?: string
  target?: {
    targetType: TriggerTargetType
    targetRef?: string
  }
}

export type ForegroundConversationContextView = {
  sessionId: string
  userId: string
  assistantPersona?: AssistantPersonaProfile
  sessionMemory?: SessionMemoryForPlanner
  activeWork?: ActiveWorkProjection
  pendingApproval?: {
    approvalId: string
    actionSummary: string
    sourceRef: string
  }
  recentUserVisibleTurns?: Array<{
    turnId: string
    role: 'user' | 'assistant'
    summary: string
  }>
  directDelegationPolicy?: DirectDelegationPolicy
}

export type SessionMemoryForPlanner = {
  memoryId: string
  summary: string
  keyFacts?: string[]
}

export type DirectDelegationPolicy = {
  allowDirectToolCalls: boolean
  allowedToolCategories?: string[]
  requireConfirmationFor?: string[]
}

export type PlannerRunContextView = {
  plannerRunId: string
  plannerTemplateId: string
  planId: string
  objective: string
  planContextView?: PlanContextView
  constraints?: string[]
  availableAgentProfiles?: string[]
  availableToolProfiles?: string[]
  priorStepSummaries?: Array<{
    stepId: string
    status: string
    summary?: string
    outputRef?: string
  }>
  boundRefs?: {
    backgroundRunId?: string
    workflowRunId?: string
  }
}

export type WorkingContext = {
  currentPlanStep?: string
  currentWorkflowStep?: string
  currentBackgroundSubagentRun?: string
  recentToolResults?: string[]
  recentSubagentResults?: string[]
  currentPendingAction?: string
}

export type SelectionPolicy = {
  targetMode: TargetMode
  tokenBudget: number
  includeRecentHistoryTurns?: number
  sourceBudgets?: Record<string, number>
  agentView?: string
}

export type ContextAssemblyInput = {
  runId: string
  userId: string
  sessionId?: string
  agentId: string
  agentType: AgentType
  invocationSource: InvocationSource
  hydratedState?: HydratedSessionState
  conversationState?: ConversationStateProjection
  planContext?: {
    activePlan?: ExecutionPlan
    planContextView?: PlanContextView
  }
  workflowContext?: {
    workflowId?: string
    workflowRunId?: string
    stepId?: string
    stepRunId?: string
    workflowStepContextView?: WorkflowStepContextView
  }
  backgroundRunContext?: {
    backgroundRunId?: string
    subagentRunId?: string
    backgroundRunContextView?: BackgroundRunContextView
  }
  triggerContext?: {
    triggerId?: string
    triggerEvent?: RuntimeTriggerEvent
  }
  workingContext?: WorkingContext
  selectionPolicy: SelectionPolicy
}

export type ArtifactRef = {
  artifactRef: string
  artifactType: string
}

export type AttachmentRef = {
  fileRef: string
  mimeType: string
}

export type CompactHints = {
  shouldCompactSoon: boolean
  candidateItemIds?: string[]
  mustKeepItemIds?: string[]
}

export type ContextBundle = {
  bundleId: string
  runId: string
  agentId: string
  agentType: AgentType
  agentProfile?: string
  userId: string
  invocationSource: InvocationSource
  pinnedItems: ContextItem[]
  orderedItems: ContextItem[]
  summaryBlocks?: ContextItem[]
  planView?: PlanContextView
  workflowStepView?: WorkflowStepContextView
  backgroundRunView?: BackgroundRunContextView
  triggerView?: TriggerContextView
  artifactRefs?: ArtifactRef[]
  attachmentRefs?: AttachmentRef[]
  tokenEstimate: number
  compactHints?: CompactHints
  workDirRoot?: string
  workDirId?: string
}

export type RuntimeContextDelta = {
  runId: string
  iteration?: number
  source:
    | 'tool_result'
    | 'subagent_result'
    | 'workflow_step_result'
    | 'trigger_event'
    | 'approval_result'
    | 'runtime_note'
    | 'plan_state'
  items: ContextItem[]
  replaceKeys?: string[]
}

export type ContextSelectionReport = {
  bundleId: string
  runId: string
  totalItemsConsidered: number
  itemsNormalized: number
  itemsFiltered: number
  itemsDeduped: number
  itemsScored: number
  itemsSelected: number
  pinnedItems: number
  tokenBudget: number
  tokenEstimate: number
  budgetExceeded: boolean
  pairIntegrityPreserved: string[] // List of pairIds that were kept together
  viewType: string
  timestamp: string
}

// Pipeline stage types
export type NormalizedItem = ContextItem & {
  normalizedAt: string
}

export type ScoredItem = ContextItem & {
  finalScore: number
  scoreComponents: {
    priorityScore: number
    recencyScore: number
    relevanceScore: number
    authorityScore: number
  }
}

export type PipelineContext = {
  input: ContextAssemblyInput
  items: ContextItem[]
  normalizedItems: NormalizedItem[]
  filteredItems: ContextItem[]
  dedupedItems: ContextItem[]
  scoredItems: ScoredItem[]
  selectedItems: ContextItem[]
  pairGroups: Map<string, ContextItem[]> // pairId -> items in pair
  report: Partial<ContextSelectionReport>
}
