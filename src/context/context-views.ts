import type {
  ForegroundConversationContextView,
  PlannerRunContextView,
  PlanContextView,
  WorkflowStepContextView,
  BackgroundRunContextView,
  TriggerContextView,
  ExecutionPlan,
  WorkflowStepType,
  TriggerSource,
  TriggerTargetType,
  RuntimeTriggerEvent,
  AgentType,
} from './types.js'

export type {
  ForegroundConversationContextView,
  PlannerRunContextView,
  PlanContextView,
  WorkflowStepContextView,
  BackgroundRunContextView,
  TriggerContextView,
}

export function createForegroundConversationContextView(
  sessionId: string,
  userId: string,
  options: {
    assistantPersona?: ForegroundConversationContextView['assistantPersona']
    sessionMemory?: ForegroundConversationContextView['sessionMemory']
    activeWork?: ForegroundConversationContextView['activeWork']
    pendingApproval?: ForegroundConversationContextView['pendingApproval']
    recentUserVisibleTurns?: ForegroundConversationContextView['recentUserVisibleTurns']
    directDelegationPolicy?: ForegroundConversationContextView['directDelegationPolicy']
  } = {},
): ForegroundConversationContextView {
  return {
    sessionId,
    userId,
    ...options,
  }
}

export function createPlannerRunContextView(
  plannerRunId: string,
  plannerTemplateId: string,
  planId: string,
  objective: string,
  options: {
    planContextView?: PlannerRunContextView['planContextView']
    constraints?: string[]
    availableAgentProfiles?: string[]
    availableToolProfiles?: string[]
    priorStepSummaries?: PlannerRunContextView['priorStepSummaries']
    boundRefs?: PlannerRunContextView['boundRefs']
  } = {},
): PlannerRunContextView {
  return {
    plannerRunId,
    plannerTemplateId,
    planId,
    objective,
    ...options,
  }
}

export function createPlanContextView(
  planId: string,
  version: number,
  objective: string,
  options: {
    currentStep?: PlanContextView['currentStep']
    completedSummary?: string[]
    blockedItems?: string[]
    nextCandidateActions?: string[]
    todoSummary?: PlanContextView['todoSummary']
  } = {},
): PlanContextView {
  return {
    planId,
    version,
    objective,
    ...options,
  }
}

export function createWorkflowStepContextView(
  workflowId: string,
  workflowRunId: string,
  stepId: string,
  stepRunId: string,
  stepTitle: string,
  stepType: WorkflowStepType,
  options: {
    workflowName?: string
    inputSummary?: string
    requiredOutput?: Record<string, unknown>
    previousStepSummaries?: WorkflowStepContextView['previousStepSummaries']
    workflowConstraints?: string[]
    permissionMode?: string
  } = {},
): WorkflowStepContextView {
  return {
    workflowId,
    workflowRunId,
    stepId,
    stepRunId,
    stepTitle,
    stepType,
    ...options,
  }
}

export function createBackgroundRunContextView(
  backgroundRunId: string,
  subagentRunId: string,
  subagentCode: string,
  agentType: AgentType,
  objective: string,
  status: string,
  options: {
    progressSummary?: string
    artifactRefs?: string[]
    pendingApprovalId?: string
    lastCheckpointRef?: string
  } = {},
): BackgroundRunContextView {
  return {
    backgroundRunId,
    subagentRunId,
    subagentCode,
    agentType,
    objective,
    status,
    ...options,
  }
}

export function createTriggerContextView(
  eventId: string,
  eventType: string,
  source: TriggerSource,
  options: {
    triggerId?: string
    payloadSummary?: string
    target?: {
      targetType: TriggerTargetType
      targetRef?: string
    }
  } = {},
): TriggerContextView {
  return {
    eventId,
    eventType,
    source,
    ...options,
  }
}

export function executionPlanToContextView(plan: ExecutionPlan): PlanContextView {
  const currentStep = plan.steps.find((s) => s.status === 'in_progress')
  const completedSteps = plan.steps.filter((s) => s.status === 'completed')
  const blockedSteps = plan.steps.filter((s) => s.status === 'failed')

  return createPlanContextView(plan.planId, 1, plan.objective, {
    currentStep: currentStep
      ? {
          stepId: currentStep.stepId,
          title: currentStep.description.slice(0, 50),
          description: currentStep.description,
        }
      : undefined,
    completedSummary: completedSteps.map((s) => s.description),
    blockedItems: blockedSteps.map((s) => s.description),
  })
}

export function runtimeTriggerEventToContextView(
  event: RuntimeTriggerEvent,
  targetType: TriggerTargetType,
  targetRef?: string,
): TriggerContextView {
  return createTriggerContextView(event.eventId, event.eventType, event.source, {
    payloadSummary: event.payload ? JSON.stringify(event.payload).slice(0, 200) : undefined,
    target: {
      targetType,
      targetRef,
    },
  })
}
