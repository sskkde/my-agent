import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import { createSummaryStore, type SummaryStore } from '../../../src/storage/summary-store.js'
import {
  createTranscriptStore,
  type TranscriptStore,
  type TurnTranscript,
} from '../../../src/storage/transcript-store.js'
import {
  createRollingSummaryScheduler,
  type RollingSummaryScheduler,
} from '../../../src/memory/rolling-summary-scheduler.js'
import type { LLMAdapter } from '../../../src/llm/adapter.js'

function makeTurn(turnId: string, userText: string, assistantText: string): TurnTranscript {
  return {
    turnId,
    sessionId: 'session-rs',
    userId: 'user-1',
    input: { userMessageSummary: userText },
    output: {
      visibleMessages:
        assistantText.length > 0 ? [{ messageId: `m-${turnId}`, role: 'assistant', content: assistantText }] : [],
    },
    visibility: 'public',
    createdAt: new Date().toISOString(),
  }
}

describe('Rolling Summary Scheduler Integration', () => {
  let connection: ConnectionManager
  let summaryStore: SummaryStore
  let transcriptStore: TranscriptStore
  let scheduler: RollingSummaryScheduler

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()

    const migrationRunner = createMigrationRunner(connection)
    migrationRunner.init()
    migrationRunner.apply(allStoreMigrations)

    summaryStore = createSummaryStore(connection)
    transcriptStore = createTranscriptStore(connection)

    const complete = vi.fn().mockResolvedValue({
      success: true,
      providerId: 'mock',
      response: {
        id: 'resp-1',
        model: 'session-model',
        content: '{"keyDecisions":[],"actionItems":[],"unresolvedQuestions":[],"currentState":"ok"}',
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
      },
    })

    scheduler = createRollingSummaryScheduler({
      transcriptStore,
      summaryStore,
      llmAdapter: { complete } as unknown as LLMAdapter,
    })
  })

  afterEach(() => {
    connection.close()
  })

  it('produces and stores a rolling summary when maxTurns is reached', async () => {
    for (let i = 1; i <= 10; i++) {
      transcriptStore.saveTurn(makeTurn(`t${i}`, `user message ${i}`, `assistant reply ${i}`))
    }

    const result = await scheduler.runOnce({
      userId: 'user-1',
      sessionId: 'session-rs',
      triggerTurnId: 't10',
      model: 'session-model',
      providerId: 'mock',
    })

    expect(result.status).toBe('summarized')

    const stored = summaryStore.getByType('rolling_5_turns')
    expect(stored).toHaveLength(1)
    expect(stored[0]?.sessionId).toBe('session-rs')
    expect(stored[0]?.userId).toBe('user-1')
    expect(stored[0]?.summary).toContain('keyDecisions')
    expect(stored[0]?.structuredState?.turnRange).toEqual({ startTurn: 1, endTurn: 10 })
    expect(stored[0]?.sourceRefs.transcriptRefs).toHaveLength(10)
  })

  it('stores nothing when the summary is not due', async () => {
    for (let i = 1; i <= 3; i++) {
      transcriptStore.saveTurn(makeTurn(`t${i}`, `user message ${i}`, `assistant reply ${i}`))
    }

    const result = await scheduler.runOnce({
      userId: 'user-1',
      sessionId: 'session-rs',
      triggerTurnId: 't3',
      model: 'session-model',
    })

    expect(result.status).toBe('not_due')
    expect(summaryStore.getByType('rolling_5_turns')).toHaveLength(0)
    expect(summaryStore.getByType('rolling_10_turns')).toHaveLength(0)
  })

  it('triggers on a topic shift before maxTurns', async () => {
    transcriptStore.saveTurn(
      makeTurn('t1', 'quantum entanglement superposition decoherence wavefunction collapse observer', ''),
    )
    for (let i = 2; i <= 6; i++) {
      transcriptStore.saveTurn(
        makeTurn(`t${i}`, 'soccer goalkeeper offside penalty striker defender tactics', `football reply ${i}`),
      )
    }

    const result = await scheduler.runOnce({
      userId: 'user-1',
      sessionId: 'session-rs',
      triggerTurnId: 't6',
      model: 'session-model',
    })

    expect(result.status).toBe('summarized')

    const stored = summaryStore.getByType('rolling_5_turns')
    expect(stored).toHaveLength(1)
    expect(stored[0]?.structuredState?.turnRange).toEqual({ startTurn: 1, endTurn: 6 })
  })
})
