import { describe, it, expect, vi } from 'vitest'
import {
  ASK_USER_TOOL_ID,
  handleAskUser,
  type AskUserDeps,
  type AskUserInput,
} from '../../../../src/foreground/tools/ask-user-tool.js'
import type { AskStore, AskRequest, CreateAskRequest } from '../../../../src/storage/ask-store.js'
import { ASK_STATES } from '../../../../src/storage/ask-store.js'

function createMockAskStore(): AskStore {
  const asks = new Map<string, AskRequest>()

  return {
    create: vi.fn((request: CreateAskRequest): AskRequest => {
      const ask: AskRequest = {
        id: request.id,
        userId: request.userId,
        sessionId: request.sessionId,
        status: request.status,
        question: request.question,
        options: request.options ?? null,
        multiSelect: request.multiSelect ?? false,
        context: request.context ?? null,
        answers: request.answers ?? null,
        requestedBy: request.requestedBy,
        requestedAt: request.requestedAt,
        respondedAt: request.respondedAt ?? null,
        responseBy: request.responseBy ?? null,
        responseClaimedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      asks.set(ask.id, ask)
      return ask
    }),
    getById: vi.fn((id: string): AskRequest | null => {
      return asks.get(id) ?? null
    }),
    update: vi.fn(),
    findByUser: vi.fn(),
    findPendingByUser: vi.fn(),
    claimResponse: vi.fn().mockReturnValue(true),
    unclaimResponse: vi.fn(),
    delete: vi.fn(),
  }
}

function createMockDeps(overrides?: Partial<AskUserDeps>): AskUserDeps {
  return {
    askStore: createMockAskStore(),
    userId: 'user-123',
    sessionId: 'session-456',
    turnId: 'turn-789',
    ...overrides,
  }
}

describe('AskUserTool', () => {
  describe('ASK_USER_TOOL_ID', () => {
    it('should have the correct tool ID', () => {
      expect(ASK_USER_TOOL_ID).toBe('ask_user')
    })
  })

  describe('handleAskUser', () => {
    it('persists a pending ask and returns its id', async () => {
      const deps = createMockDeps()
      const input: AskUserInput = {
        question: 'Which city should I book the hotel in?',
        options: [
          { value: 'shanghai', label: 'Shanghai' },
          { value: 'beijing', label: 'Beijing' },
        ],
        multiSelect: false,
        context: 'Trip planning',
      }

      const result = await handleAskUser(deps, input)

      expect(result.success).toBe(true)
      expect(result.data?.status).toBe('pending')
      expect(result.data?.askId).toMatch(/^ask_/)
      expect(result.data?.question).toBe('Which city should I book the hotel in?')
      expect(result.userVisibleSummary).toContain('Waiting for their answer')
      expect(deps.askStore.create).toHaveBeenCalledTimes(1)

      const createCall = vi.mocked(deps.askStore.create).mock.calls[0][0] as CreateAskRequest
      expect(createCall.userId).toBe('user-123')
      expect(createCall.sessionId).toBe('session-456')
      expect(createCall.status).toBe(ASK_STATES.PENDING)
      expect(createCall.question).toBe('Which city should I book the hotel in?')
      expect(createCall.options).toEqual([
        { value: 'shanghai', label: 'Shanghai' },
        { value: 'beijing', label: 'Beijing' },
      ])
      expect(createCall.multiSelect).toBe(false)
      expect(createCall.context).toBe('Trip planning')
    })

    it('omits optional fields when not provided', async () => {
      const deps = createMockDeps()
      const input: AskUserInput = { question: 'Just a question' }

      const result = await handleAskUser(deps, input)

      expect(result.success).toBe(true)
      const createCall = vi.mocked(deps.askStore.create).mock.calls[0][0] as CreateAskRequest
      expect(createCall.options).toBeNull()
      expect(createCall.multiSelect).toBe(false)
      expect(createCall.context).toBeNull()
    })

    it('rejects an empty question', async () => {
      const deps = createMockDeps()
      const input: AskUserInput = { question: '' }

      const result = await handleAskUser(deps, input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_ASK_QUESTION')
      expect(result.error?.recoverable).toBe(true)
      expect(result.userVisibleSummary).toContain('Question is required')
      expect(deps.askStore.create).not.toHaveBeenCalled()
    })

    it('rejects a whitespace-only question', async () => {
      const deps = createMockDeps()
      const input: AskUserInput = { question: '   ' }

      const result = await handleAskUser(deps, input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_ASK_QUESTION')
      expect(deps.askStore.create).not.toHaveBeenCalled()
    })

    it('handles ask store errors gracefully', async () => {
      const failingStore = createMockAskStore()
      failingStore.create = vi.fn(() => {
        throw new Error('Database connection failed')
      })
      const deps = createMockDeps({ askStore: failingStore })
      const input: AskUserInput = { question: 'Question that fails' }

      const result = await handleAskUser(deps, input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('ASK_STORE_ERROR')
      expect(result.error?.recoverable).toBe(true)
    })
  })
})
