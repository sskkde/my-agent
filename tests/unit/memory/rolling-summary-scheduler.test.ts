import { describe, it, expect, vi } from 'vitest'
import {
  createRollingSummaryScheduler,
  type RollingSummaryScheduler,
  type RollingSummarySchedulerDeps,
} from '../../../src/memory/rolling-summary-scheduler.js'
import type { TranscriptStore, TurnTranscript } from '../../../src/storage/transcript-store.js'
import type { SummaryStore } from '../../../src/storage/summary-store.js'
import type { LLMAdapter } from '../../../src/llm/adapter.js'
import type { SummaryManager } from '../../../src/memory/types.js'
import type { LLMResult } from '../../../src/llm/types.js'

function makeTurn(turnId: string, userText: string, assistantText: string): TurnTranscript {
  return {
    turnId,
    sessionId: 'session-1',
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

function successResult(content: string): LLMResult {
  return {
    success: true,
    providerId: 'mock',
    response: {
      id: 'resp-1',
      model: 'mock-model',
      content,
      role: 'assistant',
      finishReason: 'stop',
      createdAt: new Date().toISOString(),
    },
  }
}

type Fixture = {
  scheduler: RollingSummaryScheduler
  deps: Required<Pick<RollingSummarySchedulerDeps, 'llmAdapter' | 'summaryManager' | 'summaryStore'>>
  complete: ReturnType<typeof vi.fn>
  writeRollingSummary: ReturnType<typeof vi.fn>
}

function createFixture(
  turns: TurnTranscript[],
  existingSummaries: ReturnType<SummaryStore['getByType']> = [],
): Fixture {
  const complete = vi.fn().mockResolvedValue(successResult('Summary text'))
  const writeRollingSummary = vi.fn().mockResolvedValue({ success: true, data: { summaryId: 'sum-1' }, version: 1 })

  const transcriptStore = { findBySession: () => turns } as unknown as TranscriptStore
  const summaryStore = { getByType: () => existingSummaries } as unknown as SummaryStore
  const llmAdapter = { complete } as unknown as LLMAdapter
  const summaryManager = { writeRollingSummary } as unknown as SummaryManager

  const scheduler = createRollingSummaryScheduler({
    transcriptStore,
    summaryStore,
    llmAdapter,
    summaryManager,
  })

  return { scheduler, deps: { llmAdapter, summaryManager, summaryStore }, complete, writeRollingSummary }
}

const SCHEDULE_INPUT = {
  userId: 'user-1',
  sessionId: 'session-1',
  triggerTurnId: 't10',
  model: 'mock-model',
  providerId: 'mock',
}

describe('RollingSummaryScheduler decision logic', () => {
  it('summarizes when maxTurns (10) is reached', async () => {
    const turns = Array.from({ length: 10 }, (_, i) => makeTurn(`t${i + 1}`, `user ${i + 1}`, `assistant ${i + 1}`))
    const { scheduler, complete, writeRollingSummary } = createFixture(turns)

    const result = await scheduler.runOnce({ ...SCHEDULE_INPUT, triggerTurnId: 't10' })

    expect(result.status).toBe('summarized')
    expect(complete).toHaveBeenCalledTimes(1)
    expect(writeRollingSummary).toHaveBeenCalledTimes(1)
    const [sessionId, userId, summaryType, content, options] = writeRollingSummary.mock.calls[0] as [
      string,
      string,
      string,
      { summary: string; turnRange: { startTurn: number; endTurn: number } },
      { sourceRefs: { transcriptRefs: string[] }; isLlmGenerated: boolean },
    ]
    expect(sessionId).toBe('session-1')
    expect(userId).toBe('user-1')
    expect(summaryType).toBe('rolling_5_turns')
    expect(content.turnRange).toEqual({ startTurn: 1, endTurn: 10 })
    expect(content.summary).toBe('Summary text')
    expect(options.sourceRefs.transcriptRefs).toHaveLength(10)
    expect(options.isLlmGenerated).toBe(true)
  })

  it('inherits the resolved model on the LLM request', async () => {
    const turns = Array.from({ length: 10 }, (_, i) => makeTurn(`t${i + 1}`, `user ${i + 1}`, `assistant ${i + 1}`))
    const { scheduler, complete } = createFixture(turns)

    await scheduler.runOnce({ ...SCHEDULE_INPUT, triggerTurnId: 't10', model: 'session-model-v1' })

    const request = complete.mock.calls[0]?.[0] as {
      model: string
      maxTokens: number
      temperature: number
      topP: number
      messages: Array<{ role: string; content: string }>
    }
    expect(request.model).toBe('session-model-v1')
    expect(request.maxTokens).toBe(1024)
    expect(request.temperature).toBe(0.2)
    expect(request.topP).toBe(0.9)
    expect(request.messages[0]?.role).toBe('user')
    expect(request.messages[0]?.content).toContain('Session Context')
  })

  it('does nothing before maxTurns', async () => {
    const turns = Array.from({ length: 3 }, (_, i) => makeTurn(`t${i + 1}`, `user ${i + 1}`, `assistant ${i + 1}`))
    const { scheduler, complete, writeRollingSummary } = createFixture(turns)

    const result = await scheduler.runOnce({ ...SCHEDULE_INPUT, triggerTurnId: 't3' })

    expect(result.status).toBe('not_due')
    expect(complete).not.toHaveBeenCalled()
    expect(writeRollingSummary).not.toHaveBeenCalled()
  })

  it('skips when no model was resolved for the session', async () => {
    const turns = Array.from({ length: 10 }, (_, i) => makeTurn(`t${i + 1}`, `user ${i + 1}`, `assistant ${i + 1}`))
    const { scheduler, complete, writeRollingSummary } = createFixture(turns)

    const result = await scheduler.runOnce({ ...SCHEDULE_INPUT, triggerTurnId: 't10', model: undefined })

    expect(result.status).toBe('skipped')
    expect((result as { reason: string }).reason).toBe('no_model')
    expect(complete).not.toHaveBeenCalled()
    expect(writeRollingSummary).not.toHaveBeenCalled()
  })

  it('skips when the session has no turns', async () => {
    const { scheduler, complete, writeRollingSummary } = createFixture([])

    const result = await scheduler.runOnce({ ...SCHEDULE_INPUT, triggerTurnId: 't1' })

    expect(result.status).toBe('skipped')
    expect((result as { reason: string }).reason).toBe('no_turns')
    expect(complete).not.toHaveBeenCalled()
    expect(writeRollingSummary).not.toHaveBeenCalled()
  })

  it('does not persist when the LLM call fails', async () => {
    const turns = Array.from({ length: 10 }, (_, i) => makeTurn(`t${i + 1}`, `user ${i + 1}`, `assistant ${i + 1}`))
    const { scheduler, complete, writeRollingSummary } = createFixture(turns)
    complete.mockResolvedValue({
      success: false,
      providerId: 'mock',
      error: { code: 'ALL_PROVIDERS_FAILED', message: 'boom' },
    })

    const result = await scheduler.runOnce({ ...SCHEDULE_INPUT, triggerTurnId: 't10' })

    expect(result.status).toBe('failed')
    expect((result as { errorCode: string }).errorCode).toBe('ALL_PROVIDERS_FAILED')
    expect(writeRollingSummary).not.toHaveBeenCalled()
  })

  it('starts the turn range after the last persisted rolling summary', async () => {
    const turns = Array.from({ length: 16 }, (_, i) => makeTurn(`t${i + 1}`, `user ${i + 1}`, `assistant ${i + 1}`))
    const existing: ReturnType<SummaryStore['getByType']> = [
      {
        summaryId: 'sum-prev',
        summaryType: 'rolling_5_turns',
        userId: 'user-1',
        sessionId: 'session-1',
        sourceRefs: { transcriptRefs: ['t1', 't2', 't3', 't4', 't5'] },
        summary: 'prev',
        structuredState: { turnRange: { startTurn: 1, endTurn: 5 } },
        status: 'active',
        createdAt: new Date().toISOString(),
      },
    ]
    const { scheduler, writeRollingSummary } = createFixture(turns, existing)

    const result = await scheduler.runOnce({ ...SCHEDULE_INPUT, triggerTurnId: 't16' })

    expect(result.status).toBe('summarized')
    const content = writeRollingSummary.mock.calls[0]?.[3] as { turnRange: { startTurn: number; endTurn: number } }
    expect(content.turnRange).toEqual({ startTurn: 6, endTurn: 16 })
  })

  it('scheduleAfterTurn is fire-and-forget and never rejects', async () => {
    const turns = Array.from({ length: 10 }, (_, i) => makeTurn(`t${i + 1}`, `user ${i + 1}`, `assistant ${i + 1}`))
    const { scheduler, writeRollingSummary } = createFixture(turns)

    scheduler.scheduleAfterTurn({ ...SCHEDULE_INPUT, triggerTurnId: 't10' })

    await new Promise((resolve) => setTimeout(resolve, 0))
    await scheduler.drain()

    expect(writeRollingSummary).toHaveBeenCalledTimes(1)
  })
})
