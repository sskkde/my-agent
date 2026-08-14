/**
 * Rolling Summary Scheduler
 *
 * Best-effort, fire-and-forget rolling-summary generation scheduled after each
 * persisted turn. Mirrors the async discipline of `long-term-memory-scheduler.ts`:
 * queueMicrotask + try/catch swallow so failures can never block or break the
 * message-processing main path (project anti-pattern #11).
 *
 * Flow:
 *   1. Read the session's persisted turns (chronological).
 *   2. Evaluate the rolling-summary policy (`createRollingSummaryPolicy().evaluate`)
 *      with the session's turn state (turnCount, lastSummaryTurn, topic shift).
 *   3. When a summary is due, build the prompt via `buildSessionSummaryPrompt`,
 *      call the LLM with the session-resolved model (never hardcoded) and a bounded
 *      maxTokens, then persist via the summary manager (`writeRollingSummary`).
 *
 * The factory is self-contained: it needs only stores + llmAdapter, so it can be
 * wired in `src/api/context.ts` with two lines (see processor-orchestration.ts dep).
 */

import type { TranscriptStore, TurnTranscript } from '../storage/transcript-store.js'
import type { SummaryStore, SourceRefs } from '../storage/summary-store.js'
import type { LLMAdapter } from '../llm/adapter.js'
import type { LLMRequest } from '../llm/types.js'
import type { SummaryManager } from './types.js'
import { createSummaryManager } from './summary-manager.js'
import { createRollingSummaryPolicy } from './rolling-summary-policy.js'
import { createTopicShiftDetector, type TopicShiftDetector } from './topic-shift-detector.js'
import { buildSessionSummaryPrompt } from './summary-prompt-builder.js'

const DEFAULT_MAX_TOKENS = 1024
const DEFAULT_TEMPERATURE = 0.2
const DEFAULT_TOP_P = 0.9
const DEFAULT_TOPIC_WINDOW_SIZE = 5
const ROLLING_10_TURNS_MIN_SPAN = 15

export type RollingSummarySchedulerDeps = {
  transcriptStore: TranscriptStore
  summaryStore: SummaryStore
  llmAdapter: LLMAdapter
  /** Optional pre-built summary manager (reuses DI'd instance + observability). */
  summaryManager?: SummaryManager
  /** Bounded output tokens for the auxiliary summary call (default: 1024). */
  maxTokens?: number
  /** Sampling temperature for the auxiliary call (default: 0.2). */
  temperature?: number
  /** Nucleus sampling for the auxiliary call (default: 0.9). */
  topP?: number
  /** Turns per window used for topic-shift comparison (default: 5). */
  topicWindowSize?: number
}

export type RollingSummaryScheduleInput = {
  userId: string
  sessionId: string
  triggerTurnId: string
  /** Session-resolved model id from the turn context (never hardcoded). */
  model?: string
  /** Session-resolved provider id (observability only). */
  providerId?: string
}

export type RollingSummarySchedulerResult =
  | { status: 'summarized'; summaryId: string }
  | { status: 'not_due'; reason: string }
  | { status: 'skipped'; reason: 'no_turns' | 'no_model' }
  | { status: 'failed'; errorCode: string }

export interface RollingSummaryScheduler {
  scheduleAfterTurn(input: RollingSummaryScheduleInput): void
  runOnce(input: RollingSummaryScheduleInput): Promise<RollingSummarySchedulerResult>
  drain(): Promise<void>
}

function renderConversation(turns: TurnTranscript[]): string {
  return turns
    .map((turn) => {
      const userMsg = turn.input.userMessageSummary ?? ''
      const assistantMsgs = turn.output.visibleMessages
        .filter((m) => m.role === 'assistant')
        .map((m) => m.content)
        .join('\n')
      return `[Turn ${turn.turnId}]\nUser: ${userMsg}\nAssistant: ${assistantMsgs}`
    })
    .join('\n\n')
}

/**
 * Highest turn already covered by a persisted rolling summary for this session.
 */
function findLastSummaryTurn(summaryStore: SummaryStore, sessionId: string, userId: string): number {
  let lastTurn = 0
  for (const summaryType of ['rolling_5_turns', 'rolling_10_turns'] as const) {
    for (const record of summaryStore.getByType(summaryType)) {
      if (record.sessionId !== sessionId || record.userId !== userId) {
        continue
      }
      const turnRange = record.structuredState?.turnRange as { endTurn?: unknown } | undefined
      const endTurn = turnRange?.endTurn
      if (typeof endTurn === 'number' && endTurn > lastTurn) {
        lastTurn = endTurn
      }
    }
  }
  return lastTurn
}

/**
 * Topic-shift confidence between the current window (ending at the trigger turn)
 * and the previous window. Returns 0 when there is no comparable history.
 */
function computeTopicShiftConfidence(
  detector: TopicShiftDetector,
  turns: TurnTranscript[],
  triggerIndex: number,
  windowSize: number,
): number {
  if (triggerIndex < 0) {
    return 0
  }

  const currentStart = Math.max(0, triggerIndex - windowSize + 1)
  const previousStart = Math.max(0, currentStart - windowSize)

  if (previousStart >= currentStart) {
    return 0
  }

  const currentText = renderConversation(turns.slice(currentStart, triggerIndex + 1))
  const previousText = renderConversation(turns.slice(previousStart, currentStart))
  const result = detector.detect(currentText, previousText)
  return result.confidence
}

async function runOnce(
  deps: RollingSummarySchedulerDeps,
  manager: SummaryManager,
  input: RollingSummaryScheduleInput,
): Promise<RollingSummarySchedulerResult> {
  try {
    const turns = deps.transcriptStore.findBySession(input.sessionId)
    if (turns.length === 0) {
      return { status: 'skipped', reason: 'no_turns' }
    }
    if (!input.model) {
      return { status: 'skipped', reason: 'no_model' }
    }

    const triggerIndex = turns.findIndex((turn) => turn.turnId === input.triggerTurnId)
    const turnCount = triggerIndex === -1 ? turns.length : triggerIndex + 1

    const policy = createRollingSummaryPolicy()
    const lastSummaryTurn = findLastSummaryTurn(deps.summaryStore, input.sessionId, input.userId)
    const detector = createTopicShiftDetector()
    const topicShiftConfidence = computeTopicShiftConfidence(
      detector,
      turns,
      triggerIndex,
      deps.topicWindowSize ?? DEFAULT_TOPIC_WINDOW_SIZE,
    )

    const evaluation = policy.evaluate({
      turnCount,
      lastSummaryTurn,
      topicShiftConfidence,
      eventType: 'turn_completed',
      sourceRefs: { transcriptRefs: turns.map((turn) => turn.turnId) },
      sessionId: input.sessionId,
      userId: input.userId,
    })

    if (!evaluation.shouldSummarize || !evaluation.turnRange) {
      return { status: 'not_due', reason: evaluation.reason }
    }

    const turnRange = evaluation.turnRange
    const coveredTurns = turns.slice(turnRange.startTurn - 1, turnRange.endTurn)
    const transcriptRefs = coveredTurns.map((turn) => turn.turnId)

    if (transcriptRefs.length === 0) {
      return { status: 'failed', errorCode: 'EMPTY_TURN_RANGE' }
    }

    const sourceRefs: SourceRefs = { transcriptRefs }

    const built = await buildSessionSummaryPrompt({
      sessionId: input.sessionId,
      userId: input.userId,
      conversationContent: renderConversation(coveredTurns),
      turnCount,
      startTime: coveredTurns[0]?.createdAt,
      endTime: coveredTurns[coveredTurns.length - 1]?.createdAt,
    })

    const request: LLMRequest = {
      model: input.model,
      messages: [{ role: 'user', content: built.prompt }],
      maxTokens: deps.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: deps.temperature ?? DEFAULT_TEMPERATURE,
      topP: deps.topP ?? DEFAULT_TOP_P,
    }

    const llmResult = await deps.llmAdapter.complete(request)

    if (!llmResult.success) {
      const errorCode = llmResult.error?.code ?? 'LLM_ERROR'
      return { status: 'failed', errorCode }
    }

    const summary = llmResult.response.content.trim()
    if (!summary) {
      return { status: 'failed', errorCode: 'EMPTY_SUMMARY' }
    }

    const summaryType =
      turnCount - lastSummaryTurn >= ROLLING_10_TURNS_MIN_SPAN ? 'rolling_10_turns' : 'rolling_5_turns'

    const writeResult = await manager.writeRollingSummary(
      input.sessionId,
      input.userId,
      summaryType,
      { summary, turnRange },
      { sourceRefs, isLlmGenerated: true },
    )

    if (!writeResult.success) {
      return { status: 'failed', errorCode: writeResult.code }
    }

    return { status: 'summarized', summaryId: writeResult.data.summaryId }
  } catch (error) {
    // Best-effort: a rolling-summary failure must never break message processing.
    console.warn('[rolling-summary-scheduler] best-effort rolling summary failed', error)
    return { status: 'failed', errorCode: 'SUMMARY_ERROR' }
  }
}

export function createRollingSummaryScheduler(deps: RollingSummarySchedulerDeps): RollingSummaryScheduler {
  const pending = new Set<Promise<unknown>>()
  const manager = deps.summaryManager ?? createSummaryManager(deps.summaryStore, deps.transcriptStore)

  return {
    scheduleAfterTurn(input: RollingSummaryScheduleInput): void {
      queueMicrotask(() => {
        const promise = runOnce(deps, manager, input).catch(() => {})
        pending.add(promise)
        promise.finally(() => {
          pending.delete(promise)
        })
      })
    },

    async runOnce(input: RollingSummaryScheduleInput): Promise<RollingSummarySchedulerResult> {
      return runOnce(deps, manager, input)
    },

    async drain(): Promise<void> {
      if (pending.size === 0) return
      await Promise.all([...pending])
    },
  }
}
