import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createE2EHarness, type E2EHarness } from './test-harness.js'
import { createForegroundAgent } from '../../src/foreground/foreground-agent.js'
import type { ForegroundMessageInput, ForegroundSessionState } from '../../src/foreground/types.js'
import type { LLMAdapter } from '../../src/llm/adapter.js'
import type { LLMRequest, LLMResult, LLMResponse } from '../../src/llm/types.js'
import { createPlannerRuntime } from '../../src/planner/planner-runtime.js'
import { createPlannerRunStore } from '../../src/storage/planner-run-store.js'
import { createPlanStore } from '../../src/storage/plan-store.js'
import { createRuntimeActionStore } from '../../src/storage/runtime-action-store.js'
import { DeterministicPlanGenerator } from '../../src/planner/deterministic-plan-generator.js'
import { PLANNER_STATES, EXECUTION_PLAN_STATES } from '../../src/shared/states.js'
import { createMockModelInputBuilder } from '../helpers/model-input.js'

// ============================================================
// Mock LLM Adapter - routes to spawn_planner
// ============================================================

function createPlannerMockLLMAdapter(): LLMAdapter {
  return {
    config: {
      providers: [],
      defaultTimeoutMs: 10000,
      enableCircuitBreaker: false,
    },
    providers: [],
    complete: vi.fn(async (_request: LLMRequest): Promise<LLMResult> => {
      const response: LLMResponse = {
        id: 'planner-test-response',
        model: 'gpt-4o-mini',
        content: JSON.stringify({
          route: 'spawn_planner',
          reason: 'Complex multi-step task detected requiring planning',
          userVisibleResponse: "I'll plan this complex task for you.",
          estimatedSteps: 4,
          complexity: 'medium',
        }),
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
      }
      return {
        success: true,
        response,
        providerId: 'mock-provider',
      }
    }),
    stream: async function* () {},
    addProvider: vi.fn(),
    removeProvider: vi.fn(),
    getProvider: vi.fn(),
    getHealthyProviders: vi.fn(() => []),
    updateProviderPriority: vi.fn(),
  }
}

// ============================================================
// Session State Helpers
// ============================================================

function createBaseState(
  userId: string,
  sessionId: string,
  overrides?: Partial<ForegroundSessionState>,
): ForegroundSessionState {
  return {
    hydratedSession: {
      userContext: { userId, sessionId },
      sessionContext: {
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
      activeWorkRefs: {
        activeRuns: [],
        pendingApprovals: [],
      },
    },
    activeWorkRefs: {
      activeRuns: [],
      pendingApprovals: [],
    },
    currentPersona: {
      personaId: 'default',
      name: 'Assistant',
      directDelegationPolicy: {
        estimatedStepsGte: 3,
        maxComplexity: 'medium',
        allowedToolCategories: ['read', 'search', 'internal'],
      },
    },
    effectivePolicy: {
      estimatedStepsGte: 3,
      maxComplexity: 'medium',
      allowedToolCategories: ['read', 'search', 'internal'],
    },
    ...overrides,
  }
}

function createMessageInput(
  message: string,
  userId: string,
  sessionId: string,
  turnId: string,
  timestamp: string,
  overrides?: Partial<ForegroundMessageInput>,
): ForegroundMessageInput {
  return {
    message,
    userId,
    sessionId,
    turnId,
    timestamp,
    ...overrides,
  }
}

// ============================================================
// Flow 12: Planner Complex Task E2E
// ============================================================

describe('Flow 12: Planner Complex Task', () => {
  // ----------------------------------------------------------
  // SECTION A: ForegroundAgent Planner Routing
  // Tests that ForegroundAgent correctly routes complex
  // messages to spawn_planner with requiresPlanner: true
  // ----------------------------------------------------------

  describe('ForegroundAgent Planner Routing', () => {
    it('routes complex Chinese task to spawn_planner', async () => {
      const mockAdapter = createPlannerMockLLMAdapter()
      const agent = createForegroundAgent({ llmAdapter: mockAdapter, modelInputBuilder: createMockModelInputBuilder() })

      const userId = 'user_012'
      const sessionId = 'sess_012'
      const message = '帮我整理项目状态，生成摘要并准备写入artifact'

      const input = createMessageInput(message, userId, sessionId, 'turn_012', new Date().toISOString())
      const state = createBaseState(userId, sessionId)

      const decision = await agent.processMessage(input, state)

      expect(decision.route).toBe('spawn_planner')
      expect(decision.requiresPlanner).toBe(true)
      expect(decision.userVisibleResponse).toBeDefined()
      expect(decision.complexity).toBe('medium')
      expect(decision.estimatedSteps).toBe(4)
    })

    it('routes complex English task to spawn_planner', async () => {
      const mockAdapter = createPlannerMockLLMAdapter()
      const agent = createForegroundAgent({ llmAdapter: mockAdapter, modelInputBuilder: createMockModelInputBuilder() })

      const userId = 'user_012'
      const sessionId = 'sess_012'
      const message = 'Analyze project status, generate summary and write to artifact'

      const input = createMessageInput(message, userId, sessionId, 'turn_012b', new Date().toISOString())
      const state = createBaseState(userId, sessionId)

      const decision = await agent.processMessage(input, state)

      expect(decision.route).toBe('spawn_planner')
      expect(decision.requiresPlanner).toBe(true)
    })

    it('does NOT route simple chat to spawn_planner', async () => {
      const mockAdapter: LLMAdapter = {
        config: {
          providers: [],
          defaultTimeoutMs: 10000,
          enableCircuitBreaker: false,
        },
        providers: [],
        complete: vi.fn(async (_request: LLMRequest): Promise<LLMResult> => {
          const response: LLMResponse = {
            id: 'simple-chat-response',
            model: 'gpt-4o-mini',
            content: JSON.stringify({
              route: 'answer_directly',
              reason: 'Simple question',
              userVisibleResponse: 'Hello! How can I help you?',
            }),
            role: 'assistant',
            finishReason: 'stop',
            createdAt: new Date().toISOString(),
          }
          return { success: true, response, providerId: 'mock-provider' }
        }),
        stream: async function* () {},
        addProvider: vi.fn(),
        removeProvider: vi.fn(),
        getProvider: vi.fn(),
        getHealthyProviders: vi.fn(() => []),
        updateProviderPriority: vi.fn(),
      }
      const agent = createForegroundAgent({ llmAdapter: mockAdapter, modelInputBuilder: createMockModelInputBuilder() })

      const userId = 'user_012'
      const sessionId = 'sess_012'
      const input = createMessageInput(
        'Hello, how are you?',
        userId,
        sessionId,
        'turn_simple',
        new Date().toISOString(),
      )
      const state = createBaseState(userId, sessionId)

      const decision = await agent.processMessage(input, state)

      expect(decision.route).toBe('answer_directly')
      expect(decision.requiresPlanner).toBe(false)
    })
  })

  // ----------------------------------------------------------
  // SECTION B: PlannerRuntime Creates PlannerRun and Plan
  // Tests that PlannerRuntime creates a PlannerRun with a
  // valid ExecutionPlan
  // ----------------------------------------------------------

  describe('PlannerRuntime Plan Creation', () => {
    let harness: E2EHarness

    beforeEach(() => {
      harness = createE2EHarness()
    })

    afterEach(() => {
      harness.close()
    })

    it('creates PlannerRun via PlannerRuntime with valid plan', () => {
      const plannerRunStore = createPlannerRunStore(harness.connection)
      const planStore = createPlanStore(harness.connection)
      const runtimeActionStore = createRuntimeActionStore(harness.connection)

      const plannerRuntime = createPlannerRuntime({
        planStore,
        plannerRunStore,
        runtimeActionStore,
        eventStore: harness.stores.eventStore,
      })

      const result = plannerRuntime.createPlannerRun({
        objective: '帮我整理项目状态，生成摘要并准备写入artifact',
        userId: 'user_012',
        sessionId: 'sess_012',
      })

      expect(result.plannerRunId).toBeDefined()
      expect(result.planId).toBeDefined()
      expect(result.status).toBe(PLANNER_STATES.INITIALIZING)
      expect(result.actions.length).toBeGreaterThan(0)

      // Verify PlannerRun exists in store
      const run = plannerRunStore.getById(result.plannerRunId)
      expect(run).toBeDefined()
      expect(run!.plannerRunId).toBe(result.plannerRunId)
      expect(run!.planId).toBe(result.planId)
      expect(run!.userId).toBe('user_012')
      expect(run!.sessionId).toBe('sess_012')
      expect(run!.status).toBe(PLANNER_STATES.INITIALIZING)

      // Verify ExecutionPlan exists in store
      const plan = planStore.getPlan(result.planId)
      expect(plan).toBeDefined()
      expect(plan!.planId).toBe(result.planId)
      expect(plan!.userId).toBe('user_012')
      expect(plan!.status).toBe(EXECUTION_PLAN_STATES.DRAFT)
      expect(plan!.steps.length).toBeGreaterThanOrEqual(3)
    })

    it('created plan has at least 3 steps', () => {
      const plannerRunStore = createPlannerRunStore(harness.connection)
      const planStore = createPlanStore(harness.connection)
      const runtimeActionStore = createRuntimeActionStore(harness.connection)

      const plannerRuntime = createPlannerRuntime({
        planStore,
        plannerRunStore,
        runtimeActionStore,
        eventStore: harness.stores.eventStore,
      })

      const result = plannerRuntime.createPlannerRun({
        objective: '编写部署脚本并发送通知',
        userId: 'user_012',
        sessionId: 'sess_012',
      })

      const plan = planStore.getPlan(result.planId)
      expect(plan).toBeDefined()
      expect(plan!.steps.length).toBeGreaterThanOrEqual(3)
    })

    it('creates RuntimeAction during PlannerRun creation', () => {
      const plannerRunStore = createPlannerRunStore(harness.connection)
      const planStore = createPlanStore(harness.connection)
      const runtimeActionStore = createRuntimeActionStore(harness.connection)

      const plannerRuntime = createPlannerRuntime({
        planStore,
        plannerRunStore,
        runtimeActionStore,
        eventStore: harness.stores.eventStore,
      })

      const result = plannerRuntime.createPlannerRun({
        objective: '生成项目报告并保存',
        userId: 'user_012',
        sessionId: 'sess_012',
      })

      // Verify RuntimeAction was created
      const actions = runtimeActionStore.query({ plannerRunId: result.plannerRunId })
      expect(actions.length).toBeGreaterThan(0)

      const action = actions[0]
      expect(action).toBeDefined()
      expect(action.actionId).toBeDefined()
      expect(action.targetRuntime).toBe('agent_kernel')
      expect(action.targetAction).toBe('start_agent_run')
      expect(action.status).toBe('created')
      expect(action.userId).toBe('user_012')
      expect(action.sessionId).toBe('sess_012')
      expect(action.targetRef?.plannerRunId).toBe(result.plannerRunId)
      expect(action.targetRef?.planId).toBe(result.planId)
    })

    it('emits planner_state_patch event during creation', () => {
      const plannerRunStore = createPlannerRunStore(harness.connection)
      const planStore = createPlanStore(harness.connection)
      const runtimeActionStore = createRuntimeActionStore(harness.connection)

      const plannerRuntime = createPlannerRuntime({
        planStore,
        plannerRunStore,
        runtimeActionStore,
        eventStore: harness.stores.eventStore,
      })

      const result = plannerRuntime.createPlannerRun({
        objective: '审计代码库并生成报告',
        userId: 'user_012',
        sessionId: 'sess_012',
      })

      // Verify events were emitted
      const events = harness.stores.eventStore.query({
        plannerRunId: result.plannerRunId,
      })
      expect(events.length).toBeGreaterThan(0)

      const statePatchEvent = events.find((e) => e.eventType === 'planner_state_patch')
      expect(statePatchEvent).toBeDefined()
      expect(statePatchEvent!.sourceModule).toBe('planner')
      if (statePatchEvent!.relatedRefs) {
        expect(statePatchEvent!.relatedRefs.plannerRunId).toBe(result.plannerRunId)
      }
    })
  })

  // ----------------------------------------------------------
  // SECTION C: Deterministic Plan Generation with Approval
  // Tests that DeterministicPlanGenerator produces plans
  // with ≥3 steps and includes approval for write steps
  // ----------------------------------------------------------

  describe('Deterministic Plan Generation', () => {
    it('generates plan with ≥3 steps for complex write goal', () => {
      const generator = new DeterministicPlanGenerator()
      const output = generator.generate({
        goal: '生成项目摘要并写入artifact',
        availableTools: ['read_file', 'write_file', 'greet'],
        constraints: { maxSteps: 10, requireApprovalForWriteTools: true },
      })

      const plan = output.plan
      expect(plan.steps.length).toBeGreaterThanOrEqual(3)
      expect(plan.goal).toBe('生成项目摘要并写入artifact')
      expect(plan.version).toBe(1)
      expect(plan.id).toBeDefined()

      // Should have at least one tool_call step
      const toolSteps = plan.steps.filter((s) => s.kind === 'tool_call')
      expect(toolSteps.length).toBeGreaterThanOrEqual(1)

      // Should have a final_response step
      const finalSteps = plan.steps.filter((s) => s.kind === 'final_response')
      expect(finalSteps.length).toBe(1)

      // The last step should be final_response
      const lastStep = plan.steps[plan.steps.length - 1]
      expect(lastStep!.kind).toBe('final_response')
    })

    it('includes approval requirement for write tool steps', () => {
      const generator = new DeterministicPlanGenerator()
      const output = generator.generate({
        goal: '创建部署脚本并写入文件',
        availableTools: ['read_file', 'write_file'],
        constraints: { maxSteps: 10, requireApprovalForWriteTools: true },
      })

      const plan = output.plan
      expect(plan.steps.length).toBeGreaterThanOrEqual(3)

      // Should have approval steps or approval requirements
      const approvalSteps = plan.steps.filter((s) => s.kind === 'user_approval')
      const stepsWithApproval = plan.steps.filter((s) => s.approvalRequirementId)

      // Either a dedicated approval step or steps referencing approval
      const hasApproval = approvalSteps.length > 0 || stepsWithApproval.length > 0
      expect(hasApproval).toBe(true)

      // Check requiredApprovals on the plan itself
      if (plan.requiredApprovals) {
        expect(plan.requiredApprovals.length).toBeGreaterThan(0)
        expect(plan.requiredApprovals[0]!.approvalId).toBeDefined()
        expect(plan.requiredApprovals[0]!.reason).toBeDefined()
      }
    })

    it('generates plan with approval for write tools without needing approval steps', () => {
      const generator = new DeterministicPlanGenerator()

      const output = generator.generate({
        goal: '创建部署脚本并写入文件',
        availableTools: ['read_file', 'write_file'],
        constraints: { maxSteps: 10, requireApprovalForWriteTools: true },
      })

      const plan = output.plan
      expect(plan.steps.length).toBeGreaterThanOrEqual(3)

      // Verify step dependencies form a chain
      const stepsWithDeps = plan.steps.filter((s) => s.dependsOn && s.dependsOn.length > 0)
      expect(stepsWithDeps.length).toBeGreaterThan(0)
    })

    it('generates deterministic IDs for same input', () => {
      const generator = new DeterministicPlanGenerator()

      const output1 = generator.generate({
        goal: '测试确定性ID生成',
        availableTools: ['read_file'],
        constraints: { maxSteps: 4 },
      })

      const output2 = generator.generate({
        goal: '测试确定性ID生成',
        availableTools: ['read_file'],
        constraints: { maxSteps: 4 },
      })

      expect(output1.plan.id).toBe(output2.plan.id)

      // Steps should also have deterministic IDs
      expect(output1.plan.steps.length).toBe(output2.plan.steps.length)
      for (let i = 0; i < output1.plan.steps.length; i++) {
        expect(output1.plan.steps[i]!.id).toBe(output2.plan.steps[i]!.id)
      }
    })

    it('generates only valid step kinds', () => {
      const generator = new DeterministicPlanGenerator()
      const validKinds = [
        'agent_task',
        'tool_call',
        'subagent_task',
        'workflow_step',
        'user_approval',
        'final_response',
      ]

      const output = generator.generate({
        goal: '复杂任务需要多个步骤',
        availableTools: ['read_file'],
        constraints: { maxSteps: 6 },
      })

      for (const step of output.plan.steps) {
        expect(validKinds.includes(step.kind)).toBe(true)
      }
    })
  })

  // ----------------------------------------------------------
  // SECTION D: RuntimeAction Emission
  // Tests that RuntimeActions are properly created and
  // queryable during the planner pipeline
  // ----------------------------------------------------------

  describe('RuntimeAction Emission', () => {
    let harness: E2EHarness

    beforeEach(() => {
      harness = createE2EHarness()
    })

    afterEach(() => {
      harness.close()
    })

    it('emits start_agent_run RuntimeAction on PlannerRun creation', () => {
      const plannerRunStore = createPlannerRunStore(harness.connection)
      const planStore = createPlanStore(harness.connection)
      const runtimeActionStore = createRuntimeActionStore(harness.connection)

      const plannerRuntime = createPlannerRuntime({
        planStore,
        plannerRunStore,
        runtimeActionStore,
        eventStore: harness.stores.eventStore,
      })

      const result = plannerRuntime.createPlannerRun({
        objective: '部署应用并验证',
        userId: 'user_012',
        sessionId: 'sess_012',
      })

      const actions = runtimeActionStore.query({ plannerRunId: result.plannerRunId })
      expect(actions.length).toBeGreaterThan(0)

      const startAction = actions.find((a) => a.targetAction === 'start_agent_run')
      expect(startAction).toBeDefined()
      expect(startAction!.actionType).toBe('start_agent_run')
      expect(startAction!.source.sourceModule).toBe('planner')
      expect(startAction!.status).toBe('created')
      expect(startAction!.payload.planId).toBe(result.planId)
    })

    it('RuntimeAction is queryable by userId', () => {
      const plannerRunStore = createPlannerRunStore(harness.connection)
      const planStore = createPlanStore(harness.connection)
      const runtimeActionStore = createRuntimeActionStore(harness.connection)

      const plannerRuntime = createPlannerRuntime({
        planStore,
        plannerRunStore,
        runtimeActionStore,
        eventStore: harness.stores.eventStore,
      })

      plannerRuntime.createPlannerRun({
        objective: '测试查询功能',
        userId: 'user_012',
        sessionId: 'sess_012',
      })

      const actions = runtimeActionStore.query({ userId: 'user_012' })
      expect(actions.length).toBeGreaterThan(0)
      expect(actions.some((a) => a.userId === 'user_012')).toBe(true)
    })

    it('RuntimeAction is queryable by sessionId', () => {
      const plannerRunStore = createPlannerRunStore(harness.connection)
      const planStore = createPlanStore(harness.connection)
      const runtimeActionStore = createRuntimeActionStore(harness.connection)

      const plannerRuntime = createPlannerRuntime({
        planStore,
        plannerRunStore,
        runtimeActionStore,
        eventStore: harness.stores.eventStore,
      })

      plannerRuntime.createPlannerRun({
        objective: '测试会话查询',
        userId: 'user_012',
        sessionId: 'sess_012_actions',
      })

      const actions = runtimeActionStore.query({ sessionId: 'sess_012_actions' })
      expect(actions.length).toBeGreaterThan(0)
      expect(actions.some((a) => a.sessionId === 'sess_012_actions')).toBe(true)
    })
  })

  // ----------------------------------------------------------
  // SECTION E: Events and Audit Recording
  // Tests that events are properly recorded during the
  // planner pipeline
  // ----------------------------------------------------------

  describe('Events and Audit Recording', () => {
    let harness: E2EHarness

    beforeEach(() => {
      harness = createE2EHarness()
    })

    afterEach(() => {
      harness.close()
    })

    it('records planner_state_patch event on creation', () => {
      const plannerRunStore = createPlannerRunStore(harness.connection)
      const planStore = createPlanStore(harness.connection)
      const runtimeActionStore = createRuntimeActionStore(harness.connection)

      const plannerRuntime = createPlannerRuntime({
        planStore,
        plannerRunStore,
        runtimeActionStore,
        eventStore: harness.stores.eventStore,
      })

      const result = plannerRuntime.createPlannerRun({
        objective: '完整事件审计测试',
        userId: 'user_012',
        sessionId: 'sess_012_events',
      })

      const events = harness.stores.eventStore.query({
        plannerRunId: result.plannerRunId,
      })

      const statePatchEvents = events.filter((e) => e.eventType === 'planner_state_patch')
      expect(statePatchEvents.length).toBeGreaterThanOrEqual(1)

      const patchEvent = statePatchEvents[0]!
      expect(patchEvent.sourceModule).toBe('planner')
      expect(patchEvent.payload.plannerRunId).toBe(result.plannerRunId)
      expect(patchEvent.payload.patchType).toBe('state_transition')
    })

    it('records events with correct sourceModule', () => {
      const plannerRunStore = createPlannerRunStore(harness.connection)
      const planStore = createPlanStore(harness.connection)
      const runtimeActionStore = createRuntimeActionStore(harness.connection)

      const plannerRuntime = createPlannerRuntime({
        planStore,
        plannerRunStore,
        runtimeActionStore,
        eventStore: harness.stores.eventStore,
      })

      const result = plannerRuntime.createPlannerRun({
        objective: '事件源模块测试',
        userId: 'user_012',
        sessionId: 'sess_012_audit',
      })

      const events = harness.stores.eventStore.query({
        plannerRunId: result.plannerRunId,
      })

      for (const event of events) {
        expect(event.sourceModule).toBeDefined()
        expect(typeof event.sourceModule).toBe('string')
        expect(event.createdAt).toBeDefined()
        expect(event.eventId).toBeDefined()
      }
    })

    it('events are queryable by plannerRunId', () => {
      const plannerRunStore = createPlannerRunStore(harness.connection)
      const planStore = createPlanStore(harness.connection)
      const runtimeActionStore = createRuntimeActionStore(harness.connection)

      const plannerRuntime = createPlannerRuntime({
        planStore,
        plannerRunStore,
        runtimeActionStore,
        eventStore: harness.stores.eventStore,
      })

      const result = plannerRuntime.createPlannerRun({
        objective: '事件运行ID查询测试',
        userId: 'user_012',
        sessionId: 'sess_012_query',
      })

      const events = harness.stores.eventStore.query({ plannerRunId: result.plannerRunId })
      expect(events.length).toBeGreaterThan(0)
    })

    it('events are queryable by eventType via plannerRunId', () => {
      const plannerRunStore = createPlannerRunStore(harness.connection)
      const planStore = createPlanStore(harness.connection)
      const runtimeActionStore = createRuntimeActionStore(harness.connection)

      const plannerRuntime = createPlannerRuntime({
        planStore,
        plannerRunStore,
        runtimeActionStore,
        eventStore: harness.stores.eventStore,
      })

      const result = plannerRuntime.createPlannerRun({
        objective: '事件类型查询测试',
        userId: 'user_012',
        sessionId: 'sess_012_type',
      })

      const events = harness.stores.eventStore.query({
        plannerRunId: result.plannerRunId,
        eventType: 'planner_state_patch',
      })

      expect(events.length).toBeGreaterThanOrEqual(1)
      for (const event of events) {
        expect(event.eventType).toBe('planner_state_patch')
      }
    })

    it('planner_cancelled event has proper audit fields', () => {
      const plannerRunStore = createPlannerRunStore(harness.connection)
      const planStore = createPlanStore(harness.connection)
      const runtimeActionStore = createRuntimeActionStore(harness.connection)

      const plannerRuntime = createPlannerRuntime({
        planStore,
        plannerRunStore,
        runtimeActionStore,
        eventStore: harness.stores.eventStore,
      })

      const result = plannerRuntime.createPlannerRun({
        objective: '取消审计测试',
        userId: 'user_012',
        sessionId: 'sess_012_cancel',
      })

      // Transition to planning first (required before cancel)
      plannerRuntime.transitionState(result.plannerRunId, PLANNER_STATES.PLANNING)
      plannerRuntime.cancelPlannerRun(result.plannerRunId)

      const events = harness.stores.eventStore.query({
        plannerRunId: result.plannerRunId,
        eventType: 'planner_cancelled',
      })

      expect(events.length).toBeGreaterThanOrEqual(1)
      const cancelEvent = events[0]!
      expect(cancelEvent.sourceModule).toBe('planner')
      expect(cancelEvent.userId).toBe('user_012')
      expect(cancelEvent.sessionId).toBe('sess_012_cancel')
      expect(cancelEvent.relatedRefs?.plannerRunId).toBe(result.plannerRunId)
    })
  })

  // ----------------------------------------------------------
  // SECTION F: Full End-to-End Planner Pipeline
  // Tests the complete flow:
  // ForegroundAgent → spawn_planner → PlannerRuntime → Plan
  // with ≥3 steps, approval, RuntimeAction, events, and
  // queryable timeline data
  // ----------------------------------------------------------

  describe('Full E2E Planner Pipeline', () => {
    let harness: E2EHarness

    beforeEach(() => {
      harness = createE2EHarness()
    })

    afterEach(() => {
      harness.close()
    })

    it('full pipeline: route → create planner run → plan with steps → approval → actions → events', async () => {
      const userId = 'user_012'
      const sessionId = 'sess_012'

      // Step 1: ForegroundAgent routes complex message to spawn_planner
      const mockAdapter = createPlannerMockLLMAdapter()
      const agent = createForegroundAgent({ llmAdapter: mockAdapter, modelInputBuilder: createMockModelInputBuilder() })

      const message = '帮我整理项目状态，生成摘要并准备写入artifact'
      const turnId = harness.idGenerator.custom('turn')
      const timestamp = harness.clock.nowISO()

      const input: ForegroundMessageInput = {
        message,
        userId,
        sessionId,
        turnId,
        timestamp,
      }

      const state: ForegroundSessionState = {
        hydratedSession: {
          userContext: { userId, sessionId },
          sessionContext: {
            messageCount: 1,
            lastActivityAt: timestamp,
            activePlannerRunIds: [],
            activeBackgroundRunIds: [],
          },
          activeWorkRefs: {
            activeRuns: [],
            pendingApprovals: [],
          },
        },
        activeWorkRefs: {
          activeRuns: [],
          pendingApprovals: [],
        },
        currentPersona: {
          personaId: 'default',
          name: 'Assistant',
          directDelegationPolicy: {
            estimatedStepsGte: 3,
            maxComplexity: 'medium',
            allowedToolCategories: ['read', 'search', 'internal'],
          },
        },
        effectivePolicy: {
          estimatedStepsGte: 3,
          maxComplexity: 'medium',
          allowedToolCategories: ['read', 'search', 'internal'],
        },
      }

      const decision = await agent.processMessage(input, state)

      // Verify routing decision
      expect(decision.route).toBe('spawn_planner')
      expect(decision.requiresPlanner).toBe(true)
      expect(decision.estimatedSteps).toBeGreaterThanOrEqual(3)

      // Step 2: Create PlannerRuntime and generate plan
      const plannerRunStore = createPlannerRunStore(harness.connection)
      const planStore = createPlanStore(harness.connection)
      const runtimeActionStore = createRuntimeActionStore(harness.connection)

      const plannerRuntime = createPlannerRuntime({
        planStore,
        plannerRunStore,
        runtimeActionStore,
        eventStore: harness.stores.eventStore,
      })

      const runResult = plannerRuntime.createPlannerRun({
        objective: message,
        userId,
        sessionId,
      })

      expect(runResult.plannerRunId).toBeDefined()
      expect(runResult.planId).toBeDefined()

      // Step 3: Verify ExecutionPlan
      const plan = planStore.getPlan(runResult.planId)
      expect(plan).toBeDefined()
      expect(plan!.steps.length).toBeGreaterThanOrEqual(3) // Plan has ≥3 steps
      expect(plan!.objective).toBe(message)

      // Step 4: Generate deterministic plan to verify approval requirements
      const generator = new DeterministicPlanGenerator()
      const genOutput = generator.generate({
        goal: message,
        availableTools: ['read_file', 'write_file'],
        constraints: { maxSteps: 10, requireApprovalForWriteTools: true },
      })

      // Verify write tool step has approval
      const writeSteps = genOutput.plan.steps.filter((s) => s.kind === 'tool_call' && s.approvalRequirementId)
      const hasApprovalSteps = genOutput.plan.steps.some((s) => s.kind === 'user_approval')
      const hasRequiredApprovals = genOutput.plan.requiredApprovals && genOutput.plan.requiredApprovals.length > 0

      // At least one write step has approval requirement OR a dedicated approval step exists
      expect(writeSteps.length > 0 || hasApprovalSteps || hasRequiredApprovals).toBe(true)

      // Step 5: Verify RuntimeAction emitted
      const actions = runtimeActionStore.query({ plannerRunId: runResult.plannerRunId })
      expect(actions.length).toBeGreaterThan(0)
      expect(actions[0]!.actionId).toBeDefined()
      expect(actions[0]!.targetRuntime).toBe('agent_kernel')

      // Step 6: Verify events/audit recorded
      const events = harness.stores.eventStore.query({
        plannerRunId: runResult.plannerRunId,
      })
      expect(events.length).toBeGreaterThan(0)

      const statePatch = events.find((e) => e.eventType === 'planner_state_patch')
      expect(statePatch).toBeDefined()

      // Step 7: Verify PlannerRun is queryable
      const run = plannerRunStore.getById(runResult.plannerRunId)
      expect(run).toBeDefined()
      expect(run!.status).toBe(PLANNER_STATES.INITIALIZING)
      expect(run!.userId).toBe(userId)
      expect(run!.sessionId).toBe(sessionId)

      // Verify findActive returns the run
      const activeRuns = plannerRunStore.findActive(userId)
      expect(activeRuns.some((r) => r.plannerRunId === runResult.plannerRunId)).toBe(true)

      // Step 8: Verify findActiveBySession
      const sessionRuns = plannerRunStore.findActiveBySession(sessionId)
      expect(sessionRuns.some((r) => r.plannerRunId === runResult.plannerRunId)).toBe(true)

      // Step 9: Verify all step IDs are unique
      if (plan) {
        const stepIds = plan.steps.map((s) => s.stepId)
        const uniqueStepIds = new Set(stepIds)
        expect(uniqueStepIds.size).toBe(stepIds.length)
      }
    })

    it('full pipeline with multiple planner runs works independently', () => {
      const userId = 'user_012'
      const sessionId = 'sess_012'

      const plannerRunStore = createPlannerRunStore(harness.connection)
      const planStore = createPlanStore(harness.connection)
      const runtimeActionStore = createRuntimeActionStore(harness.connection)

      const plannerRuntime = createPlannerRuntime({
        planStore,
        plannerRunStore,
        runtimeActionStore,
        eventStore: harness.stores.eventStore,
      })

      // Create first planner run
      const run1 = plannerRuntime.createPlannerRun({
        objective: '分析代码库结构',
        userId,
        sessionId,
      })

      // Create second planner run
      const run2 = plannerRuntime.createPlannerRun({
        objective: '部署新版本',
        userId,
        sessionId,
      })

      // Verify both created independently
      const plan1 = planStore.getPlan(run1.planId)
      const plan2 = planStore.getPlan(run2.planId)

      expect(plan1).toBeDefined()
      expect(plan2).toBeDefined()
      expect(plan1!.planId).not.toBe(plan2!.planId)
      expect(run1.plannerRunId).not.toBe(run2.plannerRunId)

      // Each should have its own RuntimeAction
      const actions1 = runtimeActionStore.query({ plannerRunId: run1.plannerRunId })
      const actions2 = runtimeActionStore.query({ plannerRunId: run2.plannerRunId })
      expect(actions1.length).toBeGreaterThan(0)
      expect(actions2.length).toBeGreaterThan(0)

      // Each should have its own events
      const events1 = harness.stores.eventStore.query({ plannerRunId: run1.plannerRunId })
      const events2 = harness.stores.eventStore.query({ plannerRunId: run2.plannerRunId })
      expect(events1.length).toBeGreaterThan(0)
      expect(events2.length).toBeGreaterThan(0)

      // Both should be active
      const activeRuns = plannerRunStore.findActive(userId)
      expect(activeRuns.length).toBeGreaterThanOrEqual(2)
    })

    it('planner run transitions through state machine correctly', () => {
      const userId = 'user_012'
      const sessionId = 'sess_012'

      const plannerRunStore = createPlannerRunStore(harness.connection)
      const planStore = createPlanStore(harness.connection)
      const runtimeActionStore = createRuntimeActionStore(harness.connection)

      const plannerRuntime = createPlannerRuntime({
        planStore,
        plannerRunStore,
        runtimeActionStore,
        eventStore: harness.stores.eventStore,
      })

      const result = plannerRuntime.createPlannerRun({
        objective: '状态机测试',
        userId,
        sessionId,
      })

      // initializing → planning
      plannerRuntime.transitionState(result.plannerRunId, PLANNER_STATES.PLANNING)
      let run = plannerRunStore.getById(result.plannerRunId)
      expect(run!.status).toBe(PLANNER_STATES.PLANNING)

      // planning → waiting_for_approval
      plannerRuntime.transitionState(result.plannerRunId, PLANNER_STATES.WAITING_FOR_APPROVAL)
      run = plannerRunStore.getById(result.plannerRunId)
      expect(run!.status).toBe(PLANNER_STATES.WAITING_FOR_APPROVAL)

      // waiting_for_approval → planning (resume)
      plannerRuntime.transitionState(result.plannerRunId, PLANNER_STATES.PLANNING)
      run = plannerRunStore.getById(result.plannerRunId)
      expect(run!.status).toBe(PLANNER_STATES.PLANNING)

      // planning → completed
      plannerRuntime.transitionState(result.plannerRunId, PLANNER_STATES.COMPLETED)
      run = plannerRunStore.getById(result.plannerRunId)
      expect(run!.status).toBe(PLANNER_STATES.COMPLETED)

      // Completed runs should NOT appear in findActive
      const activeRuns = plannerRunStore.findActive(userId)
      expect(activeRuns.some((r) => r.plannerRunId === result.plannerRunId)).toBe(false)
    })
  })
})
