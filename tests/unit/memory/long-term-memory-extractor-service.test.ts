import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner } from '../../../src/storage/migrations.js';
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js';
import { createLongTermMemoryStore, type LongTermMemoryStore } from '../../../src/storage/long-term-memory-store.js';
import { createMemoryExtractionRunStore, type MemoryExtractionRunStore } from '../../../src/storage/memory-extraction-run-store.js';
import { createTranscriptStore, type TranscriptStore, type TurnTranscript } from '../../../src/storage/transcript-store.js';
import { createSummaryStore, type SummaryStore } from '../../../src/storage/summary-store.js';
import { createLongTermMemoryExtractorService, type ExtractorServiceDeps } from '../../../src/memory/long-term-memory-extractor-service.js';
import type { LLMAdapter } from '../../../src/llm/adapter.js';
import type { LLMRequest, LLMResult } from '../../../src/llm/types.js';
import type { ExtractedMemoryCandidate } from '../../../src/memory/long-term-memory-extraction.js';
import type { BuiltModelInput, ModelInputBuildInput } from '../../../src/kernel/model-input/model-input-types.js';
import type { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js';

function createMockLLMAdapter(responseContent: string): LLMAdapter {
  return {
    config: {
      providers: [],
      defaultTimeoutMs: 10000,
      enableCircuitBreaker: false,
    },
    providers: [],
    complete: vi.fn(async (_request: LLMRequest): Promise<LLMResult> => ({
      success: true,
      response: {
        id: 'test-response-id',
        model: 'gpt-4o-mini',
        content: responseContent,
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
      },
      providerId: 'mock-provider',
    })),
    stream: async function* () {},
    addProvider: vi.fn(),
    removeProvider: vi.fn(),
    getProvider: vi.fn(),
    getHealthyProviders: vi.fn(() => []),
    updateProviderPriority: vi.fn(),
  };
}

function createFailingLLMAdapter(errorMessage: string): LLMAdapter {
  return {
    config: {
      providers: [],
      defaultTimeoutMs: 10000,
      enableCircuitBreaker: false,
    },
    providers: [],
    complete: vi.fn(async (): Promise<LLMResult> => ({
      success: false,
      error: {
        errorId: 'err-test',
        category: 'model_error',
        code: 'PROVIDER_EXCEPTION',
        message: errorMessage,
        recoverability: 'retryable_later',
        source: { module: 'test' },
        createdAt: new Date().toISOString(),
      },
      providerId: 'mock-provider',
    })),
    stream: async function* () {},
    addProvider: vi.fn(),
    removeProvider: vi.fn(),
    getProvider: vi.fn(),
    getHealthyProviders: vi.fn(() => []),
    updateProviderPriority: vi.fn(),
  };
}

function createThrowingLLMAdapter(error: Error): LLMAdapter {
  return {
    config: {
      providers: [],
      defaultTimeoutMs: 10000,
      enableCircuitBreaker: false,
    },
    providers: [],
    complete: vi.fn(async (): Promise<LLMResult> => {
      throw error;
    }),
    stream: async function* () {},
    addProvider: vi.fn(),
    removeProvider: vi.fn(),
    getProvider: vi.fn(),
    getHealthyProviders: vi.fn(() => []),
    updateProviderPriority: vi.fn(),
  };
}

function createMockModelInputBuilder(): ModelInputBuilder {
  return {
    build: vi.fn(async (input: ModelInputBuildInput): Promise<BuiltModelInput> => {
      const messages = [];
      
      if (input.currentUserMessage) {
        messages.push({ role: 'user' as const, content: input.currentUserMessage });
      }
      
      if (input.contextBundle?.pinnedItems) {
        const pinnedContent = input.contextBundle.pinnedItems
          .map(item => item.content)
          .join('\n\n');
        if (pinnedContent) {
          messages.push({ role: 'user' as const, content: pinnedContent });
        }
      }
      
      if (messages.length === 0) {
        messages.push({ role: 'user' as const, content: '' });
      }
      
      return {
        messages,
        segments: {
          staticPrefix: '',
          tenantProject: '',
          toolPlane: '',
          contextBundle: messages.map(m => m.content).join('\n\n'),
        },
        segmentHashes: {
          segmentA: 'hash-a',
          segmentB: 'hash-b',
          segmentC: 'hash-c',
          segmentD: 'hash-d',
        },
        metadata: {
          mode: input.mode,
          agentKind: input.agentKind,
          providerFamily: input.providerFamily,
          messageCount: messages.length,
        },
      };
    }),
  } as unknown as ModelInputBuilder;
}

function makeTurn(overrides: Partial<TurnTranscript> & { turnId: string }): TurnTranscript {
  return {
    sessionId: 'session-1',
    userId: 'user-1',
    input: {
      userMessageSummary: `Summary for ${overrides.turnId}`,
    },
    output: {
      visibleMessages: [
        { messageId: `msg-${overrides.turnId}`, role: 'user', content: `Content for ${overrides.turnId}` },
      ],
    },
    visibility: 'public',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeValidLLMCandidate(includedTurnIds: string[]): ExtractedMemoryCandidate {
  return {
    memoryType: 'user_preference',
    text: 'User prefers dark mode',
    confidence: 0.9,
    importance: 'high',
    sensitivity: 'low',
    keywords: ['dark mode', 'preference'],
    scope: { visibility: 'private_user' },
    sourceRefs: {
      transcriptRefs: includedTurnIds,
      extraction: {
        windowHash: 'placeholder',
        triggerTurnId: includedTurnIds[includedTurnIds.length - 1],
        includedTurnIds,
      },
    },
  };
}

describe('LongTermMemoryExtractorService', () => {
  let connection: ConnectionManager;
  let longTermMemoryStore: LongTermMemoryStore;
  let extractionRunStore: MemoryExtractionRunStore;
  let transcriptStore: TranscriptStore;
  let summaryStore: SummaryStore;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();

    const migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(allStoreMigrations);

    longTermMemoryStore = createLongTermMemoryStore(connection);
    extractionRunStore = createMemoryExtractionRunStore(connection);
    transcriptStore = createTranscriptStore(connection);
    summaryStore = createSummaryStore(connection);
  });

  afterEach(() => {
    connection.close();
  });

  function createDeps(llmAdapter: LLMAdapter, triggerTurnId = 'turn-1'): ExtractorServiceDeps {
    return {
      userId: 'user-1',
      sessionId: 'session-1',
      triggerTurnId,
      transcriptStore,
      summaryStore,
      longTermMemoryStore,
      memoryExtractionRunStore: extractionRunStore,
      llmAdapter,
      modelInputBuilder: createMockModelInputBuilder(),
    };
  }

  describe('Window Builder', () => {
    it('should build window with trigger turn + up to 2 preceding turns', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }));
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-2' }));
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-3' }));
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-4' }));
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-5' }));

      const llmResponse = JSON.stringify({ candidates: [] });
      const llmAdapter = createMockLLMAdapter(llmResponse);
      const deps = createDeps(llmAdapter, 'turn-3');

      const service = createLongTermMemoryExtractorService(deps);
      await service.run();

      expect(llmAdapter.complete).toHaveBeenCalledOnce();
      const callArgs = (llmAdapter.complete as ReturnType<typeof vi.fn>).mock.calls[0];
      const request = callArgs[0] as LLMRequest;
      const prompt = request.messages[0].content;

      expect(prompt).toContain('turn-1');
      expect(prompt).toContain('turn-2');
      expect(prompt).toContain('turn-3');
      expect(prompt).not.toContain('turn-4');
      expect(prompt).not.toContain('turn-5');
    });

    it('should include only available preceding turns when fewer than 2 exist', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }));
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-2' }));

      const llmResponse = JSON.stringify({ candidates: [] });
      const llmAdapter = createMockLLMAdapter(llmResponse);
      const deps = createDeps(llmAdapter, 'turn-2');

      const service = createLongTermMemoryExtractorService(deps);
      await service.run();

      expect(llmAdapter.complete).toHaveBeenCalledOnce();
      const callArgs = (llmAdapter.complete as ReturnType<typeof vi.fn>).mock.calls[0];
      const request = callArgs[0] as LLMRequest;
      const prompt = request.messages[0].content;

      expect(prompt).toContain('turn-1');
      expect(prompt).toContain('turn-2');
    });

    it('should include session memory summary id when available', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }));

      summaryStore.save({
        summaryId: 'summary-session-1',
        summaryType: 'session_memory',
        userId: 'user-1',
        sessionId: 'session-1',
        sourceRefs: { transcriptRefs: ['turn-1'] },
        summary: 'Session memory summary text',
        status: 'active',
        createdAt: new Date().toISOString(),
      });

      const llmResponse = JSON.stringify({ candidates: [] });
      const llmAdapter = createMockLLMAdapter(llmResponse);
      const deps = createDeps(llmAdapter);

      const service = createLongTermMemoryExtractorService(deps);
      await service.run();

      expect(llmAdapter.complete).toHaveBeenCalledOnce();
      const callArgs = (llmAdapter.complete as ReturnType<typeof vi.fn>).mock.calls[0];
      const request = callArgs[0] as LLMRequest;
      const prompt = request.messages[0].content;

      expect(prompt).toContain('summary-session-1');
    });

    it('should compute stable windowHash from window parameters', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }));

      const llmResponse = JSON.stringify({ candidates: [] });
      const llmAdapter = createMockLLMAdapter(llmResponse);
      const deps = createDeps(llmAdapter);

      const service = createLongTermMemoryExtractorService(deps);
      const result1 = await service.run();

      const service2 = createLongTermMemoryExtractorService(deps);
      const result2 = await service2.run();

      expect(result1.status).toBe('succeeded');
      expect(result2.status).toBe('duplicate');
    });
  });

  describe('Idempotency', () => {
    it('should return duplicate for same userId + windowHash when run succeeded', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }));

      const llmResponse = JSON.stringify({ candidates: [] });
      const llmAdapter = createMockLLMAdapter(llmResponse);
      const deps = createDeps(llmAdapter);

      const service1 = createLongTermMemoryExtractorService(deps);
      const result1 = await service1.run();
      expect(result1.status).toBe('succeeded');

      const service2 = createLongTermMemoryExtractorService(deps);
      const result2 = await service2.run();
      expect(result2.status).toBe('duplicate');
    });

    it('should return duplicate for same userId + windowHash when run is running', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }));

      const { stableJsonHash } = await import('../../../src/memory/long-term-memory-extraction.js');
      const windowHash = stableJsonHash({
        userId: 'user-1',
        sessionId: 'session-1',
        triggerTurnId: 'turn-1',
        includedTurnIds: ['turn-1'],
        sessionMemorySummaryId: '',
      });

      extractionRunStore.createPending({
        userId: 'user-1',
        sessionId: 'session-1',
        triggerTurnId: 'turn-1',
        windowHash,
        includedTurnIds: ['turn-1'],
      });

      const llmResponse = JSON.stringify({ candidates: [] });
      const llmAdapter = createMockLLMAdapter(llmResponse);
      const deps = createDeps(llmAdapter);

      const service = createLongTermMemoryExtractorService(deps);
      const result = await service.run();
      expect(result.status).toBe('duplicate');
    });

    it('should return duplicate when previous run failed (no delete support)', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }));

      const failingAdapter = createFailingLLMAdapter('provider error');
      const deps1 = createDeps(failingAdapter);
      const service1 = createLongTermMemoryExtractorService(deps1);
      const result1 = await service1.run();
      expect(result1.status).toBe('failed');

      const llmResponse = JSON.stringify({ candidates: [] });
      const successAdapter = createMockLLMAdapter(llmResponse);
      const deps2 = createDeps(successAdapter);
      const service2 = createLongTermMemoryExtractorService(deps2);
      const result2 = await service2.run();
      expect(result2.status).toBe('duplicate');
    });
  });

  describe('Run Semantics', () => {
    it('should create pending run, mark running, call LLM, mark succeeded', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }));

      const llmResponse = JSON.stringify({ candidates: [] });
      const llmAdapter = createMockLLMAdapter(llmResponse);
      const deps = createDeps(llmAdapter);

      const service = createLongTermMemoryExtractorService(deps);
      const result = await service.run();

      expect(result.status).toBe('succeeded');
      expect(llmAdapter.complete).toHaveBeenCalledOnce();

      const { stableJsonHash } = await import('../../../src/memory/long-term-memory-extraction.js');
      const windowHash = stableJsonHash({
        userId: 'user-1',
        sessionId: 'session-1',
        triggerTurnId: 'turn-1',
        includedTurnIds: ['turn-1'],
        sessionMemorySummaryId: '',
      });
      const run = extractionRunStore.getByWindowHash('user-1', windowHash);
      expect(run).not.toBeNull();
      expect(run!.status).toBe('succeeded');
    });

    it('should return succeeded with zero counts when no candidates extracted', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }));

      const llmResponse = JSON.stringify({ candidates: [] });
      const llmAdapter = createMockLLMAdapter(llmResponse);
      const deps = createDeps(llmAdapter);

      const service = createLongTermMemoryExtractorService(deps);
      const result = await service.run();

      expect(result.status).toBe('succeeded');
      if (result.status === 'succeeded') {
        expect(result.resultCounts.accepted).toBe(0);
        expect(result.resultCounts.superseded).toBe(0);
      }
    });

    it('should write memories and return counts on success', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }));

      const candidate = makeValidLLMCandidate(['turn-1']);
      const llmResponse = JSON.stringify({ candidates: [candidate] });
      const llmAdapter = createMockLLMAdapter(llmResponse);
      const deps = createDeps(llmAdapter);

      const service = createLongTermMemoryExtractorService(deps);
      const result = await service.run();

      expect(result.status).toBe('succeeded');
      if (result.status === 'succeeded') {
        expect(result.resultCounts.accepted).toBe(1);
        expect(result.resultCounts.superseded).toBe(0);
      }

      const memories = longTermMemoryStore.getByUserId('user-1');
      expect(memories).toHaveLength(1);
      expect(memories[0].content.text).toBe('User prefers dark mode');
      expect(memories[0].fingerprint).toBeDefined();
      expect(memories[0].sourceWindowHash).toBeDefined();
    });
  });

  describe('Failure Isolation', () => {
    it('should mark run failed and return structured result when LLM returns error', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }));

      const llmAdapter = createFailingLLMAdapter('provider unavailable');
      const deps = createDeps(llmAdapter);

      const service = createLongTermMemoryExtractorService(deps);
      const result = await service.run();

      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.errorCode).toBeDefined();
      }

      const memories = longTermMemoryStore.getByUserId('user-1');
      expect(memories).toHaveLength(0);
    });

    it('should mark run failed when LLM throws an exception', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }));

      const llmAdapter = createThrowingLLMAdapter(new Error('network timeout'));
      const deps = createDeps(llmAdapter);

      const service = createLongTermMemoryExtractorService(deps);
      const result = await service.run();

      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.errorCode).toBeDefined();
      }

      const memories = longTermMemoryStore.getByUserId('user-1');
      expect(memories).toHaveLength(0);
    });

    it('should mark run failed when LLM returns invalid JSON', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }));

      const llmAdapter = createMockLLMAdapter('this is not valid json {{{');
      const deps = createDeps(llmAdapter);

      const service = createLongTermMemoryExtractorService(deps);
      const result = await service.run();

      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.errorCode).toBe('INVALID_JSON');
      }

      const memories = longTermMemoryStore.getByUserId('user-1');
      expect(memories).toHaveLength(0);
    });

    it('should mark run failed when LLM response has schema mismatch', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }));

      const llmAdapter = createMockLLMAdapter(JSON.stringify({ wrong_field: true }));
      const deps = createDeps(llmAdapter);

      const service = createLongTermMemoryExtractorService(deps);
      const result = await service.run();

      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.errorCode).toBeDefined();
      }

      const memories = longTermMemoryStore.getByUserId('user-1');
      expect(memories).toHaveLength(0);
    });

    it('should never throw to caller on any failure', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }));
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-2' }));
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-3' }));
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-4' }));

      const adapters = [
        createFailingLLMAdapter('error'),
        createThrowingLLMAdapter(new Error('boom')),
        createMockLLMAdapter('not json'),
        createMockLLMAdapter('{}'),
      ];

      const triggerTurnIds = ['turn-1', 'turn-2', 'turn-3', 'turn-4'];

      for (let i = 0; i < adapters.length; i++) {
        const deps = createDeps(adapters[i], triggerTurnIds[i]);
        const service = createLongTermMemoryExtractorService(deps);
        const result = await service.run();
        expect(result.status).toMatch(/failed|succeeded/);
      }
    });
  });

  describe('Tombstone Check', () => {
    it('should skip candidates where tombstone exists', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }));

      const candidate = makeValidLLMCandidate(['turn-1']);
      const { fingerprintMemoryCandidate, stableJsonHash } = await import('../../../src/memory/long-term-memory-extraction.js');
      const fingerprint = fingerprintMemoryCandidate('user-1', candidate);
      const windowHash = stableJsonHash({
        userId: 'user-1',
        sessionId: 'session-1',
        triggerTurnId: 'turn-1',
        includedTurnIds: ['turn-1'],
        sessionMemorySummaryId: '',
      });

      longTermMemoryStore.createTombstone({ userId: 'user-1', fingerprint, sourceWindowHash: windowHash });
      expect(longTermMemoryStore.hasTombstone('user-1', fingerprint, windowHash)).toBe(true);

      const llmResponse = JSON.stringify({ candidates: [candidate] });
      const llmAdapter = createMockLLMAdapter(llmResponse);
      const deps = createDeps(llmAdapter, 'turn-1');

      const service = createLongTermMemoryExtractorService(deps);
      const result = await service.run();
      expect(result.status).toBe('succeeded');

      // Candidate should be skipped due to tombstone
      const memories = longTermMemoryStore.getByUserId('user-1');
      expect(memories).toHaveLength(0);
    });
  });

  describe('Supersede', () => {
    it('should supersede existing active memory with same fingerprint', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }));
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-2' }));

      const candidate = makeValidLLMCandidate(['turn-1']);
      const llmResponse = JSON.stringify({ candidates: [candidate] });
      const llmAdapter = createMockLLMAdapter(llmResponse);
      const deps = createDeps(llmAdapter, 'turn-1');

      const service1 = createLongTermMemoryExtractorService(deps);
      const result1 = await service1.run();
      expect(result1.status).toBe('succeeded');

      const memories1 = longTermMemoryStore.getByUserId('user-1');
      expect(memories1).toHaveLength(1);
      const firstMemoryId = memories1[0].memoryId;

      const candidate2 = makeValidLLMCandidate(['turn-1', 'turn-2']);
      const llmResponse2 = JSON.stringify({ candidates: [candidate2] });
      const llmAdapter2 = createMockLLMAdapter(llmResponse2);
      const deps2 = createDeps(llmAdapter2, 'turn-2');
      const service2 = createLongTermMemoryExtractorService(deps2);
      const result2 = await service2.run();
      expect(result2.status).toBe('succeeded');

      if (result2.status === 'succeeded') {
        expect(result2.resultCounts.superseded).toBe(1);
        expect(result2.resultCounts.accepted).toBe(1);
      }

      const oldMemory = longTermMemoryStore.getByMemoryId(firstMemoryId);
      expect(oldMemory).not.toBeNull();
      expect(oldMemory!.lifecycle.status).toBe('superseded');

      const memories2 = longTermMemoryStore.getByUserId('user-1');
      const activeMemories = memories2.filter(m => m.lifecycle.status === 'active');
      expect(activeMemories).toHaveLength(1);
      expect(activeMemories[0].memoryId).not.toBe(firstMemoryId);
    });
  });

  describe('Validation Filtering', () => {
    it('should only write valid candidates and skip invalid ones', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }));

      const validCandidate = makeValidLLMCandidate(['turn-1']);
      const invalidCandidate = {
        ...validCandidate,
        memoryType: 'unsupported_type',
        text: 'This should be rejected',
      };

      const llmResponse = JSON.stringify({ candidates: [validCandidate, invalidCandidate] });
      const llmAdapter = createMockLLMAdapter(llmResponse);
      const deps = createDeps(llmAdapter);

      const service = createLongTermMemoryExtractorService(deps);
      const result = await service.run();

      expect(result.status).toBe('succeeded');
      if (result.status === 'succeeded') {
        expect(result.resultCounts.accepted).toBe(1);
      }

      const memories = longTermMemoryStore.getByUserId('user-1');
      expect(memories).toHaveLength(1);
      expect(memories[0].content.text).toBe('User prefers dark mode');
    });

    it('should skip candidates with discardReason', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }));

      const candidateWithDiscard = {
        ...makeValidLLMCandidate(['turn-1']),
        discardReason: 'This is transient context',
      };

      const llmResponse = JSON.stringify({ candidates: [candidateWithDiscard] });
      const llmAdapter = createMockLLMAdapter(llmResponse);
      const deps = createDeps(llmAdapter);

      const service = createLongTermMemoryExtractorService(deps);
      const result = await service.run();

      expect(result.status).toBe('succeeded');
      if (result.status === 'succeeded') {
        expect(result.resultCounts.accepted).toBe(0);
      }

      const memories = longTermMemoryStore.getByUserId('user-1');
      expect(memories).toHaveLength(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle trigger turn not found in session', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }));

      const deps = createDeps(createMockLLMAdapter('{}'), 'non-existent-turn');

      const service = createLongTermMemoryExtractorService(deps);
      const result = await service.run();

      expect(result.status).toBe('failed');
    });

    it('should handle empty session (no turns)', async () => {
      const deps = createDeps(createMockLLMAdapter('{}'));

      const service = createLongTermMemoryExtractorService(deps);
      const result = await service.run();

      expect(result.status).toBe('failed');
    });

    it('should handle LLM returning empty candidates array', async () => {
      transcriptStore.saveTurn(makeTurn({ turnId: 'turn-1' }));

      const llmResponse = JSON.stringify({ candidates: [] });
      const llmAdapter = createMockLLMAdapter(llmResponse);
      const deps = createDeps(llmAdapter);

      const service = createLongTermMemoryExtractorService(deps);
      const result = await service.run();

      expect(result.status).toBe('succeeded');
      if (result.status === 'succeeded') {
        expect(result.resultCounts.accepted).toBe(0);
      }
    });
  });
});
