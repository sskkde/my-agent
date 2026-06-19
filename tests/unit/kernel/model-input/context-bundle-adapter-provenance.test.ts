import { describe, it, expect } from 'vitest'
import { projectBundleToData } from '../../../../src/kernel/model-input/context-bundle-adapter.js'
import type { ContextBundle, ContextItem } from '../../../../src/context/types.js'

function makeItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    itemId: 'item-1',
    sourceType: 'session_history',
    semanticType: 'fact',
    content: 'test content',
    ...overrides,
  }
}

function makeBundle(overrides: Partial<ContextBundle> = {}): ContextBundle {
  return {
    bundleId: 'bundle-1',
    runId: 'run-1',
    agentId: 'agent-1',
    agentType: 'main',
    userId: 'user-1',
    invocationSource: 'gateway_intent',
    pinnedItems: [],
    orderedItems: [],
    tokenEstimate: 100,
    ...overrides,
  }
}

describe('projectBundleToData - provenance preservation', () => {
  describe('item-level provenance', () => {
    it('preserves sourceType from ContextItem into ContextItemData', () => {
      const bundle = makeBundle({
        orderedItems: [makeItem({ sourceType: 'memory' })],
      })

      const result = projectBundleToData(bundle)

      expect(result.orderedItems![0].sourceType).toBe('memory')
    })

    it('preserves sourceRef from ContextItem into ContextItemData', () => {
      const bundle = makeBundle({
        orderedItems: [makeItem({ sourceRef: 'session/abc123' })],
      })

      const result = projectBundleToData(bundle)

      expect(result.orderedItems![0].sourceRef).toBe('session/abc123')
    })

    it('preserves freshnessTs from ContextItem into ContextItemData', () => {
      const bundle = makeBundle({
        orderedItems: [makeItem({ freshnessTs: '2026-06-19T10:00:00Z' })],
      })

      const result = projectBundleToData(bundle)

      expect(result.orderedItems![0].freshnessTs).toBe('2026-06-19T10:00:00Z')
    })

    it('preserves all provenance fields together on a single item', () => {
      const bundle = makeBundle({
        orderedItems: [
          makeItem({
            sourceType: 'tool_result',
            sourceRef: 'tool/exec-42',
            freshnessTs: '2026-06-19T12:30:00Z',
          }),
        ],
      })

      const result = projectBundleToData(bundle)
      const item = result.orderedItems![0]

      expect(item.sourceType).toBe('tool_result')
      expect(item.sourceRef).toBe('tool/exec-42')
      expect(item.freshnessTs).toBe('2026-06-19T12:30:00Z')
    })

    it('preserves provenance on pinnedItems', () => {
      const bundle = makeBundle({
        pinnedItems: [makeItem({ itemId: 'pin-1', sourceType: 'system_note', sourceRef: 'system/init' })],
      })

      const result = projectBundleToData(bundle)

      expect(result.pinnedItems![0].sourceType).toBe('system_note')
      expect(result.pinnedItems![0].sourceRef).toBe('system/init')
    })

    it('preserves provenance on summaryBlocks', () => {
      const bundle = makeBundle({
        summaryBlocks: [makeItem({ itemId: 'sum-1', sourceType: 'conversation_state', freshnessTs: '2026-06-18T00:00:00Z' })],
      })

      const result = projectBundleToData(bundle)

      expect(result.summaryBlocks![0].sourceType).toBe('conversation_state')
      expect(result.summaryBlocks![0].freshnessTs).toBe('2026-06-18T00:00:00Z')
    })
  })

  describe('bundle-level provenance', () => {
    it('preserves invocationSource from ContextBundle into ContextBundleData', () => {
      const bundle = makeBundle({ invocationSource: 'planner_execution' })

      const result = projectBundleToData(bundle)

      expect(result.invocationSource).toBe('planner_execution')
    })

    it('preserves all invocationSource variants', () => {
      const sources = [
        'gateway_intent',
        'planner_execution',
        'workflow_step',
        'subagent_runtime',
        'background_subagent',
        'event_trigger_resume',
        'system',
      ] as const

      for (const source of sources) {
        const bundle = makeBundle({ invocationSource: source })
        const result = projectBundleToData(bundle)
        expect(result.invocationSource).toBe(source)
      }
    })
  })

  describe('edge case: item with no provenance fields', () => {
    it('renders stable output when sourceType is present but sourceRef and freshnessTs are absent', () => {
      const bundle = makeBundle({
        orderedItems: [
          makeItem({ sourceType: 'session_history', sourceRef: undefined, freshnessTs: undefined }),
        ],
      })

      const result = projectBundleToData(bundle)
      const item = result.orderedItems![0]

      expect(item.sourceType).toBe('session_history')
      expect(item.sourceRef).toBeUndefined()
      expect(item.freshnessTs).toBeUndefined()
    })

    it('does not break existing item fields when provenance is added', () => {
      const bundle = makeBundle({
        orderedItems: [
          makeItem({
            itemId: 'stable-id',
            content: 'stable content',
            semanticType: 'instruction',
            isPinned: true,
            requiresPairIntegrity: true,
            pairId: 'pair-1',
            sourceType: 'memory',
            sourceRef: 'mem/ref',
            freshnessTs: '2026-06-19T00:00:00Z',
          }),
        ],
      })

      const result = projectBundleToData(bundle)
      const item = result.orderedItems![0]

      expect(item.itemId).toBe('stable-id')
      expect(item.content).toBe('stable content')
      expect(item.semanticType).toBe('instruction')
      expect(item.isPinned).toBe(true)
      expect(item.requiresPairIntegrity).toBe(true)
      expect(item.pairId).toBe('pair-1')
      expect(item.sourceType).toBe('memory')
      expect(item.sourceRef).toBe('mem/ref')
      expect(item.freshnessTs).toBe('2026-06-19T00:00:00Z')
    })
  })

  describe('provenance does not break existing adapter behavior', () => {
    it('planView is still formatted correctly with provenance items', () => {
      const bundle = makeBundle({
        orderedItems: [makeItem({ sourceType: 'plan_state' })],
        planView: {
          planId: 'plan-1',
          objective: 'Test plan',
          version: 1,
          currentStep: { stepId: 'step-1', title: 'Step 1', description: 'Do thing' },
        },
      })

      const result = projectBundleToData(bundle)

      expect(result.planView).toContain('Plan: Test plan')
      expect(result.orderedItems![0].sourceType).toBe('plan_state')
    })

    it('workflowStepView is still formatted correctly', () => {
      const bundle = makeBundle({
        orderedItems: [makeItem({ sourceType: 'workflow_state' })],
        workflowStepView: {
          workflowId: 'wf-1',
          workflowRunId: 'wfr-1',
          stepId: 'step-1',
          stepRunId: 'sr-1',
          stepTitle: 'Execute',
          stepType: 'tool_call',
        },
      })

      const result = projectBundleToData(bundle)

      expect(result.workflowStepView).toContain('Workflow: Execute')
      expect(result.orderedItems![0].sourceType).toBe('workflow_state')
    })

    it('backgroundRunView is still formatted correctly', () => {
      const bundle = makeBundle({
        backgroundRunView: {
          backgroundRunId: 'br-1',
          subagentRunId: 'sr-1',
          subagentCode: 'research',
          agentType: 'subagent',
          objective: 'Background task',
          status: 'running',
        },
      })

      const result = projectBundleToData(bundle)

      expect(result.backgroundRunView).toContain('Background Run: Background task')
    })

    it('triggerView is still formatted correctly', () => {
      const bundle = makeBundle({
        triggerView: {
          eventId: 'evt-1',
          eventType: 'webhook',
          source: 'webhook',
        },
      })

      const result = projectBundleToData(bundle)

      expect(result.triggerView).toContain('Trigger: webhook')
    })
  })
})
