import type { AdapterRegistry, RuntimeAdapter, RuntimeAction } from './types.js';
import type { ToolExecutor } from '../tools/types.js';
import type { PlannerRuntime } from '../planner/planner-runtime.js';
import type { WorkflowRuntime } from '../workflows/workflow-runtime.js';
import type { EventTriggerRuntime } from '../triggers/event-trigger-runtime.js';
import type { AgentKernel } from '../kernel/agent-kernel.js';
import type { PermissionGrantStore } from '../storage/permission-grant-store.js';
import type { PlannerResumeEvent } from '../planner/types.js';
import type { WaitConditionType, RegisterTriggerInput, RegisterWaitConditionInput } from '../triggers/types.js';
import type { KernelRunInput } from '../kernel/types.js';
import { createPermissionContext } from '../permissions/types.js';

/**
 * Registers the default runtime adapters for the dispatcher.
 * 
 * This function registers adapters for:
 * - tool_plane: Executes tools via ToolExecutor
 * - planner_runtime: Handles planner run operations
 * - workflow_runtime: Handles workflow run operations
 * - event_trigger_runtime: Handles trigger and wait condition registration
 * - agent_kernel: Runs agent kernel execution
 */
export function registerDefaultRuntimeAdapters(deps: {
  adapterRegistry: AdapterRegistry;
  toolExecutor: ToolExecutor;
  plannerRuntime: PlannerRuntime;
  workflowRuntime: WorkflowRuntime;
  triggerRuntime: EventTriggerRuntime;
  agentKernel: AgentKernel;
  permissionGrantStore: PermissionGrantStore;
}): void {
  const {
    adapterRegistry,
    toolExecutor,
    plannerRuntime,
    workflowRuntime,
    triggerRuntime,
    agentKernel,
    permissionGrantStore,
  } = deps;

  // Tool plane adapter - executes tools
  const toolPlaneAdapter: RuntimeAdapter = {
    async execute(action: RuntimeAction): Promise<unknown> {
      const payload = action.payload as {
        toolCallId?: string;
        toolName?: string;
        params?: unknown;
        userId?: string;
        sessionId?: string;
        kernelRunId?: string;
      };

      if (!payload.toolCallId || !payload.toolName || !payload.userId) {
        throw new Error('Tool plane action missing required fields: toolCallId, toolName, userId');
      }

      // Get user's permission grants
      const grants = permissionGrantStore.findByUser(payload.userId);

      // Construct permission context
      const permissionContext = createPermissionContext(
        payload.userId,
        payload.sessionId ?? '',
        'ask_on_write',
        grants
      );

      // Execute tool
      const result = await toolExecutor.execute({
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        params: payload.params,
        userId: payload.userId,
        sessionId: payload.sessionId,
        kernelRunId: payload.kernelRunId,
        permissionContext,
      });

      return result;
    },
  };

  // Planner runtime adapter - handles planner run operations
  const plannerRuntimeAdapter: RuntimeAdapter = {
    async execute(action: RuntimeAction): Promise<unknown> {
      const actionType = action.actionType;
      const payload = action.payload as Record<string, unknown>;

      switch (actionType) {
        case 'resume_planner_run': {
          const plannerRunId = payload.plannerRunId as string | undefined;
          const event = payload.event as PlannerResumeEvent | undefined;

          if (!plannerRunId) {
            throw new Error('resume_planner_run missing plannerRunId');
          }

          return plannerRuntime.resumePlannerRun(plannerRunId, event ?? { eventType: 'manual_resume', payload: {} });
        }

        case 'cancel_planner_run': {
          const plannerRunId = payload.plannerRunId as string | undefined;

          if (!plannerRunId) {
            throw new Error('cancel_planner_run missing plannerRunId');
          }

          plannerRuntime.cancelPlannerRun(plannerRunId);
          return { cancelled: true, plannerRunId };
        }

        default:
          throw new Error(`Unknown planner_runtime action type: ${actionType}`);
      }
    },
  };

  // Workflow runtime adapter - handles workflow run operations
  const workflowRuntimeAdapter: RuntimeAdapter = {
    async execute(action: RuntimeAction): Promise<unknown> {
      const actionType = action.actionType;
      const payload = action.payload as Record<string, unknown>;

      switch (actionType) {
        case 'start_workflow_run': {
          const definitionId = payload.definitionId as string | undefined;
          const userId = payload.userId as string | undefined;
          const sessionId = payload.sessionId as string | undefined;
          const inputData = payload.inputData as Record<string, unknown> | undefined;
          const triggerEventId = payload.triggerEventId as string | undefined;

          if (!definitionId || !userId) {
            throw new Error('start_workflow_run missing required fields: definitionId, userId');
          }

          return workflowRuntime.startWorkflowRun({
            definitionId,
            userId,
            sessionId,
            inputData,
            triggerEventId,
          });
        }

        default:
          throw new Error(`Unknown workflow_runtime action type: ${actionType}`);
      }
    },
  };

  // Event trigger runtime adapter - handles trigger and wait condition registration
  const eventTriggerRuntimeAdapter: RuntimeAdapter = {
    async execute(action: RuntimeAction): Promise<unknown> {
      const actionType = action.actionType;
      const payload = action.payload as Record<string, unknown>;

      switch (actionType) {
        case 'register_wait_condition': {
          const waitType = payload.waitType as WaitConditionType | undefined;
          const conditionPattern = payload.conditionPattern as string | undefined;
          const targetType = payload.targetType as string | undefined;
          const targetRef = payload.targetRef as string | undefined;
          const timeoutAt = payload.timeoutAt as string | undefined;
          const priority = payload.priority as number | undefined;
          const metadata = payload.metadata as Record<string, unknown> | undefined;

          if (!waitType || !conditionPattern || !targetType || !targetRef) {
            throw new Error('register_wait_condition missing required fields');
          }

          const input: RegisterWaitConditionInput = {
            waitType,
            conditionPattern,
            targetType,
            targetRef,
            timeoutAt,
            priority,
            metadata,
          };

          return triggerRuntime.registerWaitCondition(input);
        }

        case 'register_trigger': {
          const triggerType = payload.triggerType as string | undefined;
          const conditionType = payload.conditionType as string | undefined;
          const conditionPattern = payload.conditionPattern as string | undefined;
          const targetType = payload.targetType as string | undefined;
          const targetRef = payload.targetRef as string | undefined;
          const priority = payload.priority as number | undefined;
          const maxTriggers = payload.maxTriggers as number | undefined;
          const expiresAt = payload.expiresAt as string | undefined;
          const metadata = payload.metadata as Record<string, unknown> | undefined;

          if (!triggerType || !conditionType || !conditionPattern || !targetType || !targetRef) {
            throw new Error('register_trigger missing required fields');
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
          };

          return triggerRuntime.registerTrigger(input);
        }

        default:
          throw new Error(`Unknown event_trigger_runtime action type: ${actionType}`);
      }
    },
  };

  // Agent kernel adapter - runs agent kernel execution
  const agentKernelAdapter: RuntimeAdapter = {
    async execute(action: RuntimeAction): Promise<unknown> {
      const payload = action.payload as unknown as KernelRunInput;
      return agentKernel.run(payload);
    },
  };

  // Register all adapters
  adapterRegistry.register('tool_plane', toolPlaneAdapter);
  adapterRegistry.register('planner_runtime', plannerRuntimeAdapter);
  adapterRegistry.register('workflow_runtime', workflowRuntimeAdapter);
  adapterRegistry.register('event_trigger_runtime', eventTriggerRuntimeAdapter);
  adapterRegistry.register('agent_kernel', agentKernelAdapter);
}
