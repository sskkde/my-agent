import { describe, expect, it } from 'vitest'
import { registerDefaultRuntimeAdapters } from '../../../src/dispatcher/runtime-adapters.js'
import type { AdapterRegistry, RuntimeAdapter, RuntimeAction, TargetRuntime } from '../../../src/dispatcher/types.js'
import type { ToolExecutionRequest, ToolExecutionResult, ToolExecutor, ToolRegistry } from '../../../src/tools/types.js'
import type { PlannerRuntime } from '../../../src/planner/planner-runtime.js'

class MemoryAdapterRegistry implements AdapterRegistry {
  private readonly adapters = new Map<TargetRuntime, RuntimeAdapter>()

  register(runtimeType: TargetRuntime, adapter: RuntimeAdapter): void {
    this.adapters.set(runtimeType, adapter)
  }

  getAdapter(runtimeType: TargetRuntime): RuntimeAdapter | null {
    return this.adapters.get(runtimeType) ?? null
  }

  unregister(runtimeType: TargetRuntime): void {
    this.adapters.delete(runtimeType)
  }

  listAdapters(): TargetRuntime[] {
    return [...this.adapters.keys()]
  }
}

function makeRuntimeAction(payload: Record<string, unknown>): RuntimeAction {
  return {
    actionId: 'act-1',
    actionType: 'execute_tool',
    source: { sourceModule: 'test' },
    targetRuntime: 'tool_plane',
    targetAction: 'execute_tool',
    payload,
    sessionId: 'session-1',
    userId: 'user-1',
    status: 'created',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function registerToolPlaneAdapter(capturedRequests: ToolExecutionRequest[]): RuntimeAdapter {
  const adapterRegistry = new MemoryAdapterRegistry()
  const toolExecutor: ToolExecutor = {
    execute: async (request: ToolExecutionRequest): Promise<ToolExecutionResult> => {
      capturedRequests.push(request)
      return { success: true }
    },
  }
  const toolRegistry: ToolRegistry = {
    register: () => {},
    getTool: () => ({
      name: 'identity-tool',
      description: 'identity tool',
      category: 'read',
      sensitivity: 'low',
      schema: { type: 'object', properties: {} },
      handler: () => ({ success: true }),
    }),
    listTools: () => [],
    listToolsByCategory: () => [],
    unregister: () => false,
    hasTool: () => true,
  }

  registerDefaultRuntimeAdapters({
    adapterRegistry,
    toolExecutor,
    toolRegistry,
    plannerRuntime: {} as never,
    workflowRuntime: {} as never,
    triggerRuntime: {} as never,
    agentKernel: {} as never,
    permissionGrantStore: { findByUser: () => [] } as never,
    backgroundRuntime: {} as never,
    subagentRuntime: {} as never,
    subagentRegistry: {} as never,
  })

  const adapter = adapterRegistry.getAdapter('tool_plane')
  if (!adapter) {
    throw new Error('tool_plane adapter was not registered')
  }
  return adapter
}

describe('runtime tool adapter identity propagation', () => {
  it('passes top-level agent identity payload fields to single tool execution', async () => {
    const capturedRequests: ToolExecutionRequest[] = []
    const adapter = registerToolPlaneAdapter(capturedRequests)

    await adapter.execute(
      makeRuntimeAction({
        toolCallId: 'call-1',
        toolName: 'identity-tool',
        params: {},
        kernelRunId: 'run-1',
        agentType: 'subagent',
        agentId: 'subagent.run-1',
        agentProfile: 'code_processor',
        launchSource: 'subagent_runtime',
      }),
      { signal: new AbortController().signal, timeoutMs: 30_000 },
    )

    expect(capturedRequests).toHaveLength(1)
    expect(capturedRequests[0]?.agentType).toBe('subagent')
    expect(capturedRequests[0]?.agentId).toBe('subagent.run-1')
    expect(capturedRequests[0]?.agentProfile).toBe('code_processor')
    expect(capturedRequests[0]?.launchSource).toBe('subagent_runtime')
  })

  it('passes top-level identity to batched tool executions and allows per-tool override', async () => {
    const capturedRequests: ToolExecutionRequest[] = []
    const adapter = registerToolPlaneAdapter(capturedRequests)

    await adapter.execute(
      makeRuntimeAction({
        kernelRunId: 'run-1',
        agentType: 'subagent',
        agentId: 'subagent.batch',
        agentProfile: 'code_processor',
        launchSource: 'subagent_runtime',
        toolUses: [
          { toolCallId: 'call-1', toolName: 'identity-tool', params: {} },
          { toolCallId: 'call-2', toolName: 'identity-tool', params: {}, agentId: 'subagent.override' },
        ],
      }),
      { signal: new AbortController().signal, timeoutMs: 30_000 },
    )

    expect(capturedRequests).toHaveLength(2)
    expect(capturedRequests[0]?.agentId).toBe('subagent.batch')
    expect(capturedRequests[0]?.agentType).toBe('subagent')
    expect(capturedRequests[1]?.agentId).toBe('subagent.override')
    expect(capturedRequests[1]?.agentType).toBe('subagent')
  })
})

function makePlannerRuntimeAction(actionType: string, payload: Record<string, unknown>): RuntimeAction {
  return {
    actionId: 'act-planner-1',
    actionType: actionType as RuntimeAction['actionType'],
    source: { sourceModule: 'test' },
    targetRuntime: 'planner_runtime',
    targetAction: actionType,
    payload,
    sessionId: 'session-1',
    userId: 'user-1',
    status: 'created',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function createMockPlannerRuntime(
  paused: Array<{ plannerRunId: string; reason?: string }>,
  archived: string[],
): PlannerRuntime {
  const notImplemented = (): never => {
    throw new Error('not implemented')
  }

  return {
    createPlannerRun: notImplemented,
    resumePlannerRun: notImplemented,
    completePlannerRun: notImplemented,
    markStep: () => {},
    setPlanSteps: () => {},
    cancelPlannerRun: () => {},
    pausePlannerRun: (plannerRunId: string, reason?: string) => {
      paused.push({ plannerRunId, reason })
    },
    replan: () => {},
    archivePlannerRun: (plannerRunId: string) => {
      archived.push(plannerRunId)
    },
    transitionState: () => {},
    handleApprovalRejection: () => {},
    applyPlanPatch: () => {},
    addActiveExecutionRef: () => {},
    emitRuntimeAction: notImplemented,
    saveCheckpoint: () => {},
  }
}

function registerPlannerAdapter(plannerRuntime: PlannerRuntime): RuntimeAdapter {
  const adapterRegistry = new MemoryAdapterRegistry()

  registerDefaultRuntimeAdapters({
    adapterRegistry,
    toolExecutor: {} as never,
    plannerRuntime,
    workflowRuntime: {} as never,
    triggerRuntime: {} as never,
    agentKernel: {} as never,
    permissionGrantStore: {} as never,
    backgroundRuntime: {} as never,
    subagentRuntime: {} as never,
    subagentRegistry: {} as never,
  })

  const adapter = adapterRegistry.getAdapter('planner_runtime')
  if (!adapter) {
    throw new Error('planner_runtime adapter was not registered')
  }
  return adapter
}

describe('planner runtime adapter', () => {
  it('dispatches pause_planner_run to plannerRuntime.pausePlannerRun', async () => {
    const paused: Array<{ plannerRunId: string; reason?: string }> = []
    const archived: string[] = []
    const adapter = registerPlannerAdapter(createMockPlannerRuntime(paused, archived))

    const result = await adapter.execute(
      makePlannerRuntimeAction('pause_planner_run', { plannerRunId: 'pl_run_1', reason: 'user paused' }),
    )

    expect(paused).toEqual([{ plannerRunId: 'pl_run_1', reason: 'user paused' }])
    expect(archived).toHaveLength(0)
    expect(result).toEqual({ paused: true, plannerRunId: 'pl_run_1' })
  })

  it('dispatches pause_planner_run without reason when payload omits it', async () => {
    const paused: Array<{ plannerRunId: string; reason?: string }> = []
    const archived: string[] = []
    const adapter = registerPlannerAdapter(createMockPlannerRuntime(paused, archived))

    await adapter.execute(makePlannerRuntimeAction('pause_planner_run', { plannerRunId: 'pl_run_2' }))

    expect(paused).toEqual([{ plannerRunId: 'pl_run_2', reason: undefined }])
  })

  it('throws when pause_planner_run is missing plannerRunId', async () => {
    const paused: Array<{ plannerRunId: string; reason?: string }> = []
    const archived: string[] = []
    const adapter = registerPlannerAdapter(createMockPlannerRuntime(paused, archived))

    await expect(adapter.execute(makePlannerRuntimeAction('pause_planner_run', {}))).rejects.toThrow(
      'pause_planner_run missing plannerRunId',
    )
    expect(paused).toHaveLength(0)
  })

  it('dispatches archive_planner_run to plannerRuntime.archivePlannerRun', async () => {
    const paused: Array<{ plannerRunId: string; reason?: string }> = []
    const archived: string[] = []
    const adapter = registerPlannerAdapter(createMockPlannerRuntime(paused, archived))

    const result = await adapter.execute(makePlannerRuntimeAction('archive_planner_run', { plannerRunId: 'pl_run_3' }))

    expect(archived).toEqual(['pl_run_3'])
    expect(paused).toHaveLength(0)
    expect(result).toEqual({ archived: true, plannerRunId: 'pl_run_3' })
  })

  it('throws when archive_planner_run is missing plannerRunId', async () => {
    const paused: Array<{ plannerRunId: string; reason?: string }> = []
    const archived: string[] = []
    const adapter = registerPlannerAdapter(createMockPlannerRuntime(paused, archived))

    await expect(adapter.execute(makePlannerRuntimeAction('archive_planner_run', {}))).rejects.toThrow(
      'archive_planner_run missing plannerRunId',
    )
    expect(archived).toHaveLength(0)
  })
})
