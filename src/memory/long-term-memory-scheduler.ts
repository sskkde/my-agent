import type { TranscriptStore } from '../storage/transcript-store.js';
import type { SummaryStore } from '../storage/summary-store.js';
import type { LongTermMemoryStore } from '../storage/long-term-memory-store.js';
import type { MemoryExtractionRunStore } from '../storage/memory-extraction-run-store.js';
import type { LLMAdapter } from '../llm/adapter.js';
import {
  createLongTermMemoryExtractorService,
  type ExtractionResult,
} from './long-term-memory-extractor-service.js';

export type SchedulerDeps = {
  transcriptStore: TranscriptStore;
  summaryStore: SummaryStore;
  longTermMemoryStore: LongTermMemoryStore;
  memoryExtractionRunStore: MemoryExtractionRunStore;
  llmAdapter: LLMAdapter;
};

export type ScheduleInput = {
  userId: string;
  sessionId: string;
  triggerTurnId: string;
};

export interface LongTermMemoryScheduler {
  scheduleAfterTurn(input: ScheduleInput): void;
  runOnce(input: ScheduleInput): Promise<ExtractionResult>;
  drain(): Promise<void>;
}

async function executeExtraction(
  deps: SchedulerDeps,
  input: ScheduleInput,
): Promise<ExtractionResult> {
  const service = createLongTermMemoryExtractorService({
    userId: input.userId,
    sessionId: input.sessionId,
    triggerTurnId: input.triggerTurnId,
    transcriptStore: deps.transcriptStore,
    summaryStore: deps.summaryStore,
    longTermMemoryStore: deps.longTermMemoryStore,
    memoryExtractionRunStore: deps.memoryExtractionRunStore,
    llmAdapter: deps.llmAdapter,
  });

  return service.run();
}

export function createLongTermMemoryScheduler(
  deps: SchedulerDeps,
): LongTermMemoryScheduler {
  const pending = new Set<Promise<unknown>>();

  return {
    scheduleAfterTurn(input: ScheduleInput): void {
      const promise = executeExtraction(deps, input).catch(() => {});
      pending.add(promise);
      promise.finally(() => {
        pending.delete(promise);
      });
    },

    async runOnce(input: ScheduleInput): Promise<ExtractionResult> {
      return executeExtraction(deps, input);
    },

    async drain(): Promise<void> {
      if (pending.size === 0) return;
      await Promise.all([...pending]);
    },
  };
}
