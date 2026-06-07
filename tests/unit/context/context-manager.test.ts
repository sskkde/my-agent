import { describe, it, expect, beforeEach } from 'vitest'
import type { ContextItem, ContextAssemblyInput, TargetMode } from '../../../src/context/types.js'
import { ContextManager } from '../../../src/context/context-manager.js'

function createMockInput(overrides: Partial<ContextAssemblyInput> = {}): ContextAssemblyInput {
  return {
    runId: 'run-001',
    userId: 'user-001',
    sessionId: 'session-001',
    agentId: 'agent-001',
    agentType: 'main',
    invocationSource: 'gateway_intent',
    selectionPolicy: {
      targetMode: 'interactive' as TargetMode,
      tokenBudget: 4000,
      includeRecentHistoryTurns: 10,
    },
    ...overrides,
  }
}

function createMockItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    itemId: `item-${Math.random().toString(36).slice(2)}`,
    sourceType: 'system_note',
    semanticType: 'fact',
    content: 'Test content',
    estimatedTokens: 100,
    priority: 50,
    ...overrides,
  }
}

describe('ContextManager', () => {
  let manager: ContextManager

  beforeEach(() => {
    manager = new ContextManager()
  })

  describe('assemble() basic functionality', () => {
    it('should exist and be callable', () => {
      expect(manager.assemble).toBeDefined()
      expect(typeof manager.assemble).toBe('function')
    })

    it('should return a ContextBundle', () => {
      const input = createMockInput()
      const bundle = manager.assemble(input)

      expect(bundle).toBeDefined()
      expect(bundle.bundleId).toBeDefined()
      expect(bundle.runId).toBe(input.runId)
      expect(bundle.agentId).toBe(input.agentId)
      expect(bundle.agentType).toBe(input.agentType)
      expect(bundle.invocationSource).toBe(input.invocationSource)
    })

    it('should include empty arrays for items when no context sources provided', () => {
      const input = createMockInput()
      const bundle = manager.assemble(input)

      expect(bundle.pinnedItems).toEqual([])
      expect(bundle.orderedItems).toEqual([])
      expect(bundle.tokenEstimate).toBe(0)
    })
  })

  describe('Pipeline: Normalize', () => {
    it('should normalize raw context items to ContextItem format', () => {
      const rawItems: Array<Partial<ContextItem>> = [
        { sourceType: 'system_note', content: 'Note 1' },
        { sourceType: 'memory', content: 'Memory 1' },
      ]

      const input = createMockInput({
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: rawItems.map((raw, i) => createMockItem({ itemId: `raw-${i}`, ...raw })),
        },
      })

      const bundle = manager.assemble(input)

      expect(bundle.orderedItems.length).toBeGreaterThan(0)
      expect(bundle.orderedItems[0]).toHaveProperty('itemId')
      expect(bundle.orderedItems[0]).toHaveProperty('sourceType')
      expect(bundle.orderedItems[0]).toHaveProperty('semanticType')
    })

    it('should assign default semantic types based on source type', () => {
      const items = [
        createMockItem({ sourceType: 'tool_result', semanticType: 'tool_output' }),
        createMockItem({ sourceType: 'memory', semanticType: 'search_finding' }),
      ]

      const input = createMockInput({
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: items,
        },
      })

      const bundle = manager.assemble(input)

      expect(bundle.orderedItems).toHaveLength(2)
    })
  })

  describe('Pipeline: Filter', () => {
    it('should filter out expired items', () => {
      const expiredItem = createMockItem({
        itemId: 'expired',
        validUntil: new Date(Date.now() - 1000).toISOString(),
      })
      const validItem = createMockItem({
        itemId: 'valid',
        validUntil: new Date(Date.now() + 10000).toISOString(),
      })

      const input = createMockInput({
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [expiredItem, validItem],
        },
      })

      const bundle = manager.assemble(input)

      expect(bundle.orderedItems.some((i) => i.itemId === 'expired')).toBe(false)
      expect(bundle.orderedItems.some((i) => i.itemId === 'valid')).toBe(true)
    })

    it('should filter out superseded items', () => {
      const supersededItem = createMockItem({
        itemId: 'old',
        supersedesKey: 'fact-001',
      })
      const newerItem = createMockItem({
        itemId: 'new',
        supersedesKey: 'fact-001',
        freshnessTs: new Date().toISOString(),
      })

      const input = createMockInput({
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [supersededItem, newerItem],
        },
      })

      const bundle = manager.assemble(input)

      const factItems = bundle.orderedItems.filter((i) => i.supersedesKey === 'fact-001')
      expect(factItems.length).toBeLessThanOrEqual(1)
    })
  })

  describe('Pipeline: Dedup', () => {
    it('should remove duplicate items based on dedupeKey', () => {
      const items = [
        createMockItem({ itemId: 'a', dedupeKey: 'duplicate-key', content: 'First' }),
        createMockItem({ itemId: 'b', dedupeKey: 'duplicate-key', content: 'Second' }),
        createMockItem({ itemId: 'c', dedupeKey: 'unique-key', content: 'Third' }),
      ]

      const input = createMockInput({
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: items,
        },
      })

      const bundle = manager.assemble(input)

      const dedupedKeys = bundle.orderedItems.filter((i) => i.dedupeKey).map((i) => i.dedupeKey)
      const uniqueKeys = new Set(dedupedKeys)
      expect(dedupedKeys.length).toBe(uniqueKeys.size)
    })
  })

  describe('Pipeline: Score/Rank', () => {
    it('should score items by priority', () => {
      const lowPriority = createMockItem({ itemId: 'low', priority: 10 })
      const highPriority = createMockItem({ itemId: 'high', priority: 90 })

      const input = createMockInput({
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [lowPriority, highPriority],
        },
      })

      const bundle = manager.assemble(input)

      const highIdx = bundle.orderedItems.findIndex((i) => i.itemId === 'high')
      const lowIdx = bundle.orderedItems.findIndex((i) => i.itemId === 'low')
      expect(highIdx).toBeLessThan(lowIdx)
    })

    it('should prioritize pinned items', () => {
      const normal = createMockItem({ itemId: 'normal', priority: 100 })
      const pinned = createMockItem({ itemId: 'pinned', priority: 1, isPinned: true })

      const input = createMockInput({
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [normal, pinned],
        },
      })

      const bundle = manager.assemble(input)

      expect(bundle.pinnedItems).toHaveLength(1)
      expect(bundle.pinnedItems[0].itemId).toBe('pinned')
    })
  })

  describe('Pipeline: Budgeted Selection', () => {
    it('should respect token budget', () => {
      const items = Array.from({ length: 10 }, (_, i) =>
        createMockItem({
          itemId: `item-${i}`,
          estimatedTokens: 500,
          priority: i * 10,
        }),
      )

      const input = createMockInput({
        selectionPolicy: {
          targetMode: 'interactive',
          tokenBudget: 2000,
        },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: items,
        },
      })

      const bundle = manager.assemble(input)

      expect(bundle.tokenEstimate).toBeLessThanOrEqual(2000)
    })

    it('should exclude low-priority items first when budget is exceeded', () => {
      const lowPriority = createMockItem({
        itemId: 'low',
        estimatedTokens: 1000,
        priority: 10,
      })
      const highPriority = createMockItem({
        itemId: 'high',
        estimatedTokens: 1000,
        priority: 90,
      })

      const input = createMockInput({
        selectionPolicy: {
          targetMode: 'interactive',
          tokenBudget: 1500,
        },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [lowPriority, highPriority],
        },
      })

      const bundle = manager.assemble(input)

      expect(bundle.orderedItems.some((i) => i.itemId === 'high')).toBe(true)
    })

    it('should include compact hints when budget is nearly exceeded', () => {
      const items = Array.from({ length: 20 }, (_, i) =>
        createMockItem({
          itemId: `item-${i}`,
          estimatedTokens: 300,
          priority: i,
        }),
      )

      const input = createMockInput({
        selectionPolicy: {
          targetMode: 'interactive',
          tokenBudget: 2000,
        },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: items,
        },
      })

      const bundle = manager.assemble(input)

      expect(bundle.compactHints).toBeDefined()
      expect(bundle.compactHints?.shouldCompactSoon).toBe(true)
      expect(bundle.compactHints?.candidateItemIds?.length).toBeGreaterThan(0)
    })
  })

  describe('Pair Integrity', () => {
    it('should keep approval request and response together', () => {
      const approvalRequest = createMockItem({
        itemId: 'approval-req',
        sourceType: 'approval_state',
        pairId: 'approval-pair-001',
        requiresPairIntegrity: true,
        estimatedTokens: 200,
        priority: 50,
      })
      const approvalResponse = createMockItem({
        itemId: 'approval-resp',
        sourceType: 'approval_state',
        pairId: 'approval-pair-001',
        requiresPairIntegrity: true,
        estimatedTokens: 200,
        priority: 50,
      })

      const input = createMockInput({
        selectionPolicy: {
          targetMode: 'interactive',
          tokenBudget: 300,
        },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [approvalRequest, approvalResponse],
        },
      })

      const bundle = manager.assemble(input)

      const hasRequest = bundle.orderedItems.some((i) => i.itemId === 'approval-req')
      const hasResponse = bundle.orderedItems.some((i) => i.itemId === 'approval-resp')

      expect(hasRequest).toBe(hasResponse)
    })

    it('should keep tool_use and tool_result together', () => {
      const toolUse = createMockItem({
        itemId: 'tool-use',
        sourceType: 'tool_result',
        semanticType: 'tool_output',
        pairId: 'tool-pair-001',
        requiresPairIntegrity: true,
        estimatedTokens: 300,
      })
      const toolResult = createMockItem({
        itemId: 'tool-result',
        sourceType: 'tool_result',
        semanticType: 'tool_output',
        pairId: 'tool-pair-001',
        requiresPairIntegrity: true,
        estimatedTokens: 300,
      })

      const input = createMockInput({
        selectionPolicy: {
          targetMode: 'execute',
          tokenBudget: 400,
        },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [toolUse, toolResult],
        },
      })

      const bundle = manager.assemble(input)

      const hasUse = bundle.orderedItems.some((i) => i.itemId === 'tool-use')
      const hasResult = bundle.orderedItems.some((i) => i.itemId === 'tool-result')

      expect(hasUse).toBe(hasResult)
    })

    it('should keep workflow step input and output together', () => {
      const stepInput = createMockItem({
        itemId: 'step-input',
        sourceType: 'workflow_state',
        pairId: 'step-pair-001',
        requiresPairIntegrity: true,
        estimatedTokens: 250,
      })
      const stepOutput = createMockItem({
        itemId: 'step-output',
        sourceType: 'workflow_state',
        pairId: 'step-pair-001',
        requiresPairIntegrity: true,
        estimatedTokens: 250,
      })

      const input = createMockInput({
        selectionPolicy: {
          targetMode: 'workflow_step',
          tokenBudget: 350,
        },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [stepInput, stepOutput],
        },
      })

      const bundle = manager.assemble(input)

      const hasInput = bundle.orderedItems.some((i) => i.itemId === 'step-input')
      const hasOutput = bundle.orderedItems.some((i) => i.itemId === 'step-output')

      expect(hasInput).toBe(hasOutput)
    })

    it('should keep backgroundRun and subagentRun together', () => {
      const backgroundRun = createMockItem({
        itemId: 'bg-run',
        sourceType: 'background_run_state',
        pairId: 'bg-pair-001',
        requiresPairIntegrity: true,
        estimatedTokens: 400,
      })
      const subagentRun = createMockItem({
        itemId: 'sub-run',
        sourceType: 'subagent_result',
        pairId: 'bg-pair-001',
        requiresPairIntegrity: true,
        estimatedTokens: 400,
      })

      const input = createMockInput({
        selectionPolicy: {
          targetMode: 'background',
          tokenBudget: 500,
        },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [backgroundRun, subagentRun],
        },
      })

      const bundle = manager.assemble(input)

      const hasBg = bundle.orderedItems.some((i) => i.itemId === 'bg-run')
      const hasSub = bundle.orderedItems.some((i) => i.itemId === 'sub-run')

      expect(hasBg).toBe(hasSub)
    })
  })

  describe('Context Views', () => {
    it('should include plan view when plan context is provided', () => {
      const input = createMockInput({
        planContext: {
          activePlan: {
            planId: 'plan-001',
            objective: 'Test objective',
            status: 'active',
            steps: [],
          },
          planContextView: {
            planId: 'plan-001',
            version: 1,
            objective: 'Test objective',
          },
        },
      })

      const bundle = manager.assemble(input)

      expect(bundle.planView).toBeDefined()
      expect(bundle.planView?.planId).toBe('plan-001')
    })

    it('should include workflow step view when workflow context is provided', () => {
      const input = createMockInput({
        workflowContext: {
          workflowId: 'wf-001',
          workflowRunId: 'wfrun-001',
          stepId: 'step-001',
          stepRunId: 'steprun-001',
          workflowStepContextView: {
            workflowId: 'wf-001',
            workflowRunId: 'wfrun-001',
            stepId: 'step-001',
            stepRunId: 'steprun-001',
            stepTitle: 'Test Step',
            stepType: 'agent_run',
          },
        },
      })

      const bundle = manager.assemble(input)

      expect(bundle.workflowStepView).toBeDefined()
      expect(bundle.workflowStepView?.stepId).toBe('step-001')
    })

    it('should include background run view when background context is provided', () => {
      const input = createMockInput({
        backgroundRunContext: {
          backgroundRunId: 'bg-001',
          subagentRunId: 'sub-001',
          backgroundRunContextView: {
            backgroundRunId: 'bg-001',
            subagentRunId: 'sub-001',
            subagentCode: 'test-agent',
            agentType: 'background',
            objective: 'Test objective',
            status: 'running',
          },
        },
      })

      const bundle = manager.assemble(input)

      expect(bundle.backgroundRunView).toBeDefined()
      expect(bundle.backgroundRunView?.backgroundRunId).toBe('bg-001')
    })

    it('should include trigger view when trigger context is provided', () => {
      const input = createMockInput({
        triggerContext: {
          triggerId: 'trig-001',
          triggerEvent: {
            eventId: 'evt-001',
            eventType: 'scheduled',
            source: 'scheduler',
          },
        },
      })

      const bundle = manager.assemble(input)

      expect(bundle.triggerView).toBeDefined()
      expect(bundle.triggerView?.eventId).toBe('evt-001')
    })
  })

  describe('Source Budgets', () => {
    it('should respect per-source token budgets', () => {
      const systemNotes = Array.from({ length: 5 }, (_, i) =>
        createMockItem({
          itemId: `sys-${i}`,
          sourceType: 'system_note',
          estimatedTokens: 500,
        }),
      )
      const memories = Array.from({ length: 5 }, (_, i) =>
        createMockItem({
          itemId: `mem-${i}`,
          sourceType: 'memory',
          estimatedTokens: 500,
        }),
      )

      const input = createMockInput({
        selectionPolicy: {
          targetMode: 'interactive',
          tokenBudget: 10000,
          sourceBudgets: {
            system_note: 1000,
            memory: 1000,
          },
        },
        hydratedState: {
          sessionId: 'session-001',
          userId: 'user-001',
          conversationHistory: [...systemNotes, ...memories],
        },
      })

      const bundle = manager.assemble(input)

      const systemTokens = bundle.orderedItems
        .filter((i) => i.sourceType === 'system_note')
        .reduce((sum, i) => sum + (i.estimatedTokens || 0), 0)
      const memoryTokens = bundle.orderedItems
        .filter((i) => i.sourceType === 'memory')
        .reduce((sum, i) => sum + (i.estimatedTokens || 0), 0)

      expect(systemTokens).toBeLessThanOrEqual(1000)
      expect(memoryTokens).toBeLessThanOrEqual(1000)
    })
  })

  describe('Selection Report', () => {
    it('should return a selection report', () => {
      const input = createMockInput()
      manager.assemble(input)
      const report = manager.getLastReport()

      expect(report).toBeDefined()
      expect(report?.runId).toBe(input.runId)
      expect(report?.tokenBudget).toBe(input.selectionPolicy.tokenBudget)
    })
  })

  describe('applyDelta', () => {
    it('should append delta items to internal store', () => {
      const delta = {
        runId: 'run-001',
        source: 'tool_result' as const,
        items: [
          createMockItem({ itemId: 'delta-1', content: 'Delta item 1' }),
          createMockItem({ itemId: 'delta-2', content: 'Delta item 2' }),
        ],
      }

      manager.applyDelta(delta)

      const items = manager.getItems()
      expect(items).toHaveLength(2)
      expect(items[0].itemId).toBe('delta-1')
      expect(items[1].itemId).toBe('delta-2')
    })

    it('should be safe no-op for empty delta items', () => {
      const delta = {
        runId: 'run-001',
        source: 'tool_result' as const,
        items: [],
      }

      manager.applyDelta(delta)

      expect(manager.getItems()).toHaveLength(0)
    })

    it('should accumulate items across multiple applyDelta calls', () => {
      manager.applyDelta({
        runId: 'run-001',
        source: 'tool_result' as const,
        items: [createMockItem({ itemId: 'a' })],
      })

      manager.applyDelta({
        runId: 'run-002',
        source: 'subagent_result' as const,
        items: [createMockItem({ itemId: 'b' })],
      })

      const items = manager.getItems()
      expect(items).toHaveLength(2)
      expect(items[0].itemId).toBe('a')
      expect(items[1].itemId).toBe('b')
    })
  })

  describe('addItem', () => {
    it('should add a single item', () => {
      manager.addItem(createMockItem({ itemId: 'single-1' }))
      const items = manager.getItems()
      expect(items).toHaveLength(1)
      expect(items[0].itemId).toBe('single-1')
    })
  })
})
