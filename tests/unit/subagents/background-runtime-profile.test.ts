import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { BackgroundRunStore, BackgroundRun } from '../../../src/storage/background-run-store.js'
import type { EventRecord } from '../../../src/storage/event-store.js'
import type { BackgroundRunInput } from '../../../src/subagents/background-runtime.js'
import { createBackgroundRuntime } from '../../../src/subagents/background-runtime.js'

function createMockBackgroundRunStore(): BackgroundRunStore {
  const runs = new Map<string, BackgroundRun>()
  return {
    create: vi.fn((run) => {
      const fullRun: BackgroundRun = {
        ...run,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        retryCount: run.retryCount ?? 0,
      }
      runs.set(run.backgroundRunId, fullRun)
    }),
    getById: vi.fn((id) => runs.get(id) ?? null),
    updateStatus: vi.fn((id, status) => {
      const run = runs.get(id)
      if (run) {
        run.status = status
        run.updatedAt = new Date().toISOString()
      }
    }),
    saveCheckpoint: vi.fn((id, checkpoint) => {
      const run = runs.get(id)
      if (run) {
        run.checkpointData = checkpoint
        run.updatedAt = new Date().toISOString()
      }
    }),
    saveRecoveryPoint: vi.fn(),
    saveResult: vi.fn(),
    incrementRetryCount: vi.fn(),
    getByUserAndStatus: vi.fn(() => []),
    getBySessionAndStatus: vi.fn(() => []),
    getBySubagentRunId: vi.fn(() => []),
    getByLaunchSource: vi.fn(() => []),
    getByStatus: vi.fn(() => []),
    getExpiredRuns: vi.fn(() => []),
  }
}

function createMockEventStore() {
  const events: EventRecord[] = []
  return {
    append: vi.fn((event) => {
      const evts = Array.isArray(event) ? event : [event]
      events.push(...evts)
    }),
    query: vi.fn(() => []),
    findByCorrelationId: vi.fn(() => []),
    findByCausationId: vi.fn(() => []),
    updateUserIdForSession: vi.fn(() => 0),
    events,
  }
}

describe('BackgroundRuntime agentProfile selection', () => {
  let backgroundRunStore: BackgroundRunStore
  let eventStore: ReturnType<typeof createMockEventStore>
  let runtime: ReturnType<typeof createBackgroundRuntime>

  beforeEach(() => {
    backgroundRunStore = createMockBackgroundRunStore()
    eventStore = createMockEventStore()
    runtime = createBackgroundRuntime({
      backgroundRunStore,
      eventStore,
      maxConcurrentRuns: 5,
      watchdogTimeoutMs: 10000,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should default agentProfile to agentType when only agentType is provided', () => {
    const input: BackgroundRunInput = {
      userId: 'user-1',
      agentType: 'document_processor',
      taskSpec: { objective: 'Process document' },
      launchSource: 'test',
    }

    const bgRunId = runtime.enqueueBackgroundRun(input)
    const run = runtime.getBackgroundRun(bgRunId)

    expect(run).not.toBeNull()
    expect(run!.agentType).toBe('document_processor')
    expect(run!.agentProfile).toBe('document_processor')
  })

  it('should use agentProfile when explicitly provided', () => {
    const input: BackgroundRunInput = {
      userId: 'user-1',
      agentType: 'document_processor',
      agentProfile: 'specialized_doc_agent',
      taskSpec: { objective: 'Process document' },
      launchSource: 'test',
    }

    const bgRunId = runtime.enqueueBackgroundRun(input)
    const run = runtime.getBackgroundRun(bgRunId)

    expect(run).not.toBeNull()
    expect(run!.agentType).toBe('document_processor')
    expect(run!.agentProfile).toBe('specialized_doc_agent')
  })

  it('should produce same agentProfile from legacy subagentType-equivalent and new agentProfile', () => {
    const legacyInput: BackgroundRunInput = {
      userId: 'user-1',
      agentType: 'research_agent',
      taskSpec: { objective: 'Research topic' },
      launchSource: 'test',
    }

    const newInput: BackgroundRunInput = {
      userId: 'user-1',
      agentType: 'research_agent',
      agentProfile: 'research_agent',
      taskSpec: { objective: 'Research topic' },
      launchSource: 'test',
    }

    const legacyId = runtime.enqueueBackgroundRun(legacyInput)
    const newId = runtime.enqueueBackgroundRun(newInput)

    const legacyRun = runtime.getBackgroundRun(legacyId)
    const newRun = runtime.getBackgroundRun(newId)

    expect(legacyRun!.agentProfile).toBe('research_agent')
    expect(newRun!.agentProfile).toBe('research_agent')
    expect(legacyRun!.agentProfile).toBe(newRun!.agentProfile)
  })

  it('should preserve agentProfile through lifecycle transitions', async () => {
    const input: BackgroundRunInput = {
      userId: 'user-1',
      agentType: 'document_processor',
      agentProfile: 'custom_profile',
      taskSpec: { objective: 'Process document' },
      launchSource: 'test',
    }

    const bgRunId = runtime.enqueueBackgroundRun(input)
    expect(runtime.getBackgroundRun(bgRunId)!.agentProfile).toBe('custom_profile')

    await runtime.startBackgroundRun(bgRunId)
    expect(runtime.getBackgroundRun(bgRunId)!.agentProfile).toBe('custom_profile')
    expect(runtime.getBackgroundRun(bgRunId)!.status).toBe('running')
  })

  it('should not break pending background runs created before migration (no agentProfile)', () => {
    const input: BackgroundRunInput = {
      userId: 'user-1',
      agentType: 'legacy_agent',
      taskSpec: { objective: 'Legacy task' },
      launchSource: 'test',
    }

    const bgRunId = runtime.enqueueBackgroundRun(input)
    const run = runtime.getBackgroundRun(bgRunId)

    expect(run).not.toBeNull()
    expect(run!.agentType).toBe('legacy_agent')
    expect(run!.agentProfile).toBe('legacy_agent')
    expect(run!.status).toBe('queued')
  })
})
