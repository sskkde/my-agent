import type { AdapterRegistry, RuntimeAdapter, RuntimeAction } from './types.js'
import type { ToolExecutor, ToolRegistry } from '../tools/types.js'
import { createToolOrchestrator, type ToolUse } from '../tools/runtime/tool-orchestrator.js'
import type { PlannerRuntime } from '../planner/planner-runtime.js'
import type { WorkflowRuntime } from '../workflows/workflow-runtime.js'
import type { EventTriggerRuntime } from '../triggers/event-trigger-runtime.js'
import type { AgentKernel } from '../kernel/agent-kernel.js'
import type { PermissionGrantStore } from '../storage/permission-grant-store.js'
import type { PlannerResumeEvent } from '../planner/types.js'
import type { WaitConditionType, RegisterTriggerInput, RegisterWaitConditionInput } from '../triggers/types.js'
import type { KernelRunInput } from '../kernel/types.js'
import type { BackgroundRuntime, BackgroundRunInput } from '../subagents/background-runtime.js'
import type { SubagentTaskSpec, SubagentRuntime, LaunchSubagentInput } from '../subagents/types.js'
import type { SubagentRegistry } from '../subagents/registry.js'
import type { ContextBundle } from '../context/types.js'
import { createPermissionContext } from '../permissions/types.js'

/**
 * Registers the default runtime adapters for the dispatcher.
 *
 * This function registers adapters for:
 * - tool_plane: Executes tools via ToolExecutor
 * - planner_runtime: Handles planner run operations
 * - workflow_runtime: Handles workflow run operations
 * - event_trigger_runtime: Handles trigger and wait condition registration
 * - agent_kernel: Runs agent kernel execution
 * - subagent_runtime: Handles background subagent operations
 */
export function registerDefaultRuntimeAdapters(deps: {
  adapterRegistry: AdapterRegistry
  toolExecutor: ToolExecutor
  toolRegistry?: ToolRegistry
  plannerRuntime: PlannerRuntime
  workflowRuntime: WorkflowRuntime
  triggerRuntime: EventTriggerRuntime
  agentKernel: AgentKernel
  permissionGrantStore: PermissionGrantStore
  backgroundRuntime: BackgroundRuntime
  subagentRuntime: SubagentRuntime
  subagentRegistry: SubagentRegistry
}): void {
  const {
    adapterRegistry,
    toolExecutor,
    toolRegistry,
    plannerRuntime,
    workflowRuntime,
    triggerRuntime,
    agentKernel,
    permissionGrantStore,
    backgroundRuntime,
    subagentRuntime,
    subagentRegistry,
  } = deps

  // Tool plane adapter - executes tools
  const toolPlaneAdapter: RuntimeAdapter = {
    async execute(action: RuntimeAction): Promise<unknown> {
      // Read userId/sessionId from action top-level (with fallback to payload for backward compatibility)
      const userId = action.userId ?? ((action.payload as Record<string, unknown>)?.userId as string | undefined)
      const sessionId =
        action.sessionId ?? ((action.payload as Record<string, unknown>)?.sessionId as string | undefined)

      const payload = action.payload as {
        toolCallId?: string
        toolName?: string
        toolUses?: Array<{
          toolCallId?: string
          toolName?: string
          params?: unknown
          kernelRunId?: string
          timeoutMs?: number
        }>
        params?: unknown
        kernelRunId?: string
      }

      if (payload.toolUses) {
        if (!userId) {
          throw new Error('Tool plane batch action missing required field: userId')
        }

        if (!toolRegistry) {
          throw new Error('Tool plane batch action requires toolRegistry')
        }

        const grants = permissionGrantStore.findByUser(userId)
        const permissionContext = createPermissionContext(userId, sessionId ?? '', 'ask_on_write', grants)
        const toolUses: ToolUse[] = payload.toolUses.map((toolUse) => {
          if (!toolUse.toolCallId || !toolUse.toolName) {
            throw new Error('Tool plane batch action missing required fields: toolCallId, toolName')
          }

          return {
            toolCallId: toolUse.toolCallId,
            toolName: toolUse.toolName,
            params: toolUse.params,
            userId,
            sessionId,
            kernelRunId: toolUse.kernelRunId ?? payload.kernelRunId,
            permissionContext,
            timeoutMs: toolUse.timeoutMs,
          }
        })

        const orchestrator = createToolOrchestrator({ executor: toolExecutor, registry: toolRegistry })
        return orchestrator.executeBatch(toolUses, { timeoutMs: action.policy?.timeoutMs })
      }

      if (!payload.toolCallId || !payload.toolName || !userId) {
        throw new Error('Tool plane action missing required fields: toolCallId, toolName, userId')
      }

      // Get user's permission grants
      const grants = permissionGrantStore.findByUser(userId)

      // Construct permission context
      const permissionContext = createPermissionContext(userId, sessionId ?? '', 'ask_on_write', grants)

      // Execute tool
      const result = await toolExecutor.execute({
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        params: payload.params,
        userId,
        sessionId,
        kernelRunId: payload.kernelRunId,
        permissionContext,
      })

      return result
    },
  }

  // Planner runtime adapter - handles planner run operations
  const plannerRuntimeAdapter: RuntimeAdapter = {
    async execute(action: RuntimeAction): Promise<unknown> {
      const actionType = action.actionType
      const payload = action.payload as Record<string, unknown>

      switch (actionType) {
        case 'resume_planner_run': {
          const plannerRunId = payload.plannerRunId as string | undefined
          const event = payload.event as PlannerResumeEvent | undefined

          if (!plannerRunId) {
            throw new Error('resume_planner_run missing plannerRunId')
          }

          return plannerRuntime.resumePlannerRun(plannerRunId, event ?? { eventType: 'manual_resume', payload: {} })
        }

        case 'cancel_planner_run': {
          const plannerRunId = payload.plannerRunId as string | undefined

          if (!plannerRunId) {
            throw new Error('cancel_planner_run missing plannerRunId')
          }

          plannerRuntime.cancelPlannerRun(plannerRunId)
          return { cancelled: true, plannerRunId }
        }

        default:
          throw new Error(`Unknown planner_runtime action type: ${actionType}`)
      }
    },
  }

  // Workflow runtime adapter - handles workflow run operations
  const workflowRuntimeAdapter: RuntimeAdapter = {
    async execute(action: RuntimeAction): Promise<unknown> {
      const actionType = action.actionType
      const payload = action.payload as Record<string, unknown>

      switch (actionType) {
        case 'start_workflow_run': {
          const definitionId = payload.definitionId as string | undefined
          const userId = payload.userId as string | undefined
          const sessionId = payload.sessionId as string | undefined
          const inputData = payload.inputData as Record<string, unknown> | undefined
          const triggerEventId = payload.triggerEventId as string | undefined

          if (!definitionId || !userId) {
            throw new Error('start_workflow_run missing required fields: definitionId, userId')
          }

          return workflowRuntime.startWorkflowRun({
            definitionId,
            userId,
            sessionId,
            inputData,
            triggerEventId,
          })
        }

        default:
          throw new Error(`Unknown workflow_runtime action type: ${actionType}`)
      }
    },
  }

  // Event trigger runtime adapter - handles trigger and wait condition registration
  const eventTriggerRuntimeAdapter: RuntimeAdapter = {
    async execute(action: RuntimeAction): Promise<unknown> {
      const actionType = action.actionType
      const payload = action.payload as Record<string, unknown>

      switch (actionType) {
        case 'register_wait_condition': {
          const waitType = payload.waitType as WaitConditionType | undefined
          const conditionPattern = payload.conditionPattern as string | undefined
          const targetType = payload.targetType as string | undefined
          const targetRef = payload.targetRef as string | undefined
          const timeoutAt = payload.timeoutAt as string | undefined
          const priority = payload.priority as number | undefined
          const metadata = payload.metadata as Record<string, unknown> | undefined

          if (!waitType || !conditionPattern || !targetType || !targetRef) {
            throw new Error('register_wait_condition missing required fields')
          }

          const input: RegisterWaitConditionInput = {
            waitType,
            conditionPattern,
            targetType,
            targetRef,
            timeoutAt,
            priority,
            metadata,
          }

          return triggerRuntime.registerWaitCondition(input)
        }

        case 'register_trigger': {
          const triggerType = payload.triggerType as string | undefined
          const conditionType = payload.conditionType as string | undefined
          const conditionPattern = payload.conditionPattern as string | undefined
          const targetType = payload.targetType as string | undefined
          const targetRef = payload.targetRef as string | undefined
          const priority = payload.priority as number | undefined
          const maxTriggers = payload.maxTriggers as number | undefined
          const expiresAt = payload.expiresAt as string | undefined
          const metadata = payload.metadata as Record<string, unknown> | undefined

          if (!triggerType || !conditionType || !conditionPattern || !targetType || !targetRef) {
            throw new Error('register_trigger missing required fields')
          }

          const input: RegisterTriggerInput = {
            triggerType,
            conditionType,
            conditionPattern,
            targetType,
            targetRef,
            priority,
            maxTriggers,
            expiresAt,
            metadata,
          }

          return triggerRuntime.registerTrigger(input)
        }

        default:
          throw new Error(`Unknown event_trigger_runtime action type: ${actionType}`)
      }
    },
  }

  // Agent kernel adapter - runs agent kernel execution
  const agentKernelAdapter: RuntimeAdapter = {
    async execute(action: RuntimeAction): Promise<unknown> {
      const payload = action.payload as unknown as KernelRunInput
      return agentKernel.run(payload)
    },
  }

  // Subagent runtime adapter - handles background subagent operations
  const subagentRuntimeAdapter: RuntimeAdapter = {
    async execute(action: RuntimeAction): Promise<unknown> {
      const actionType = action.actionType
      const payload = action.payload as Record<string, unknown>

      switch (actionType) {
        case 'launch_background_subagent': {
          const userId = action.userId ?? (payload.userId as string | undefined)
          const sessionId = action.sessionId ?? (payload.sessionId as string | undefined)
          const agentType = payload.agentType as string | undefined
          const taskSpec = payload.taskSpec as SubagentTaskSpec | undefined
          const launchSource = payload.launchSource as string | undefined
          const priority = payload.priority as number | undefined
          const scheduledAt = payload.scheduledAt as string | undefined
          const expiresAt = payload.expiresAt as string | undefined
          const artifactRefs = payload.artifactRefs as string[] | undefined

          if (!userId || !agentType || !taskSpec || !launchSource) {
            throw new Error(
              'launch_background_subagent missing required fields: userId, agentType, taskSpec, launchSource',
            )
          }

          const input: BackgroundRunInput = {
            userId,
            sessionId,
            agentType,
            taskSpec,
            launchSource,
            priority,
            scheduledAt,
            expiresAt,
            artifactRefs,
          }

          const backgroundRunId = backgroundRuntime.enqueueBackgroundRun(input)
          return { backgroundRunId, status: 'queued' }
        }

        case 'resume_background_subagent': {
          const backgroundRunId = payload.backgroundRunId as string | undefined

          if (!backgroundRunId) {
            throw new Error('resume_background_subagent missing backgroundRunId')
          }

          const run = backgroundRuntime.getBackgroundRun(backgroundRunId)
          if (!run) {
            throw new Error(`Background run not found: ${backgroundRunId}`)
          }

          if (run.status === 'queued') {
            await backgroundRuntime.startBackgroundRun(backgroundRunId)
            return { backgroundRunId, status: 'running' }
          }

          return { backgroundRunId, status: run.status }
        }

        case 'cancel_background_subagent': {
          const backgroundRunId = payload.backgroundRunId as string | undefined

          if (!backgroundRunId) {
            throw new Error('cancel_background_subagent missing backgroundRunId')
          }

          backgroundRuntime.cancelBackgroundRun(backgroundRunId)
          return { backgroundRunId, status: 'cancelled' }
        }

        case 'launch_subagent': {
          const agentType = payload.agentType as string | undefined
          const taskSpec = payload.taskSpec as SubagentTaskSpec | undefined
          const parentContext = payload.parentContext as ContextBundle | undefined
          const parentRunId = payload.parentRunId as string | undefined
          const rootRunId = payload.rootRunId as string | undefined

          if (!agentType || !taskSpec) {
            throw new Error('launch_subagent missing required fields: agentType, taskSpec')
          }

          if (!parentContext) {
            throw new Error('launch_subagent missing required field: parentContext')
          }

          const definition = subagentRegistry.assertAllowed(agentType)

          const launchInput: LaunchSubagentInput = {
            taskSpec: {
              ...taskSpec,
              agentType,
            },
            parentContext,
            parentRunId,
            rootRunId,
          }

          const run = subagentRuntime.launchSubagent(launchInput)
          const result = await subagentRuntime.executeSubagent(run.subagentRunId)

          return {
            subagentRunId: run.subagentRunId,
            agentType: definition.agentType,
            status: result.status,
            result,
          }
        }

        case 'resume_subagent': {
          const subagentRunId = payload.subagentRunId as string | undefined

          if (!subagentRunId) {
            throw new Error('resume_subagent missing subagentRunId')
          }

          const run = subagentRuntime.getSubagentRun(subagentRunId)
          if (!run) {
            throw new Error(`Subagent run not found: ${subagentRunId}`)
          }

          if (run.status === 'queued') {
            const result = await subagentRuntime.executeSubagent(subagentRunId)
            return {
              subagentRunId,
              agentType: run.taskSpec.agentType,
              status: result.status,
              result,
            }
          }

          return {
            subagentRunId,
            agentType: run.taskSpec.agentType,
            status: run.status,
            result: run.result,
          }
        }

        case 'cancel_subagent': {
          const subagentRunId = payload.subagentRunId as string | undefined

          if (!subagentRunId) {
            throw new Error('cancel_subagent missing subagentRunId')
          }

          const result = subagentRuntime.cancelSubagent(subagentRunId)
          return {
            subagentRunId,
            status: result.status,
            result,
          }
        }

        default:
          throw new Error(`Unknown subagent_runtime action type: ${actionType}`)
      }
    },
  }

  // Register all adapters
  adapterRegistry.register('tool_plane', toolPlaneAdapter)
  adapterRegistry.register('planner_runtime', plannerRuntimeAdapter)
  adapterRegistry.register('workflow_runtime', workflowRuntimeAdapter)
  adapterRegistry.register('event_trigger_runtime', eventTriggerRuntimeAdapter)
  adapterRegistry.register('agent_kernel', agentKernelAdapter)
  adapterRegistry.register('subagent_runtime', subagentRuntimeAdapter)
}
