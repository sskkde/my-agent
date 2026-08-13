/**
 * Foreground Runtime Handlers - integration tests for the wired foreground tool
 * handlers that close over `ForegroundToolRuntimeDeps`.
 *
 * Verifies:
 * 1. Wired handlers dispatch to real runtime deps (launch_subagent success).
 * 2. Missing sessionId short-circuits with SESSION_REQUIRED.
 * 3. Without runtimeDeps the placeholder returns FOREGROUND_TOOL_REQUIRES_KERNEL.
 * 4. The approval-response branch calls the approval store.
 * 5. The spawn-planner path returns plannerRunId from the planner runtime.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createToolRegistry } from '../../../../src/tools/tool-registry.js'
import type { ToolRegistry, ToolExecutionContext, ToolExecutionResult } from '../../../../src/tools/types.js'
import type { PermissionContext } from '../../../../src/permissions/types.js'
import {
  registerAllForegroundTools,
  LAUNCH_SUBAGENT_TOOL_ID,
  APPROVAL_REQUEST_TOOL_ID,
  SPAWN_PLANNER_TOOL_ID,
} from '../../../../src/foreground/tools/index.js'
import type { ForegroundToolRuntimeDeps } from '../../../../src/foreground/tools/foreground-tool-runtime.js'
import type { RuntimeDispatcher, DispatchResult } from '../../../../src/dispatcher/types.js'
import type { PlannerRuntime } from '../../../../src/planner/planner-runtime.js'
import type { PlannerRunResult } from '../../../../src/planner/types.js'
import type { PlannerRunStore } from '../../../../src/storage/planner-run-store.js'
import type { SubagentRunStore } from '../../../../src/storage/subagent-run-store.js'
import type { ApprovalStore, ApprovalRequest } from '../../../../src/storage/approval-store.js'
import { APPROVAL_STATES } from '../../../../src/storage/approval-store.js'
import type { AskStore, AskRequest } from '../../../../src/storage/ask-store.js'
import { createAgentProfileRegistry, registerSystemProfiles } from '../../../../src/taxonomy/agent-profile-registry.js'
import type { AgentProfileRegistry } from '../../../../src/taxonomy/agent-profile-registry.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal, real `ToolExecutionContext` for foreground tool invocation. */
function buildContext(overrides?: Partial<ToolExecutionContext>): ToolExecutionContext {
  const permissionContext: PermissionContext = {
    userId: 'test-user',
    sessionId: 'sess-test',
    mode: 'write_allowed',
    grants: [],
  }

  return {
    toolCallId: 'call-1',
    toolName: 'foreground_launch_subagent',
    userId: 'test-user',
    sessionId: 'sess-test',
    kernelRunId: 'krun-1',
    permissionContext,
    executionStartTime: new Date().toISOString(),
    stores: {
      toolExecutionStore: {
        updateStatus: vi.fn(),
        saveResult: vi.fn(),
      },
    },
    ...overrides,
  }
}

/** Build a complete `ForegroundToolRuntimeDeps` with mocked services. */
function buildRuntimeDeps(overrides?: Partial<ForegroundToolRuntimeDeps>): ForegroundToolRuntimeDeps {
  const mockDispatchResult: DispatchResult = {
    requestId: 'krun-1',
    actionId: 'action-1',
    status: 'completed',
    targetRuntime: 'subagent_runtime',
    createdAt: '2024-01-01T00:00:00Z',
  }

  const mockRuntimeDispatcher: RuntimeDispatcher = {
    dispatch: vi.fn().mockResolvedValue(mockDispatchResult),
  }

  const mockPlannerResult: PlannerRunResult = {
    plannerRunId: 'pl_run_1',
    planId: 'plan_1',
    status: 'planning',
    actions: [],
    steps: [],
  }

  const mockPlannerRuntime: PlannerRuntime = {
    createPlannerRun: vi.fn().mockReturnValue(mockPlannerResult),
    resumePlannerRun: vi.fn(),
    cancelPlannerRun: vi.fn(),
    replan: vi.fn(),
    archivePlannerRun: vi.fn(),
    transitionState: vi.fn(),
    handleApprovalRejection: vi.fn(),
    applyPlanPatch: vi.fn(),
    addActiveExecutionRef: vi.fn(),
    emitRuntimeAction: vi.fn(),
    saveCheckpoint: vi.fn(),
  } as unknown as PlannerRuntime

  const mockPlannerRunStore: PlannerRunStore = {
    create: vi.fn(),
    getById: vi.fn().mockReturnValue(null),
    findActive: vi.fn().mockReturnValue([]),
    findActiveBySession: vi.fn().mockReturnValue([]),
    findByUser: vi.fn().mockReturnValue([]),
    updateStatus: vi.fn(),
  } as unknown as PlannerRunStore

  const mockSubagentRunStore: SubagentRunStore = {
    create: vi.fn(),
    getById: vi.fn().mockReturnValue(null),
    updateStatus: vi.fn(),
    saveResult: vi.fn(),
    query: vi.fn().mockReturnValue([]),
  } as unknown as SubagentRunStore

  const mockApprovalStore: ApprovalStore = {
    create: vi.fn(),
    getById: vi.fn().mockReturnValue(null),
    update: vi.fn().mockReturnValue({} as ApprovalRequest),
    findPendingByUser: vi.fn().mockReturnValue([]),
    findByUser: vi.fn().mockReturnValue([]),
    findPendingBySession: vi.fn().mockReturnValue([]),
    findExpired: vi.fn().mockReturnValue([]),
    delete: vi.fn(),
  } as unknown as ApprovalStore

  const mockAskStore: AskStore = {
    create: vi.fn(),
    getById: vi.fn().mockReturnValue(null),
    update: vi.fn().mockReturnValue({} as AskRequest),
    findByUser: vi.fn().mockReturnValue([]),
    findPendingByUser: vi.fn().mockReturnValue([]),
    claimResponse: vi.fn().mockReturnValue(true),
    unclaimResponse: vi.fn(),
    delete: vi.fn(),
  } as unknown as AskStore

  const profileRegistry: AgentProfileRegistry = createAgentProfileRegistry()
  registerSystemProfiles(profileRegistry)

  return {
    runtimeDispatcher: mockRuntimeDispatcher,
    plannerRuntime: mockPlannerRuntime,
    plannerRunStore: mockPlannerRunStore,
    subagentRunStore: mockSubagentRunStore,
    approvalStore: mockApprovalStore,
    askStore: mockAskStore,
    profileRegistry,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Foreground Runtime Handlers - wired via registerAllForegroundTools', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = createToolRegistry()
  })

  // -------------------------------------------------------------------------
  // Case 1: Launch subagent success with runtimeDeps
  // -------------------------------------------------------------------------
  it('launch_subagent succeeds when dispatcher resolves completed', async () => {
    const runtimeDeps = buildRuntimeDeps()
    registerAllForegroundTools(registry, { runtimeDeps })

    const tool = registry.getTool(LAUNCH_SUBAGENT_TOOL_ID)
    expect(tool).not.toBeNull()

    const context = buildContext()
    const result: ToolExecutionResult = await tool!.handler({ objective: 'test task' }, context)

    // The wired handler dispatched to the runtime dispatcher, not the placeholder.
    expect(result.success).toBe(true)
    expect(result.error?.code).not.toBe('FOREGROUND_TOOL_REQUIRES_KERNEL')
    expect(result.synthetic).toBeUndefined()

    // Data carries the launch result with a runtime action id.
    expect(result.data).toBeDefined()
    const data = result.data as { runtimeActionId: string; agentType: string; agentProfile: string }
    expect(data.runtimeActionId).toEqual(expect.any(String))
    expect(data.runtimeActionId.length).toBeGreaterThan(0)

    // The dispatcher was actually called.
    expect(runtimeDeps.runtimeDispatcher.dispatch).toHaveBeenCalledTimes(1)
  })

  // -------------------------------------------------------------------------
  // Case 2: Missing sessionId returns SESSION_REQUIRED
  // -------------------------------------------------------------------------
  it('launch_subagent returns SESSION_REQUIRED when sessionId is missing', async () => {
    const runtimeDeps = buildRuntimeDeps()
    registerAllForegroundTools(registry, { runtimeDeps })

    const tool = registry.getTool(LAUNCH_SUBAGENT_TOOL_ID)
    expect(tool).not.toBeNull()

    const context = buildContext({ sessionId: undefined })
    const result: ToolExecutionResult = await tool!.handler({ objective: 'test task' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error!.code).toBe('SESSION_REQUIRED')
    expect(result.error!.recoverable).toBe(true)

    // The dispatcher must NOT have been called - identity resolution failed first.
    expect(runtimeDeps.runtimeDispatcher.dispatch).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Case 3: Without runtimeDeps, placeholder returns FOREGROUND_TOOL_REQUIRES_KERNEL
  // -------------------------------------------------------------------------
  it('launch_subagent returns FOREGROUND_TOOL_REQUIRES_KERNEL placeholder without runtimeDeps', async () => {
    // No second argument -> placeholder handlers installed.
    registerAllForegroundTools(registry)

    const tool = registry.getTool(LAUNCH_SUBAGENT_TOOL_ID)
    expect(tool).not.toBeNull()

    const context = buildContext()
    const result: ToolExecutionResult = await tool!.handler({ objective: 'test task' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error!.code).toBe('FOREGROUND_TOOL_REQUIRES_KERNEL')
    expect(result.synthetic).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Case 4: Approval response branch
  // -------------------------------------------------------------------------
  it('handle_approval response path calls approval store and returns approved data', async () => {
    const pendingApproval: ApprovalRequest = {
      id: 'appr-1',
      userId: 'test-user',
      sessionId: 'sess-test',
      status: APPROVAL_STATES.PENDING,
      actionType: 'file_write',
      resource: null,
      requestedBy: 'test-user',
      requestedAt: '2024-01-01T00:00:00Z',
      metadata: JSON.stringify({ operationArgs: { path: '/tmp/test' }, turnId: 'krun-1' }),
      sourceContext: 'foreground_approval_tool',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      riskLevel: 'high',
      scope: null,
      scopeType: null,
      scopeRef: null,
      justification: null,
      expiresAt: null,
      respondedAt: null,
      responseBy: null,
      responseReason: null,
      approvalCode: null,
      idempotencyKey: null,
    }

    const mockApprovalStore: ApprovalStore = {
      create: vi.fn(),
      getById: vi.fn().mockReturnValue(pendingApproval),
      update: vi.fn().mockReturnValue({ ...pendingApproval, status: APPROVAL_STATES.APPROVED }),
      findPendingByUser: vi.fn().mockReturnValue([]),
      findByUser: vi.fn().mockReturnValue([]),
      findPendingBySession: vi.fn().mockReturnValue([]),
      findExpired: vi.fn().mockReturnValue([]),
      delete: vi.fn(),
    } as unknown as ApprovalStore

    const runtimeDeps = buildRuntimeDeps({ approvalStore: mockApprovalStore })
    registerAllForegroundTools(registry, { runtimeDeps })

    const tool = registry.getTool(APPROVAL_REQUEST_TOOL_ID)
    expect(tool).not.toBeNull()

    const context = buildContext({ toolName: APPROVAL_REQUEST_TOOL_ID })
    const result: ToolExecutionResult = await tool!.handler({ approvalId: 'appr-1', decision: 'approved' }, context)

    // The response branch was taken: getById was called to fetch the approval.
    expect(mockApprovalStore.getById).toHaveBeenCalledWith('appr-1')

    // The approval was updated to APPROVED status.
    expect(mockApprovalStore.update).toHaveBeenCalledWith(
      'appr-1',
      expect.objectContaining({ status: APPROVAL_STATES.APPROVED }),
    )

    // Result is successful with approval response data.
    expect(result.success).toBe(true)
    expect(result.data).toBeDefined()
    const data = result.data as { approvalId: string; status: string; operation: string }
    expect(data.approvalId).toBe('appr-1')
    expect(data.status).toBe('approved')
    expect(data.operation).toBe('file_write')
  })

  // -------------------------------------------------------------------------
  // Case 5: Spawn planner path
  // -------------------------------------------------------------------------
  it('spawn_planner returns plannerRunId from planner runtime', async () => {
    const expectedPlannerResult: PlannerRunResult = {
      plannerRunId: 'pl_run_42',
      planId: 'plan_42',
      status: 'planning',
      actions: [],
      steps: [],
    }

    const mockPlannerRuntime: PlannerRuntime = {
      createPlannerRun: vi.fn().mockReturnValue(expectedPlannerResult),
    } as unknown as PlannerRuntime

    const runtimeDeps = buildRuntimeDeps({ plannerRuntime: mockPlannerRuntime })
    registerAllForegroundTools(registry, { runtimeDeps })

    const tool = registry.getTool(SPAWN_PLANNER_TOOL_ID)
    expect(tool).not.toBeNull()

    const context = buildContext({ toolName: SPAWN_PLANNER_TOOL_ID })
    const result: ToolExecutionResult = await tool!.handler({ objective: 'test objective' }, context)

    // Planner runtime was called with the objective.
    expect(mockPlannerRuntime.createPlannerRun).toHaveBeenCalledTimes(1)
    const callArg = (mockPlannerRuntime.createPlannerRun as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      objective: string
      userId: string
      sessionId: string
    }
    expect(callArg.objective).toBe('test objective')
    expect(callArg.userId).toBe('test-user')
    expect(callArg.sessionId).toBe('sess-test')

    // Result is successful and carries the planner run id.
    expect(result.success).toBe(true)
    expect(result.data).toBeDefined()
    const data = result.data as { plannerRunId: string; planId: string }
    expect(data.plannerRunId).toBe('pl_run_42')
    expect(data.planId).toBe('plan_42')
  })
})
