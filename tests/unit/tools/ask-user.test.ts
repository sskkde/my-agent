import { describe, it, expect, vi } from 'vitest'
import {
  createAskUserTool,
  type AskUserApprovalInput,
  type AskUserApprovalOutput,
} from '../../../src/tools/builtins/ask-user.js'
import type { ToolExecutionContext } from '../../../src/tools/types.js'

function createToolContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  const userId = overrides.userId ?? 'user-123'
  return {
    toolCallId: 'test-call-id',
    toolName: 'ask_user',
    userId,
    sessionId: overrides.sessionId ?? 'session-abc',
    permissionContext: {
      userId,
      sessionId: overrides.sessionId ?? 'session-abc',
    } as ToolExecutionContext['permissionContext'],
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

describe('ask-user tool', () => {
  describe('with injected createUserQuestionApproval', () => {
    it('invokes approval callback once with userId, sessionId, question, context, requestId', async () => {
      const approvalCreator = vi.fn(
        (_input: AskUserApprovalInput): AskUserApprovalOutput => ({ requestId: 'pre-returned' }),
      )
      const tool = createAskUserTool({ createUserQuestionApproval: approvalCreator })

      const result = await tool.handler(
        { question: 'What is the goal?', context: 'planning phase' },
        createToolContext({ userId: 'user-777', sessionId: 'sess-999' }),
      )

      expect(result.success).toBe(true)
      expect(approvalCreator).toHaveBeenCalledTimes(1)
      const callArg = approvalCreator.mock.calls[0]![0]
      expect(callArg).toMatchObject({
        userId: 'user-777',
        sessionId: 'sess-999',
        question: 'What is the goal?',
        context: 'planning phase',
      })
      expect(callArg.requestId).toMatch(/^ask_\d+_[a-z0-9]+$/)
    })

    it('structuredContent contains status pending_approval and requestId', async () => {
      const approvalCreator = vi.fn()
      const tool = createAskUserTool({ createUserQuestionApproval: approvalCreator })

      const result = await tool.handler(
        { question: 'Continue?' },
        createToolContext(),
      )

      expect(result.success).toBe(true)
      const structured = result.structuredContent as Record<string, unknown>
      expect(structured.status).toBe('pending_approval')
      expect(typeof structured.requestId).toBe('string')
      expect(structured.requestId).toMatch(/^ask_\d+_[a-z0-9]+$/)
      expect(structured.question).toBe('Continue?')
      expect(typeof structured.timestamp).toBe('string')
    })

    it('still emits user_question_raised event', async () => {
      const approvalCreator = vi.fn()
      const tool = createAskUserTool({ createUserQuestionApproval: approvalCreator })

      const result = await tool.handler(
        { question: 'Pick a color?' },
        createToolContext(),
      )

      expect(result.events).toBeDefined()
      expect(result.events!.length).toBe(1)
      const evt = result.events![0]
      expect(evt.eventType).toBe('user_question_raised')
      expect(evt.payload.requestId).toBeDefined()
      expect(evt.payload.question).toBe('Pick a color?')
    })
  })

  describe('without deps injected', () => {
    it('handler still succeeds and structuredContent still pending_approval', async () => {
      const tool = createAskUserTool()

      const result = await tool.handler(
        { question: 'Standalone question?' },
        createToolContext(),
      )

      expect(result.success).toBe(true)
      const structured = result.structuredContent as Record<string, unknown>
      expect(structured.status).toBe('pending_approval')
      expect(structured.requestId).toMatch(/^ask_\d+_[a-z0-9]+$/)
      expect(result.events).toBeDefined()
      expect(result.events!.length).toBe(1)
    })

    it('creates a tool with name ask_user, category internal, sensitivity low', () => {
      const tool = createAskUserTool()
      expect(tool.name).toBe('ask_user')
      expect(tool.category).toBe('internal')
      expect(tool.sensitivity).toBe('low')
      expect(tool.schema.required).toEqual(['question'])
    })
  })

  describe('validation', () => {
    it('missing question returns MISSING_REQUIRED_FIELD and does NOT call approval callback', async () => {
      const approvalCreator = vi.fn()
      const tool = createAskUserTool({ createUserQuestionApproval: approvalCreator })

      const result = await tool.handler({}, createToolContext())

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('MISSING_REQUIRED_FIELD')
      expect(result.error?.recoverable).toBe(true)
      expect(approvalCreator).not.toHaveBeenCalled()
    })
  })

  describe('error resilience', () => {
    it('if approval callback throws, handler still succeeds with event and pending_approval', async () => {
      const approvalCreator = vi.fn(() => {
        throw new Error('approval store exploded')
      })
      const tool = createAskUserTool({ createUserQuestionApproval: approvalCreator })

      const result = await tool.handler(
        { question: 'Resilient question?' },
        createToolContext(),
      )

      expect(result.success).toBe(true)
      expect(approvalCreator).toHaveBeenCalledTimes(1)
      const structured = result.structuredContent as Record<string, unknown>
      expect(structured.status).toBe('pending_approval')
      expect(structured.requestId).toMatch(/^ask_\d+_[a-z0-9]+$/)
      expect(result.events).toBeDefined()
      expect(result.events![0]!.eventType).toBe('user_question_raised')
    })
  })
})
