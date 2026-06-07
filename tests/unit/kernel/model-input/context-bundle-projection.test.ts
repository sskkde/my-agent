import { describe, it, expect } from 'vitest'
import {
  projectContextBundle,
  type DynamicFields,
} from '../../../../src/kernel/model-input/context-bundle-projection.js'
import type { ContextBundleData } from '../../../../src/kernel/model-input/model-input-types.js'

describe('projectContextBundle', () => {
  describe('full ContextBundle projection', () => {
    it('projects all fields with correct roles and order', () => {
      const bundle: ContextBundleData = {
        pinnedItems: [{ itemId: 'p1', content: 'Pinned instruction', semanticType: 'instruction' }],
        orderedItems: [{ itemId: 'o1', content: 'Some fact', semanticType: 'fact' }],
        planView: 'Plan: Analyze requirements',
        workflowStepView: 'Workflow step: Execute',
        backgroundRunView: 'Background run: Processing data',
        triggerView: 'Trigger: Webhook received',
        summaryBlocks: [{ itemId: 's1', content: 'Summary of prior turns', semanticType: 'summary' }],
        transcript: [
          { role: 'assistant', content: 'Previous assistant message' },
          { role: 'tool', content: '{"result": 42}', toolCallId: 'tc1' },
        ],
      }

      const dynamic: DynamicFields = {
        currentDate: '2026-05-23',
        sessionId: 'sess-1',
        runId: 'run-1',
        messageId: 'msg-1',
      }

      const result = projectContextBundle(bundle, dynamic, 'Hello, help me!')

      const messages = result.messages

      // 1. pinnedItems
      expect(messages[0]).toEqual({ role: 'system', content: 'Pinned instruction' })

      // 2. orderedItems
      expect(messages[1]).toEqual({ role: 'user', content: 'Some fact' })

      // 3. planView → system
      expect(messages[2]).toEqual({ role: 'system', content: 'Plan: Analyze requirements' })

      // 4. workflowStepView → system
      expect(messages[3]).toEqual({ role: 'system', content: 'Workflow step: Execute' })

      // 5. backgroundRunView → system
      expect(messages[4]).toEqual({ role: 'system', content: 'Background run: Processing data' })

      // 6. triggerView → user
      expect(messages[5]).toEqual({ role: 'user', content: 'Trigger: Webhook received' })

      // 7. summaryBlocks → assistant
      expect(messages[6]).toEqual({ role: 'assistant', content: 'Summary of prior turns' })

      // 8. transcript
      expect(messages[7]).toEqual({ role: 'assistant', content: 'Previous assistant message' })
      expect(messages[8]).toEqual({ role: 'tool', content: '{"result": 42}', toolCallId: 'tc1' })

      // 9. dynamic fields → system
      expect(messages[9]).toEqual({
        role: 'system',
        content: 'Current Date: 2026-05-23\nSession ID: sess-1\nRun ID: run-1\nMessage ID: msg-1',
      })

      // 10. currentUserMessage → ALWAYS last
      expect(messages[10]).toEqual({ role: 'user', content: 'Hello, help me!' })
    })
  })

  describe('empty ContextBundle', () => {
    it('returns only currentUserMessage when bundle is empty', () => {
      const result = projectContextBundle({}, {}, 'Just this message')
      expect(result.messages).toEqual([{ role: 'user', content: 'Just this message' }])
    })

    it('returns empty messages array when nothing is provided', () => {
      const result = projectContextBundle({}, {})
      expect(result.messages).toEqual([])
    })
  })

  describe('semanticType role mapping in projection', () => {
    it('constraint items map to system', () => {
      const bundle: ContextBundleData = {
        orderedItems: [{ itemId: 'c1', content: 'Must follow rule', semanticType: 'constraint' }],
      }
      const result = projectContextBundle(bundle, {})
      expect(result.messages[0].role).toBe('system')
    })

    it('draft items map to assistant', () => {
      const bundle: ContextBundleData = {
        orderedItems: [{ itemId: 'd1', content: 'Draft text', semanticType: 'draft' }],
      }
      const result = projectContextBundle(bundle, {})
      expect(result.messages[0].role).toBe('assistant')
    })

    it('summary items map to assistant', () => {
      const bundle: ContextBundleData = {
        summaryBlocks: [{ itemId: 's1', content: 'Summary text', semanticType: 'summary' }],
      }
      const result = projectContextBundle(bundle, {})
      expect(result.messages[0].role).toBe('assistant')
    })

    it('plan_view items map to system', () => {
      const bundle: ContextBundleData = {
        orderedItems: [{ itemId: 'p1', content: 'Plan step', semanticType: 'plan_view' }],
      }
      const result = projectContextBundle(bundle, {})
      expect(result.messages[0].role).toBe('system')
    })
  })

  describe('optional field ordering is deterministic', () => {
    it('always produces planView → workflowStepView → backgroundRunView → triggerView → summaryBlocks', () => {
      const bundle: ContextBundleData = {
        triggerView: 'Trigger last before summary',
        planView: 'Plan first',
        backgroundRunView: 'Background third',
        summaryBlocks: [{ itemId: 's1', content: 'Summary at end', semanticType: 'summary' }],
        workflowStepView: 'Workflow second',
      }

      const result = projectContextBundle(bundle, {})

      const roles = result.messages.map((m) => m.content)
      expect(roles.indexOf('Plan first')).toBeLessThan(roles.indexOf('Workflow second'))
      expect(roles.indexOf('Workflow second')).toBeLessThan(roles.indexOf('Background third'))
      expect(roles.indexOf('Background third')).toBeLessThan(roles.indexOf('Trigger last before summary'))
      expect(roles.indexOf('Trigger last before summary')).toBeLessThan(roles.indexOf('Summary at end'))
    })
  })

  describe('pair integrity', () => {
    it('removes incomplete pairs from output', () => {
      const bundle: ContextBundleData = {
        orderedItems: [
          { itemId: 'q1', content: 'Question', semanticType: 'fact', requiresPairIntegrity: true, pairId: 'p1' },
          { itemId: 'standalone', content: 'Standalone', semanticType: 'fact' },
        ],
      }

      const result = projectContextBundle(bundle, {})
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].content).toBe('Standalone')
      expect(result.pairMarkers).toHaveLength(1)
    })

    it('keeps complete pairs', () => {
      const bundle: ContextBundleData = {
        orderedItems: [
          { itemId: 'q1', content: 'Question', semanticType: 'fact', requiresPairIntegrity: true, pairId: 'p1' },
          { itemId: 'a1', content: 'Answer', semanticType: 'summary', requiresPairIntegrity: true, pairId: 'p1' },
        ],
      }

      const result = projectContextBundle(bundle, {})
      expect(result.messages).toHaveLength(2)
      expect(result.messages[0].content).toBe('Question')
      expect(result.messages[1].content).toBe('Answer')
    })
  })

  describe('dynamic fields', () => {
    it('renders dynamic fields in a single system message before currentUserMessage', () => {
      const bundle: ContextBundleData = {}
      const dynamic: DynamicFields = {
        currentDate: '2026-05-23',
        sessionId: 'sess-1',
        runId: 'run-1',
        messageId: 'msg-1',
      }

      const result = projectContextBundle(bundle, dynamic, 'User query')

      const lastIdx = result.messages.length - 1
      expect(result.messages[lastIdx]).toEqual({ role: 'user', content: 'User query' })
      expect(result.messages[lastIdx - 1].role).toBe('system')
      expect(result.messages[lastIdx - 1].content).toContain('Current Date: 2026-05-23')
      expect(result.messages[lastIdx - 1].content).toContain('Session ID: sess-1')
    })

    it('does not produce dynamic fields message when all are undefined', () => {
      const result = projectContextBundle({}, {}, 'User message')
      expect(result.messages).toEqual([{ role: 'user', content: 'User message' }])
    })
  })

  describe('currentUserMessage positioning', () => {
    it('currentUserMessage is ALWAYS the last message', () => {
      const bundle: ContextBundleData = {
        pinnedItems: [{ itemId: 'p1', content: 'Pinned', semanticType: 'instruction' }],
        summaryBlocks: [{ itemId: 's1', content: 'Summary', semanticType: 'summary' }],
        transcript: [{ role: 'assistant', content: 'Prior response' }],
      }

      const result = projectContextBundle(bundle, { runId: 'r1' }, 'Final user message')
      const last = result.messages[result.messages.length - 1]
      expect(last).toEqual({ role: 'user', content: 'Final user message' })
    })
  })
})
