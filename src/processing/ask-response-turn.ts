import type { MessageProcessor, MessageProcessorInput, MessageProcessorError, MessageProcessorOutput } from './types.js'
import type { SessionBusyTracker } from './session-busy-tracker.js'
import type { AskStore, AskAnswer } from '../storage/ask-store.js'
import type { SessionStore } from '../storage/session-store.js'

export interface AskResponseTurnDeps {
  messageProcessor: MessageProcessor
  sessionBusyTracker: SessionBusyTracker
  askStore: AskStore
  sessionStore?: SessionStore
  runWithProvidersForUser?: <T>(userId: string, fn: () => Promise<T>, preferredProviderId?: string) => Promise<T>
  /** Delivery callback owned by the api layer, keeping processing channel-neutral. */
  deliverNotification: (
    kind: 'text' | 'error',
    content: { text?: string; error?: { code: string; message: string } },
    correlationId: string,
    userId: string,
    sessionId: string,
  ) => Promise<void>
}

export interface AskResponseTurnInput {
  askId: string
  userId: string
  sessionId: string
  answers: AskAnswer[]
  /** Question text for the model-context note; enriched by the route from the persisted ask. */
  question?: string
}

/**
 * Runs one synthetic continuation turn that injects the user's ask_user
 * answers into the next model turn. Exactly-once is guaranteed by an atomic
 * store claim; the per-session busy guard keeps it mutually exclusive with
 * user turns; failures roll the claim back so the answer stays deliverable.
 * Delivery is delegated to an injected callback so this module stays
 * channel-neutral. Never throws.
 */
export async function scheduleAskResponseTurn(deps: AskResponseTurnDeps, input: AskResponseTurnInput): Promise<void> {
  return scheduleAskResponseTurnInternal(deps, input, false)
}

async function scheduleAskResponseTurnInternal(
  deps: AskResponseTurnDeps,
  input: AskResponseTurnInput,
  isRetry: boolean,
): Promise<void> {
  try {
    if (deps.sessionBusyTracker.isBusy(input.sessionId)) {
      if (!isRetry) {
        deps.sessionBusyTracker.onIdle(input.sessionId, () => {
          void scheduleAskResponseTurnInternal(deps, input, true)
        })
      }
      return
    }

    if (!deps.askStore.claimResponse(input.askId, new Date().toISOString())) {
      return
    }

    await deps.sessionBusyTracker.withBusy(input.sessionId, async () => {
      const processorInput = createProcessorInput(input)

      let output: MessageProcessorOutput
      try {
        output = await runTurn(deps, input.userId, processorInput)
      } catch (error) {
        deps.askStore.unclaimResponse(input.askId)
        await deps.deliverNotification(
          'error',
          { error: toProcessorError(error) },
          processorInput.correlationId,
          input.userId,
          input.sessionId,
        )
        return
      }

      if (output.success) {
        await deps.deliverNotification(
          'text',
          { text: output.result?.text },
          processorInput.correlationId,
          input.userId,
          input.sessionId,
        )
        deps.sessionStore?.updateMetadata(input.sessionId, { lastActivityAt: new Date().toISOString() })
      } else {
        deps.askStore.unclaimResponse(input.askId)
        await deps.deliverNotification(
          'error',
          {
            error: {
              code: output.error?.code ?? 'PROCESSING_ERROR',
              message: output.error?.message ?? 'Ask response processing failed',
            },
          },
          processorInput.correlationId,
          input.userId,
          input.sessionId,
        )
      }
    })
  } catch (error) {
    // A throw here is a claim/delivery-level failure: if the turn already ran
    // the answer was consumed (no rollback); otherwise nothing was claimed.
    // Best-effort log only.
    console.error(`[AskResponseTurn] turn failed for ask ${input.askId}:`, error)
  }
}

function createProcessorInput(input: AskResponseTurnInput): MessageProcessorInput {
  return {
    correlationId: `turn-ask-${input.askId}-${Date.now().toString(36)}`,
    userId: input.userId,
    sessionId: input.sessionId,
    text: '',
    timestamp: new Date().toISOString(),
    metadata: {
      envelopeEventType: 'ask_response',
      askResponse: {
        askId: input.askId,
        answers: input.answers,
        ...(input.question ? { question: input.question } : {}),
      },
      autoTrigger: true,
    },
  }
}

async function runTurn(
  deps: AskResponseTurnDeps,
  userId: string,
  processorInput: MessageProcessorInput,
): Promise<MessageProcessorOutput> {
  const process = () => deps.messageProcessor.process(processorInput)
  return deps.runWithProvidersForUser ? deps.runWithProvidersForUser(userId, process) : process()
}

function toProcessorError(error: unknown): MessageProcessorError {
  if (error instanceof Error) {
    return { code: 'PROCESSING_ERROR', message: error.message }
  }
  return { code: 'PROCESSING_ERROR', message: 'Ask response processing failed' }
}
