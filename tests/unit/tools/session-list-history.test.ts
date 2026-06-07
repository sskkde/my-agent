import { describe, it, expect, beforeEach } from 'vitest'
import {
  createSessionListTool,
  type SessionListParams,
  type SessionListResult,
} from '../../../src/tools/builtins/session-list.js'
import {
  createSessionHistoryTool,
  type SessionHistoryParams,
  type SessionHistoryResult,
} from '../../../src/tools/builtins/session-history.js'
import type { SessionStore, Session } from '../../../src/storage/session-store.js'
import type { TranscriptStore, TurnTranscript } from '../../../src/storage/transcript-store.js'
import type { ToolExecutionContext } from '../../../src/tools/types.js'

function createMockSessionStore(): SessionStore {
  const sessions: Session[] = []

  return {
    create: (input) => {
      const session: Session = {
        sessionId: input.sessionId,
        userId: input.userId,
        title: input.title,
        status: input.status ?? 'active',
        messageCount: input.messageCount ?? 0,
        lastActivityAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: input.metadata,
      }
      sessions.push(session)
      return session
    },
    getById: (sessionId) => sessions.find((s) => s.sessionId === sessionId) ?? null,
    list: (options = {}) => {
      let filtered = [...sessions]
      if (options.userId) {
        filtered = filtered.filter((s) => s.userId === options.userId)
      }
      if (options.status) {
        filtered = filtered.filter((s) => s.status === options.status)
      }
      const offset = options.offset ?? 0
      const limit = options.limit ?? 100
      return filtered.slice(offset, offset + limit)
    },
    updateActivity: () => true,
    updateMetadata: () => true,
    updateStatus: () => true,
    updateTitle: () => true,
    updateUserId: () => true,
    setModel: () => true,
    getCount: (options = {}) => {
      let filtered = [...sessions]
      if (options.userId) {
        filtered = filtered.filter((s) => s.userId === options.userId)
      }
      if (options.status) {
        filtered = filtered.filter((s) => s.status === options.status)
      }
      return filtered.length
    },
  }
}

function createMockTranscriptStore(): TranscriptStore {
  const transcripts: TurnTranscript[] = []

  return {
    saveTurn: (transcript) => {
      transcripts.push(transcript)
      return true
    },
    getTurn: (turnId) => transcripts.find((t) => t.turnId === turnId) ?? null,
    findBySession: (sessionId, options = {}) => {
      let filtered = transcripts.filter((t) => t.sessionId === sessionId)
      const offset = options.offset ?? 0
      const limit = options.limit ?? 1000
      return filtered.slice(offset, offset + limit)
    },
    search: () => [],
    findByArtifactRef: () => [],
    findByPlannerRunId: () => [],
    updateUserIdForSession: () => 0,
  }
}

function createMockContext(userId: string): ToolExecutionContext {
  return {
    toolCallId: 'test-call-id',
    toolName: 'test-tool',
    userId,
    permissionContext: {
      userId,
      sessionId: 'test-session-id',
      mode: 'ask_on_write',
      grants: [],
    },
    executionStartTime: new Date().toISOString(),
    stores: {
      toolExecutionStore: {
        updateStatus: () => {},
        saveResult: () => {},
      },
    },
  }
}

describe('session_list tool', () => {
  let mockSessionStore: SessionStore
  let tool: ReturnType<typeof createSessionListTool>

  beforeEach(() => {
    mockSessionStore = createMockSessionStore()
    tool = createSessionListTool(mockSessionStore)
  })

  it('should list sessions for the current user only', async () => {
    mockSessionStore.create({ sessionId: 's1', userId: 'user-a', title: 'Session A' })
    mockSessionStore.create({ sessionId: 's2', userId: 'user-b', title: 'Session B' })
    mockSessionStore.create({ sessionId: 's3', userId: 'user-a', title: 'Session C' })

    const context = createMockContext('user-a')
    const result = await tool.handler({}, context)

    expect(result.success).toBe(true)
    const data = result.data as SessionListResult
    expect(data.sessions).toHaveLength(2)
    expect(data.sessions.map((s) => s.sessionId).sort()).toEqual(['s1', 's3'])
    expect(data.total).toBe(2)
  })

  it('should filter by status', async () => {
    mockSessionStore.create({ sessionId: 's1', userId: 'user-a', title: 'Active', status: 'active' })
    mockSessionStore.create({ sessionId: 's2', userId: 'user-a', title: 'Archived', status: 'archived' })

    const context = createMockContext('user-a')
    const result = await tool.handler({ status: 'active' } as SessionListParams, context)

    expect(result.success).toBe(true)
    const data = result.data as SessionListResult
    expect(data.sessions).toHaveLength(1)
    expect(data.sessions[0].sessionId).toBe('s1')
  })

  it('should respect limit and offset', async () => {
    for (let i = 0; i < 25; i++) {
      mockSessionStore.create({ sessionId: `s${i}`, userId: 'user-a', title: `Session ${i}` })
    }

    const context = createMockContext('user-a')
    const result = await tool.handler({ limit: 10, offset: 5 } as SessionListParams, context)

    expect(result.success).toBe(true)
    const data = result.data as SessionListResult
    expect(data.sessions).toHaveLength(10)
    expect(data.limit).toBe(10)
    expect(data.offset).toBe(5)
    expect(data.total).toBe(25)
  })

  it('should enforce max limit of 100', async () => {
    for (let i = 0; i < 150; i++) {
      mockSessionStore.create({ sessionId: `s${i}`, userId: 'user-a', title: `Session ${i}` })
    }

    const context = createMockContext('user-a')
    const result = await tool.handler({ limit: 150 } as SessionListParams, context)

    expect(result.success).toBe(true)
    const data = result.data as SessionListResult
    expect(data.limit).toBe(100)
    expect(data.sessions).toHaveLength(100)
  })

  it('should use default limit of 20', async () => {
    for (let i = 0; i < 50; i++) {
      mockSessionStore.create({ sessionId: `s${i}`, userId: 'user-a', title: `Session ${i}` })
    }

    const context = createMockContext('user-a')
    const result = await tool.handler({}, context)

    expect(result.success).toBe(true)
    const data = result.data as SessionListResult
    expect(data.limit).toBe(20)
    expect(data.sessions).toHaveLength(20)
  })

  it('should return empty array for user with no sessions', async () => {
    mockSessionStore.create({ sessionId: 's1', userId: 'user-b', title: 'Session B' })

    const context = createMockContext('user-a')
    const result = await tool.handler({}, context)

    expect(result.success).toBe(true)
    const data = result.data as SessionListResult
    expect(data.sessions).toHaveLength(0)
    expect(data.total).toBe(0)
  })

  it('should have correct tool metadata', () => {
    expect(tool.name).toBe('session_list')
    expect(tool.category).toBe('read')
    expect(tool.sensitivity).toBe('medium')
    expect(tool.schema.required).toEqual([])
  })
})

describe('session_history tool', () => {
  let mockSessionStore: SessionStore
  let mockTranscriptStore: TranscriptStore
  let tool: ReturnType<typeof createSessionHistoryTool>

  beforeEach(() => {
    mockSessionStore = createMockSessionStore()
    mockTranscriptStore = createMockTranscriptStore()
    tool = createSessionHistoryTool(mockSessionStore, mockTranscriptStore)
  })

  it('should retrieve history for a session owned by the user', async () => {
    mockSessionStore.create({ sessionId: 's1', userId: 'user-a', title: 'Session A', messageCount: 2 })
    mockTranscriptStore.saveTurn({
      turnId: 't1',
      sessionId: 's1',
      userId: 'user-a',
      input: { userMessageSummary: 'Hello' },
      output: { visibleMessages: [{ messageId: 'm1', role: 'user', content: 'Hello' }] },
      visibility: 'public',
      createdAt: '2024-01-01T00:00:00Z',
    })
    mockTranscriptStore.saveTurn({
      turnId: 't2',
      sessionId: 's1',
      userId: 'user-a',
      input: { userMessageSummary: 'How are you?' },
      output: { visibleMessages: [{ messageId: 'm2', role: 'assistant', content: 'I am well' }] },
      visibility: 'public',
      createdAt: '2024-01-01T00:01:00Z',
    })

    const context = createMockContext('user-a')
    const result = await tool.handler({ sessionId: 's1' } as SessionHistoryParams, context)

    expect(result.success).toBe(true)
    const data = result.data as SessionHistoryResult
    expect(data.sessionId).toBe('s1')
    expect(data.messages).toHaveLength(2)
    expect(data.total).toBe(2)
    expect(data.truncated).toBe(false)
  })

  it('should reject cross-user session access', async () => {
    mockSessionStore.create({ sessionId: 's1', userId: 'user-b', title: 'Session B' })

    const context = createMockContext('user-a')
    const result = await tool.handler({ sessionId: 's1' } as SessionHistoryParams, context)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('ACCESS_DENIED')
    expect(result.error?.message).toContain('another user')
  })

  it('should return error for non-existent session', async () => {
    const context = createMockContext('user-a')
    const result = await tool.handler({ sessionId: 'nonexistent' } as SessionHistoryParams, context)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('SESSION_NOT_FOUND')
  })

  it('should return error when sessionId is missing', async () => {
    const context = createMockContext('user-a')
    const result = await tool.handler({} as SessionHistoryParams, context)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('MISSING_SESSION_ID')
  })

  it('should respect limit and offset', async () => {
    mockSessionStore.create({ sessionId: 's1', userId: 'user-a', title: 'Session A', messageCount: 100 })
    for (let i = 0; i < 100; i++) {
      mockTranscriptStore.saveTurn({
        turnId: `t${i}`,
        sessionId: 's1',
        userId: 'user-a',
        input: { userMessageSummary: `Message ${i}` },
        output: { visibleMessages: [{ messageId: `m${i}`, role: 'user', content: `Message ${i}` }] },
        visibility: 'public',
        createdAt: `2024-01-01T00:00:${String(i).padStart(2, '0')}Z`,
      })
    }

    const context = createMockContext('user-a')
    const result = await tool.handler({ sessionId: 's1', limit: 10, offset: 5 } as SessionHistoryParams, context)

    expect(result.success).toBe(true)
    const data = result.data as SessionHistoryResult
    expect(data.messages).toHaveLength(10)
    expect(data.limit).toBe(10)
    expect(data.offset).toBe(5)
    expect(data.truncated).toBe(true)
  })

  it('should enforce max limit of 200', async () => {
    mockSessionStore.create({ sessionId: 's1', userId: 'user-a', title: 'Session A', messageCount: 300 })
    for (let i = 0; i < 300; i++) {
      mockTranscriptStore.saveTurn({
        turnId: `t${i}`,
        sessionId: 's1',
        userId: 'user-a',
        input: { userMessageSummary: `Message ${i}` },
        output: { visibleMessages: [{ messageId: `m${i}`, role: 'user', content: `Message ${i}` }] },
        visibility: 'public',
        createdAt: `2024-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`,
      })
    }

    const context = createMockContext('user-a')
    const result = await tool.handler({ sessionId: 's1', limit: 300 } as SessionHistoryParams, context)

    expect(result.success).toBe(true)
    const data = result.data as SessionHistoryResult
    expect(data.limit).toBe(200)
    expect(data.messages).toHaveLength(200)
  })

  it('should use default limit of 50', async () => {
    mockSessionStore.create({ sessionId: 's1', userId: 'user-a', title: 'Session A', messageCount: 100 })
    for (let i = 0; i < 100; i++) {
      mockTranscriptStore.saveTurn({
        turnId: `t${i}`,
        sessionId: 's1',
        userId: 'user-a',
        input: { userMessageSummary: `Message ${i}` },
        output: { visibleMessages: [{ messageId: `m${i}`, role: 'user', content: `Message ${i}` }] },
        visibility: 'public',
        createdAt: `2024-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`,
      })
    }

    const context = createMockContext('user-a')
    const result = await tool.handler({ sessionId: 's1' } as SessionHistoryParams, context)

    expect(result.success).toBe(true)
    const data = result.data as SessionHistoryResult
    expect(data.limit).toBe(50)
    expect(data.messages).toHaveLength(50)
  })

  it('should truncate long content in v1', async () => {
    mockSessionStore.create({ sessionId: 's1', userId: 'user-a', title: 'Session A', messageCount: 1 })
    const longContent = 'x'.repeat(600)
    mockTranscriptStore.saveTurn({
      turnId: 't1',
      sessionId: 's1',
      userId: 'user-a',
      input: {},
      output: { visibleMessages: [{ messageId: 'm1', role: 'user', content: longContent }] },
      visibility: 'public',
      createdAt: '2024-01-01T00:00:00Z',
    })

    const context = createMockContext('user-a')
    const result = await tool.handler({ sessionId: 's1' } as SessionHistoryParams, context)

    expect(result.success).toBe(true)
    const data = result.data as SessionHistoryResult
    expect(data.messages[0].summaryOrContent.length).toBeLessThan(600)
    expect(data.messages[0].summaryOrContent).toContain('...')
  })

  it('should have correct tool metadata', () => {
    expect(tool.name).toBe('session_history')
    expect(tool.category).toBe('read')
    expect(tool.sensitivity).toBe('medium')
    expect(tool.schema.required).toEqual(['sessionId'])
  })
})
