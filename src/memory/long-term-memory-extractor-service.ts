import { randomUUID } from 'crypto';
import type { TranscriptStore } from '../storage/transcript-store.js';
import type { SummaryStore } from '../storage/summary-store.js';
import type { LongTermMemoryStore, LongTermMemoryRecord } from '../storage/long-term-memory-store.js';
import type { MemoryExtractionRunStore, ResultCounts } from '../storage/memory-extraction-run-store.js';
import type { LLMAdapter } from '../llm/adapter.js';
import type { LLMRequest } from '../llm/types.js';
import type { ModelInputBuilder } from '../kernel/model-input/model-input-builder.js';
import {
  stableJsonHash,
  fingerprintMemoryCandidate,
  validateExtractedCandidate,
  buildLongTermMemoryExtractionPrompt,
  type ExtractedMemoryCandidate,
  type MemoryExtractionWindow,
} from './long-term-memory-extraction.js';

export type ExtractorServiceDeps = {
  userId: string;
  sessionId: string;
  triggerTurnId: string;
  transcriptStore: TranscriptStore;
  summaryStore: SummaryStore;
  longTermMemoryStore: LongTermMemoryStore;
  memoryExtractionRunStore: MemoryExtractionRunStore;
  llmAdapter: LLMAdapter;
  modelInputBuilder: ModelInputBuilder;
  model?: string;
  providerFamily?: string;
};

export type ExtractionResult =
  | { status: 'succeeded'; resultCounts: ResultCounts }
  | { status: 'duplicate' }
  | { status: 'failed'; errorCode: string };

const MAX_PRECEDING_TURNS = 2;
const DEFAULT_MODEL = 'gpt-4o-mini';

function buildWindow(deps: ExtractorServiceDeps): MemoryExtractionWindow | null {
  const turns = deps.transcriptStore.findBySession(deps.sessionId);
  if (turns.length === 0) return null;

  const triggerIndex = turns.findIndex(t => t.turnId === deps.triggerTurnId);
  if (triggerIndex === -1) return null;

  const startIdx = Math.max(0, triggerIndex - MAX_PRECEDING_TURNS);
  const includedTurns = turns.slice(startIdx, triggerIndex + 1);
  const includedTurnIds = includedTurns.map(t => t.turnId);

  const sessionMemory = deps.summaryStore.getSessionMemory(deps.sessionId);
  const sessionMemorySummaryId = sessionMemory?.summaryId ?? '';

  const windowHash = stableJsonHash({
    userId: deps.userId,
    sessionId: deps.sessionId,
    triggerTurnId: deps.triggerTurnId,
    includedTurnIds,
    sessionMemorySummaryId,
  });

  const renderedInput = includedTurns
    .map(t => {
      const userMsg = t.input.userMessageSummary ?? '';
      const assistantMsgs = t.output.visibleMessages
        .filter(m => m.role === 'assistant')
        .map(m => m.content)
        .join('\n');
      return `[Turn ${t.turnId}]\nUser: ${userMsg}\nAssistant: ${assistantMsgs}`;
    })
    .join('\n\n');

  return {
    userId: deps.userId,
    sessionId: deps.sessionId,
    triggerTurnId: deps.triggerTurnId,
    includedTurnIds,
    windowHash,
    sessionMemorySummaryId,
    renderedInput,
  };
}

function parseLLMResponse(content: string): ExtractedMemoryCandidate[] {
  const parsed: unknown = JSON.parse(content);

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('candidates' in parsed) ||
    !Array.isArray((parsed as Record<string, unknown>).candidates)
  ) {
    throw new Error('Schema mismatch: missing candidates array');
  }

  return (parsed as { candidates: unknown[] }).candidates as ExtractedMemoryCandidate[];
}

function buildMemoryRecord(
  userId: string,
  candidate: ExtractedMemoryCandidate,
  windowHash: string,
): LongTermMemoryRecord {
  const now = new Date().toISOString();
  const memoryId = `mem-${randomUUID()}`;
  const fingerprint = fingerprintMemoryCandidate(userId, candidate);

  return {
    memoryId,
    userId,
    memoryType: candidate.memoryType as LongTermMemoryRecord['memoryType'],
    content: {
      text: candidate.text,
      structured: candidate.structured,
    },
    entities: candidate.entities,
    sourceRefs: {
      transcriptRefs: candidate.sourceRefs.transcriptRefs,
      summaryRefs: candidate.sourceRefs.summaryRefs,
      extraction: candidate.sourceRefs.extraction,
    },
    scope: {
      visibility: 'private_user',
    },
    confidence: candidate.confidence,
    importance: candidate.importance as LongTermMemoryRecord['importance'],
    sensitivity: candidate.sensitivity as LongTermMemoryRecord['sensitivity'],
    lifecycle: {
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    retrieval: {
      keywords: candidate.keywords,
      recallCount: 0,
    },
    fingerprint,
    sourceWindowHash: windowHash,
  };
}

export function createLongTermMemoryExtractorService(deps: ExtractorServiceDeps) {
  return {
    async run(): Promise<ExtractionResult> {
      const window = buildWindow(deps);
      if (!window) {
        return { status: 'failed', errorCode: 'INVALID_WINDOW' };
      }

      const existingRun = deps.memoryExtractionRunStore.getByWindowHash(deps.userId, window.windowHash);
      if (existingRun && existingRun.status !== 'failed') {
        return { status: 'duplicate' };
      }

      if (deps.longTermMemoryStore.hasTombstoneForSource(deps.userId, window.windowHash)) {
        return { status: 'succeeded', resultCounts: { accepted: 0, discarded: 0, tombstoneSkipped: 1, superseded: 0 } };
      }

      let run;
      try {
        run = deps.memoryExtractionRunStore.createPending({
          userId: deps.userId,
          sessionId: deps.sessionId,
          triggerTurnId: deps.triggerTurnId,
          windowHash: window.windowHash,
          includedTurnIds: window.includedTurnIds,
          sessionMemorySummaryId: window.sessionMemorySummaryId || undefined,
          sourceRefs: {
            triggerTurnId: window.triggerTurnId,
            includedTurnIds: window.includedTurnIds,
          },
        });
      } catch {
        return { status: 'duplicate' };
      }

      try {
        deps.memoryExtractionRunStore.markRunning(run.runId);

        const extractionPrompt = buildLongTermMemoryExtractionPrompt(window);
        const builtInput = await deps.modelInputBuilder.build({
          mode: 'structured_json',
          agentKind: 'memory',
          providerFamily: deps.providerFamily ?? 'openai',
          contextBundle: {
            pinnedItems: [
              { itemId: 'extraction-prompt', content: extractionPrompt, isPinned: true },
            ],
          },
          sessionId: deps.sessionId,
        });

        const request: LLMRequest = {
          model: deps.model ?? DEFAULT_MODEL,
          messages: builtInput.messages,
          responseFormat: { type: 'json_object' },
        };

        const llmResult = await deps.llmAdapter.complete(request);

        if (!llmResult.success) {
          const errorResult = llmResult as { success: false; error: { code?: string }; providerId: string };
          const errorCode = errorResult.error?.code ?? 'LLM_ERROR';
          deps.memoryExtractionRunStore.markFailed(run.runId, errorCode);
          return { status: 'failed', errorCode };
        }

        let candidates: ExtractedMemoryCandidate[];
        try {
          candidates = parseLLMResponse(llmResult.response.content);
        } catch {
          deps.memoryExtractionRunStore.markFailed(run.runId, 'INVALID_JSON');
          return { status: 'failed', errorCode: 'INVALID_JSON' };
        }

        const resultCounts: ResultCounts = {
          accepted: 0,
          discarded: 0,
          tombstoneSkipped: 0,
          superseded: 0,
        };

        for (const candidate of candidates) {
          if (candidate.discardReason) {
            resultCounts.discarded++;
            continue;
          }

          const validation = validateExtractedCandidate(candidate, window);
          if (!validation.valid || !validation.normalizedCandidate) {
            resultCounts.discarded++;
            continue;
          }

          const normalized = validation.normalizedCandidate;
          const fingerprint = fingerprintMemoryCandidate(deps.userId, normalized);

          if (deps.longTermMemoryStore.hasTombstone(deps.userId, fingerprint, window.windowHash)) {
            resultCounts.tombstoneSkipped++;
            continue;
          }

          const existing = deps.longTermMemoryStore.findCurrentByFingerprint(deps.userId, fingerprint);
          if (existing) {
            deps.longTermMemoryStore.applyPatch(existing.memoryId, {
              lifecycle: {
                ...existing.lifecycle,
                status: 'superseded',
                updatedAt: new Date().toISOString(),
              },
            });
            resultCounts.superseded++;
          }

          const record = buildMemoryRecord(deps.userId, normalized, window.windowHash);
          deps.longTermMemoryStore.save(record);
          resultCounts.accepted++;
        }

        deps.memoryExtractionRunStore.markSucceeded(run.runId, resultCounts);

        return { status: 'succeeded', resultCounts };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        deps.memoryExtractionRunStore.markFailed(run.runId, 'EXTRACTION_ERROR', errorMessage);
        return { status: 'failed', errorCode: 'EXTRACTION_ERROR' };
      }
    },
  };
}
