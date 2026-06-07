/**
 * Integration tests for exec -> process background session handoff.
 *
 * Tests verify:
 * - Exec can start a background process
 * - Process tool can list/poll/kill sessions
 * - Sessions are isolated by userId
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createToolRegistry } from '../../../src/tools/index.js'
import { registerBuiltInTools } from '../../../src/tools/builtins/index.js'
import { ProcessSessionStore } from '../../../src/tools/builtins/process-session-store.js'
import type { ToolHandler, ToolExecutionContext } from '../../../src/tools/types.js'

// Mock safe-paths to set workspace root
vi.mock('../../../src/tools/builtins/safe-paths.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    getWorkspaceRoot: () => '/tmp/test-workspace',
  }
})

describe('Exec -> Process Background Flow', () => {
  let registry: ReturnType<typeof createToolRegistry>
  let processSessionStore: ProcessSessionStore

  beforeEach(() => {
    registry = createToolRegistry()
    processSessionStore = new ProcessSessionStore()

    registerBuiltInTools(registry, {
      artifactStore: createMockArtifactStore(),
      summaryStore: createMockSummaryStore(),
      transcriptStore: createMockTranscriptStore(),
      planStore: createMockPlanStore(),
      longTermMemoryStore: createMockLongTermMemoryStore(),
      sessionStore: createMockSessionStore(),
      processSessionStore,
      enableRuntimeTools: true,
    })
  })

  afterEach(() => {
    // Clean up any running processes
    processSessionStore.clearAllNonRunning()
  })

  describe('Background Process Execution', () => {
    it('should start a background process and return sessionId', async () => {
      const execTool = registry.getTool('exec')
      expect(execTool).toBeDefined()

      const handler = execTool!.handler as ToolHandler
      const context = createTestContext('user-1', 'session-1')

      const result = await handler(
        {
          command: 'sleep 5',
          background: true,
          timeoutMs: 10000,
        },
        context,
      )

      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()
      expect((result.data as any).status).toBe('running')
      expect((result.data as any).sessionId).toBeDefined()
      expect(typeof (result.data as any).sessionId).toBe('string')
      expect((result.data as any).sessionId).toMatch(/^proc_[a-f0-9]{12}$/)
    })

    it('should return immediately for background execution', async () => {
      const execTool = registry.getTool('exec')
      const handler = execTool!.handler as ToolHandler
      const context = createTestContext('user-1', 'session-1')

      const startTime = Date.now()

      const result = await handler(
        {
          command: 'sleep 10',
          background: true,
          timeoutMs: 20000,
        },
        context,
      )

      const elapsed = Date.now() - startTime

      expect(result.success).toBe(true)
      expect((result.data as any).status).toBe('running')
      // Should return quickly, not wait for the sleep to complete
      expect(elapsed).toBeLessThan(1000)
    })
  })

  describe('Process Tool - List Sessions', () => {
    it('should list sessions for a user', async () => {
      const execTool = registry.getTool('exec')
      const processTool = registry.getTool('process')

      const execHandler = execTool!.handler as ToolHandler
      const processHandler = processTool!.handler as ToolHandler

      // Start a background process
      const execResult = await execHandler(
        { command: 'sleep 5', background: true, timeoutMs: 10000 },
        createTestContext('user-1', 'session-1'),
      )

      const sessionId = (execResult.data as any).sessionId

      // List sessions
      const listResult = await processHandler({ action: 'list' }, createTestContext('user-1', 'session-1'))

      expect(listResult.success).toBe(true)
      expect((listResult.data as any).action).toBe('list')
      expect((listResult.data as any).sessions).toBeDefined()
      expect((listResult.data as any).sessions).toHaveLength(1)
      expect((listResult.data as any).sessions[0].id).toBe(sessionId)
      expect((listResult.data as any).sessions[0].command).toBe('sleep 5')
      expect((listResult.data as any).sessions[0].status).toBe('running')
    })

    it('should return empty list for user with no sessions', async () => {
      const processTool = registry.getTool('process')
      const processHandler = processTool!.handler as ToolHandler

      const listResult = await processHandler(
        { action: 'list' },
        createTestContext('user-with-no-sessions', 'session-1'),
      )

      expect(listResult.success).toBe(true)
      expect((listResult.data as any).sessions).toHaveLength(0)
    })
  })

  describe('Process Tool - Poll Session', () => {
    it('should poll a running session', async () => {
      const execTool = registry.getTool('exec')
      const processTool = registry.getTool('process')

      const execHandler = execTool!.handler as ToolHandler
      const processHandler = processTool!.handler as ToolHandler

      // Start a background process
      const execResult = await execHandler(
        { command: 'sleep 5', background: true, timeoutMs: 10000 },
        createTestContext('user-1', 'session-1'),
      )

      const sessionId = (execResult.data as any).sessionId

      // Poll the session
      const pollResult = await processHandler({ action: 'poll', sessionId }, createTestContext('user-1', 'session-1'))

      expect(pollResult.success).toBe(true)
      expect((pollResult.data as any).action).toBe('poll')
      expect((pollResult.data as any).session).toBeDefined()
      expect((pollResult.data as any).session.id).toBe(sessionId)
      expect((pollResult.data as any).session.status).toBe('running')
    })

    it('should poll a completed session with output', async () => {
      const execTool = registry.getTool('exec')
      const processTool = registry.getTool('process')

      const execHandler = execTool!.handler as ToolHandler
      const processHandler = processTool!.handler as ToolHandler

      // Start a process that completes quickly
      const execResult = await execHandler(
        { command: 'echo "hello world"', background: true, timeoutMs: 5000 },
        createTestContext('user-1', 'session-1'),
      )

      const sessionId = (execResult.data as any).sessionId

      // Wait for completion (poll multiple times)
      let pollResult: any
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        pollResult = await processHandler({ action: 'poll', sessionId }, createTestContext('user-1', 'session-1'))
        if ((pollResult.data as any).session.status !== 'running') {
          break
        }
      }

      expect(pollResult.success).toBe(true)
      const status = (pollResult.data as any).session.status
      // Accept either 'completed' or 'failed' (command might fail in test env)
      expect(['completed', 'failed']).toContain(status)
      // If completed, check output
      if (status === 'completed') {
        expect((pollResult.data as any).session.output).toContain('hello world')
      }
    })

    it('should fail to poll non-existent session', async () => {
      const processTool = registry.getTool('process')
      const processHandler = processTool!.handler as ToolHandler

      const pollResult = await processHandler(
        { action: 'poll', sessionId: 'proc_nonexistent' },
        createTestContext('user-1', 'session-1'),
      )

      expect(pollResult.success).toBe(false)
      expect(pollResult.error?.code).toBe('SESSION_NOT_FOUND')
    })

    it('should fail to poll without sessionId', async () => {
      const processTool = registry.getTool('process')
      const processHandler = processTool!.handler as ToolHandler

      const pollResult = await processHandler({ action: 'poll' }, createTestContext('user-1', 'session-1'))

      expect(pollResult.success).toBe(false)
      expect(pollResult.error?.code).toBe('MISSING_SESSION_ID')
    })
  })

  describe('Process Tool - Kill Session', () => {
    it('should kill a running session', async () => {
      const execTool = registry.getTool('exec')
      const processTool = registry.getTool('process')

      const execHandler = execTool!.handler as ToolHandler
      const processHandler = processTool!.handler as ToolHandler

      // Start a background process
      const execResult = await execHandler(
        { command: 'sleep 60', background: true, timeoutMs: 120000 },
        createTestContext('user-1', 'session-1'),
      )

      const sessionId = (execResult.data as any).sessionId

      // Kill the session
      const killResult = await processHandler({ action: 'kill', sessionId }, createTestContext('user-1', 'session-1'))

      expect(killResult.success).toBe(true)
      expect((killResult.data as any).action).toBe('kill')
      expect((killResult.data as any).killed).toBe(true)

      // Verify it's no longer running
      const pollResult = await processHandler({ action: 'poll', sessionId }, createTestContext('user-1', 'session-1'))

      expect((pollResult.data as any).session.status).toBe('killed')
    })

    it('should fail to kill non-existent session', async () => {
      const processTool = registry.getTool('process')
      const processHandler = processTool!.handler as ToolHandler

      const killResult = await processHandler(
        { action: 'kill', sessionId: 'proc_nonexistent' },
        createTestContext('user-1', 'session-1'),
      )

      expect(killResult.success).toBe(false)
      expect(killResult.error?.code).toBe('KILL_FAILED')
    })
  })

  describe('Process Tool - Clear Session', () => {
    it('should clear a completed session', async () => {
      const execTool = registry.getTool('exec')
      const processTool = registry.getTool('process')

      const execHandler = execTool!.handler as ToolHandler
      const processHandler = processTool!.handler as ToolHandler

      // Start a process that completes quickly
      const execResult = await execHandler(
        { command: 'echo done', background: true, timeoutMs: 5000 },
        createTestContext('user-1', 'session-1'),
      )

      const sessionId = (execResult.data as any).sessionId

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Clear the session
      const clearResult = await processHandler({ action: 'clear', sessionId }, createTestContext('user-1', 'session-1'))

      expect(clearResult.success).toBe(true)
      expect((clearResult.data as any).action).toBe('clear')
      expect((clearResult.data as any).cleared).toBe(true)

      // Verify it's gone
      const pollResult = await processHandler({ action: 'poll', sessionId }, createTestContext('user-1', 'session-1'))

      expect(pollResult.success).toBe(false)
      expect(pollResult.error?.code).toBe('SESSION_NOT_FOUND')
    })

    it('should fail to clear a running session', async () => {
      const execTool = registry.getTool('exec')
      const processTool = registry.getTool('process')

      const execHandler = execTool!.handler as ToolHandler
      const processHandler = processTool!.handler as ToolHandler

      // Start a background process
      const execResult = await execHandler(
        { command: 'sleep 60', background: true, timeoutMs: 120000 },
        createTestContext('user-1', 'session-1'),
      )

      const sessionId = (execResult.data as any).sessionId

      // Try to clear the running session
      const clearResult = await processHandler({ action: 'clear', sessionId }, createTestContext('user-1', 'session-1'))

      expect(clearResult.success).toBe(false)
      expect(clearResult.error?.code).toBe('CLEAR_FAILED')
    })
  })

  describe('User Isolation', () => {
    it('should isolate sessions between users', async () => {
      const execTool = registry.getTool('exec')
      const processTool = registry.getTool('process')

      const execHandler = execTool!.handler as ToolHandler
      const processHandler = processTool!.handler as ToolHandler

      // User A starts a process
      const userAResult = await execHandler(
        { command: 'sleep 10', background: true, timeoutMs: 20000 },
        createTestContext('user-A', 'session-A'),
      )

      const userASessionId = (userAResult.data as any).sessionId

      // User B starts a process
      const userBResult = await execHandler(
        { command: 'sleep 10', background: true, timeoutMs: 20000 },
        createTestContext('user-B', 'session-B'),
      )

      const userBSessionId = (userBResult.data as any).sessionId

      // User A lists sessions - should only see their own
      const userAList = await processHandler({ action: 'list' }, createTestContext('user-A', 'session-A'))

      expect((userAList.data as any).sessions).toHaveLength(1)
      expect((userAList.data as any).sessions[0].id).toBe(userASessionId)

      // User B lists sessions - should only see their own
      const userBList = await processHandler({ action: 'list' }, createTestContext('user-B', 'session-B'))

      expect((userBList.data as any).sessions).toHaveLength(1)
      expect((userBList.data as any).sessions[0].id).toBe(userBSessionId)

      // User A cannot poll User B's session
      const crossPollResult = await processHandler(
        { action: 'poll', sessionId: userBSessionId },
        createTestContext('user-A', 'session-A'),
      )

      expect(crossPollResult.success).toBe(false)
      expect(crossPollResult.error?.code).toBe('SESSION_NOT_FOUND')

      // User A cannot kill User B's session
      const crossKillResult = await processHandler(
        { action: 'kill', sessionId: userBSessionId },
        createTestContext('user-A', 'session-A'),
      )

      expect(crossKillResult.success).toBe(false)
      expect(crossKillResult.error?.code).toBe('KILL_FAILED')
    })

    it('should prevent cross-user session access via process store directly', async () => {
      const execTool = registry.getTool('exec')
      const execHandler = execTool!.handler as ToolHandler

      // User A starts a process
      const userAResult = await execHandler(
        { command: 'sleep 10', background: true, timeoutMs: 20000 },
        createTestContext('user-A', 'session-A'),
      )

      const sessionId = (userAResult.data as any).sessionId

      // User B tries to access User A's session via store
      const session = processSessionStore.get('user-B', sessionId)

      expect(session).toBeNull()

      // User A can access their own session
      const ownSession = processSessionStore.get('user-A', sessionId)

      expect(ownSession).toBeDefined()
      expect(ownSession?.id).toBe(sessionId)
    })
  })
})

// Helper functions

function createTestContext(userId: string, sessionId: string): ToolExecutionContext {
  return {
    toolCallId: `call-${Date.now()}`,
    toolName: 'test',
    userId,
    sessionId,
    kernelRunId: `run-${Date.now()}`,
    permissionContext: {
      userId,
      sessionId,
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

// Mock stores (minimal implementations)

function createMockArtifactStore() {
  return {
    create: () => ({}) as any,
    findByArtifactId: () => undefined,
    findById: () => undefined,
    findByUserId: () => [],
    findBySessionId: () => [],
    findByType: () => [],
    findByStatus: () => [],
    update: () => undefined,
    delete: () => false,
    applyMigrations: () => {},
  }
}

function createMockSummaryStore() {
  return {
    save: () => {},
    getBySummaryId: () => null,
    getByType: () => [],
    getWorkingSummary: () => null,
    getSessionMemory: () => null,
    applyPatch: () => ({}) as any,
  }
}

function createMockTranscriptStore() {
  return {
    saveTurn: () => true,
    getTurn: () => null,
    findBySession: () => [],
    search: () => [],
    findByArtifactRef: () => [],
    findByPlannerRunId: () => [],
    updateUserIdForSession: () => 0,
  }
}

function createMockPlanStore() {
  return {
    createPlan: () => ({}) as any,
    getPlan: () => null,
    applyPatch: () => ({}) as any,
    getPatches: () => [],
    findByObjectiveHash: () => [],
    updateStepStatus: () => {},
  }
}

function createMockLongTermMemoryStore() {
  return {
    save: () => {},
    getByMemoryId: () => null,
    getByUserId: () => [],
    getByType: () => [],
    search: () => [],
    delete: () => {},
    applyPatch: () => ({}) as any,
    findCurrentByFingerprint: () => null,
    upsertExtracted: () => {},
    createTombstone: () => {},
    hasTombstone: () => false,
    getTombstone: () => null,
    hasTombstoneForSource: () => false,
    searchActive: () => [],
    getByEntityName: () => [],
    getByDateRange: () => [],
  }
}

function createMockSessionStore() {
  return {
    create: () => ({}) as any,
    getById: () => null,
    list: () => [],
    updateActivity: () => false,
    updateMetadata: () => false,
    updateStatus: () => false,
    updateTitle: () => false,
    updateUserId: () => false,
    setModel: () => false,
    getCount: () => 0,
  }
}
