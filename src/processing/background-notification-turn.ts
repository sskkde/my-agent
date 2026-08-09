import type { MessageProcessor, MessageProcessorInput, MessageProcessorError, MessageProcessorOutput } from './types.js'
import type { Gateway } from '../gateway/gateway.js'
import type { ChannelRegistry } from '../gateway/channel-registry.js'
import type { SessionBusyTracker } from './session-busy-tracker.js'
import type { BackgroundRunStore } from '../storage/background-run-store.js'
import type { SessionStore } from '../storage/session-store.js'

export interface BackgroundNotificationTurnDeps {
  messageProcessor: MessageProcessor
  gateway: Gateway
  channelRegistry: ChannelRegistry
  sessionBusyTracker: SessionBusyTracker
  backgroundRunStore: BackgroundRunStore
  sessionStore?: SessionStore
  runWithProvidersForUser?: <T>(userId: string, fn: () => Promise<T>, preferredProviderId?: string) => Promise<T>
}

export interface BackgroundNotificationTurnInput {
  userId: string
  sessionId: string
  backgroundRunId: string
  type: 'completed' | 'failed' | 'cancelled'
  summary: string
}

const WEBUI_CHANNEL = 'webui'

/**
 * Runs one synthetic parent turn for a terminal background-run notification.
 * Exactly-once is guaranteed by an atomic store claim; the per-session busy
 * guard keeps it mutually exclusive with user turns; failures roll the claim
 * back so the notification stays pending; output only reaches the webui
 * channel. Never throws.
 */
export async function scheduleBackgroundNotificationTurn(
  deps: BackgroundNotificationTurnDeps,
  input: BackgroundNotificationTurnInput,
): Promise<void> {
  return scheduleBackgroundNotificationTurnInternal(deps, input, false)
}

async function scheduleBackgroundNotificationTurnInternal(
  deps: BackgroundNotificationTurnDeps,
  input: BackgroundNotificationTurnInput,
  isRetry: boolean,
): Promise<void> {
  try {
    // Busy guard runs BEFORE the claim: while a turn is running the
    // notification stays pending for the collect fallback. One onIdle retry
    // drains it once the session frees up; a retry that finds the session
    // still busy does not re-register (collect covers it).
    if (deps.sessionBusyTracker.isBusy(input.sessionId)) {
      if (!isRetry) {
        deps.sessionBusyTracker.onIdle(input.sessionId, () => {
          void scheduleBackgroundNotificationTurnInternal(deps, input, true)
        })
      }
      return
    }

    // Atomic exactly-once claim: only the winning caller proceeds; runs
    // already consumed by collect return false here.
    if (!deps.backgroundRunStore.claimNotification(input.backgroundRunId, new Date().toISOString())) {
      return
    }

    await deps.sessionBusyTracker.withBusy(input.sessionId, async () => {
      const processorInput = createProcessorInput(input)

      let output: MessageProcessorOutput
      try {
        output = await runTurn(deps, input.userId, processorInput)
      } catch (error) {
        // The process call exploded: roll the claim back so the notification
        // stays pending, then surface an error envelope best-effort.
        deps.backgroundRunStore.unclaimNotification(input.backgroundRunId)
        await deliverErrorEnvelope(deps, input, processorInput.correlationId, toProcessorError(error))
        return
      }

      if (output.success) {
        await deliverTextEnvelope(deps, input, processorInput.correlationId, output.result?.text)
        deps.sessionStore?.updateMetadata(input.sessionId, { lastActivityAt: new Date().toISOString() })
      } else {
        // Processing reported failure: roll back and keep the notification pending.
        deps.backgroundRunStore.unclaimNotification(input.backgroundRunId)
        await deliverErrorEnvelope(deps, input, processorInput.correlationId, output.error)
      }
    })
  } catch (error) {
    // A throw here is a claim/delivery-level failure: if the turn already ran
    // the notification was consumed (no rollback); otherwise nothing was
    // claimed. Best-effort log only.
    console.error(`[BackgroundNotificationTurn] turn failed for run ${input.backgroundRunId}:`, error)
  }
}

function createProcessorInput(input: BackgroundNotificationTurnInput): MessageProcessorInput {
  return {
    correlationId: `turn-bg-${input.backgroundRunId}-${Date.now().toString(36)}`,
    userId: input.userId,
    sessionId: input.sessionId,
    text: '',
    timestamp: new Date().toISOString(),
    metadata: {
      envelopeEventType: 'background_notification',
      sourceBackgroundRunId: input.backgroundRunId,
      autoTrigger: true,
      notificationType: input.type,
    },
  }
}

async function runTurn(
  deps: BackgroundNotificationTurnDeps,
  userId: string,
  processorInput: MessageProcessorInput,
): Promise<MessageProcessorOutput> {
  const process = () => deps.messageProcessor.process(processorInput)
  return deps.runWithProvidersForUser ? deps.runWithProvidersForUser(userId, process) : process()
}

async function deliverTextEnvelope(
  deps: BackgroundNotificationTurnDeps,
  input: BackgroundNotificationTurnInput,
  correlationId: string,
  text: string | undefined,
): Promise<void> {
  const envelope = deps.gateway.formatOutbound(
    'text',
    { text },
    { userId: input.userId, sessionId: input.sessionId, channel: WEBUI_CHANNEL },
    correlationId,
  )
  await deps.channelRegistry.deliver(WEBUI_CHANNEL, envelope)
}

async function deliverErrorEnvelope(
  deps: BackgroundNotificationTurnDeps,
  input: BackgroundNotificationTurnInput,
  correlationId: string,
  error: MessageProcessorError | undefined,
): Promise<void> {
  const envelope = deps.gateway.formatOutbound(
    'error',
    {
      error: {
        code: error?.code ?? 'PROCESSING_ERROR',
        message: error?.message ?? 'Background notification processing failed',
      },
    },
    { userId: input.userId, sessionId: input.sessionId, channel: WEBUI_CHANNEL },
    correlationId,
  )
  await deps.channelRegistry.deliver(WEBUI_CHANNEL, envelope)
}

function toProcessorError(error: unknown): MessageProcessorError {
  if (error instanceof Error) {
    return { code: 'PROCESSING_ERROR', message: error.message }
  }
  return { code: 'PROCESSING_ERROR', message: 'Background notification processing failed' }
}
