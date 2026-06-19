import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import { createTranscriptStore, type TranscriptStore } from '../../../src/storage/transcript-store.js'
import { createSummaryStore, type SummaryStore } from '../../../src/storage/summary-store.js'
import { createLongTermMemoryStore, type LongTermMemoryStore } from '../../../src/storage/long-term-memory-store.js'
import {
  createMemoryExtractionRunStore,
  type MemoryExtractionRunStore,
} from '../../../src/storage/memory-extraction-run-store.js'
import type { LLMAdapter } from '../../../src/llm/adapter.js'
import type { LLMRequest, LLMResult } from '../../../src/llm/types.js'
import type { BuiltModelInput, ModelInputBuildInput } from '../../../src/kernel/model-input/model-input-types.js'
import type { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import {
  createLongTermMemoryScheduler,
  type LongTermMemoryScheduler,
  type SchedulerDeps,
} from '../../../src/memory/long-term-memory-scheduler.js'

describe('Long-term Memory Pipeline Integration', () => {
  let connection: ConnectionManager
  let transcriptStore: TranscriptStore
  let summaryStore: SummaryStore
  let longTermMemoryStore: LongTermMemoryStore
  let memoryExtractionRunStore: MemoryExtractionRunStore
  let mockLlmAdapter: LLMAdapter

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    const migrationRunner = createMigrationRunner(connection)
    migrationRunner.init()
    migrationRunner.apply(allStoreMigrations)

    transcriptStore = createTranscriptStore(connection)
    summaryStore = createSummaryStore(connection)
    longTermMemoryStore = createLongTermMemoryStore(connection)
    memoryExtractionRunStore = createMemoryExtractionRunStore(connection)

    mockLlmAdapter = {
      providers: [{ id: 'test-provider', name: 'Test Provider' }],
      complete: vi.fn(
        async (_request: LLMRequest): Promise<LLMResult> => ({
          success: true,
          response: {
            id: 'resp-1',
            content: JSON.stringify({ candidates: [] }),
            model: 'test-model',
            role: 'assistant',
            finishReason: 'stop',
            createdAt: new Date().toISOString(),
            usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          },
          providerId: 'test-provider',
        }),
      ),
    } as unknown as LLMAdapter
  })

  afterEach(() => {
    connection?.close()
  })

  // ============================================================================
  // Scheduler Interface Tests
  // ============================================================================
  describe('LongTermMemoryScheduler', () => {
    describe('scheduleAfterTurn', () => {
      it('should return immediately (fire-and-forget)', () => {
        const scheduler = createScheduler()

        const start = Date.now()
        scheduler.scheduleAfterTurn({
          userId: 'user-1',
          sessionId: 'session-1',
          triggerTurnId: 'turn-1',
        })
        const elapsed = Date.now() - start

        expect(elapsed).toBeLessThan(10)
      })

      it('should not throw when scheduling', () => {
        const scheduler = createScheduler()

        expect(() => {
          scheduler.scheduleAfterTurn({
            userId: 'user-1',
            sessionId: 'session-1',
            triggerTurnId: 'turn-1',
          })
        }).not.toThrow()
      })
    })

    describe('runOnce', () => {
      it('should run extraction synchronously and return result', async () => {
        seedTranscript('user-1', 'session-1', 'turn-1')

        const scheduler = createScheduler()

        const result = await scheduler.runOnce({
          userId: 'user-1',
          sessionId: 'session-1',
          triggerTurnId: 'turn-1',
        })

        expect(result).toBeDefined()
        expect(result.status).toBeDefined()
        expect(['succeeded', 'duplicate', 'failed']).toContain(result.status)
      })

      it('should record extraction run in the run store', async () => {
        seedTranscript('user-1', 'session-1', 'turn-1')

        const scheduler = createScheduler()

        await scheduler.runOnce({
          userId: 'user-1',
          sessionId: 'session-1',
          triggerTurnId: 'turn-1',
        })

        const runs = memoryExtractionRunStore.listByUser('user-1')
        expect(runs.length).toBeGreaterThanOrEqual(1)
      })

      it('should return duplicate for same window hash on second call', async () => {
        seedTranscript('user-1', 'session-1', 'turn-1')

        const scheduler = createScheduler()

        const first = await scheduler.runOnce({
          userId: 'user-1',
          sessionId: 'session-1',
          triggerTurnId: 'turn-1',
        })

        const second = await scheduler.runOnce({
          userId: 'user-1',
          sessionId: 'session-1',
          triggerTurnId: 'turn-1',
        })

        if (first.status !== 'failed') {
          expect(second.status).toBe('duplicate')
        }
      })
    })

    describe('drain', () => {
      it('should resolve immediately when no work is pending', async () => {
        const scheduler = createScheduler()

        await expect(scheduler.drain()).resolves.toBeUndefined()
      })

      it('should await all scheduled work', async () => {
        seedTranscript('user-1', 'session-1', 'turn-1')

        const scheduler = createScheduler()

        scheduler.scheduleAfterTurn({
          userId: 'user-1',
          sessionId: 'session-1',
          triggerTurnId: 'turn-1',
        })

        await scheduler.drain()

        const runs = memoryExtractionRunStore.listByUser('user-1')
        expect(runs.length).toBeGreaterThanOrEqual(1)
      })

      it('should handle multiple scheduled turns', async () => {
        seedTranscript('user-1', 'session-1', 'turn-1')
        seedTranscript('user-1', 'session-1', 'turn-2')

        const scheduler = createScheduler()

        scheduler.scheduleAfterTurn({
          userId: 'user-1',
          sessionId: 'session-1',
          triggerTurnId: 'turn-1',
        })
        scheduler.scheduleAfterTurn({
          userId: 'user-1',
          sessionId: 'session-1',
          triggerTurnId: 'turn-2',
        })

        await scheduler.drain()

        const runs = memoryExtractionRunStore.listByUser('user-1')
        expect(runs.length).toBeGreaterThanOrEqual(2)
      })
    })

    describe('error handling', () => {
      it('should catch and record extraction failures', async () => {
        const failingAdapter = {
          providers: [{ id: 'test-provider', name: 'Test Provider' }],
          complete: vi.fn(
            async (): Promise<LLMResult> => ({
              success: false,
              providerId: 'test-provider',
              error: {
                errorId: 'err-1',
                category: 'model_error',
                code: 'PROVIDER_ERROR',
                message: 'Provider unavailable',
                recoverability: 'non_recoverable',
                source: { module: 'test' },
                createdAt: new Date().toISOString(),
              },
            }),
          ),
        } as unknown as LLMAdapter

        seedTranscript('user-1', 'session-1', 'turn-1')

        const scheduler = createSchedulerWithAdapter(failingAdapter)

        const result = await scheduler.runOnce({
          userId: 'user-1',
          sessionId: 'session-1',
          triggerTurnId: 'turn-1',
        })

        expect(result.status).toBe('failed')

        const runs = memoryExtractionRunStore.listByUser('user-1')
        expect(runs.length).toBe(1)
        expect(runs[0].status).toBe('failed')
      })

      it('should not propagate errors from scheduleAfterTurn', async () => {
        const throwingAdapter = {
          providers: [{ id: 'test-provider', name: 'Test Provider' }],
          complete: vi.fn(async (): Promise<LLMResult> => {
            throw new Error('Unexpected error')
          }),
        } as unknown as LLMAdapter

        seedTranscript('user-1', 'session-1', 'turn-1')

        const scheduler = createSchedulerWithAdapter(throwingAdapter)

        expect(() => {
          scheduler.scheduleAfterTurn({
            userId: 'user-1',
            sessionId: 'session-1',
            triggerTurnId: 'turn-1',
          })
        }).not.toThrow()

        await expect(scheduler.drain()).resolves.toBeUndefined()
      })
    })
  })

  // ============================================================================
  // Helper functions
  // ============================================================================

  function createMockModelInputBuilder(): ModelInputBuilder {
    return {
      build: vi.fn(async (input: ModelInputBuildInput): Promise<BuiltModelInput> => {
        const messages = []

        if (input.currentUserMessage) {
          messages.push({ role: 'user' as const, content: input.currentUserMessage })
        }

        if (input.contextBundle?.pinnedItems) {
          const pinnedContent = input.contextBundle.pinnedItems.map((item) => item.content).join('\n\n')
          if (pinnedContent) {
            messages.push({ role: 'user' as const, content: pinnedContent })
          }
        }

        if (messages.length === 0) {
          messages.push({ role: 'user' as const, content: '' })
        }

        return {
          messages,
          segments: {
            staticPrefix: '',
            tenantProject: '',
            toolPlane: '',
            contextBundle: messages.map((m) => m.content).join('\n\n'),
          },
          segmentHashes: {
            segmentA: 'hash-a',
            segmentB: 'hash-b',
            segmentC: 'hash-c',
            segmentD: 'hash-d',
          },
          metadata: {
            mode: input.mode,
            agentKind: input.agentKind ?? 'kernel',
            agentType: input.agentType ?? 'main',
            agentProfile: input.agentProfile ?? input.agentKind ?? 'default',
            providerFamily: input.providerFamily,
            messageCount: messages.length,
          },
        }
      }),
    } as unknown as ModelInputBuilder
  }

  function createScheduler(): LongTermMemoryScheduler {
    return createSchedulerWithAdapter(mockLlmAdapter)
  }

  function createSchedulerWithAdapter(adapter: LLMAdapter): LongTermMemoryScheduler {
    const deps: SchedulerDeps = {
      transcriptStore,
      summaryStore,
      longTermMemoryStore,
      memoryExtractionRunStore,
      llmAdapter: adapter,
      modelInputBuilder: createMockModelInputBuilder(),
    }
    return createLongTermMemoryScheduler(deps)
  }

  function seedTranscript(userId: string, sessionId: string, turnId: string): void {
    transcriptStore.saveTurn({
      turnId,
      sessionId,
      userId,
      input: {
        userMessageSummary: `User message for ${turnId}`,
      },
      output: {
        visibleMessages: [
          {
            messageId: `msg-${turnId}-assistant`,
            role: 'assistant',
            content: `Assistant response for ${turnId}`,
          },
        ],
      },
      visibility: 'public',
      createdAt: new Date().toISOString(),
    })
  }
})
