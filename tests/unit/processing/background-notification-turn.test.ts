import { describe, it, expect, vi } from 'vitest'
import { SessionBusyTracker } from '../../../src/processing/session-busy-tracker.js'
import type { BackgroundNotificationTurnDeps } from '../../../src/processing/background-notification-turn.js'
import { scheduleBackgroundNotificationTurn } from '../../../src/processing/background-notification-turn.js'
import type { MessageProcessorInput, MessageProcessorOutput } from '../../../src/processing/types.js'
import type { BackgroundRunStore } from '../../../src/storage/background-run-store.js'
import type { SessionStore } from '../../../src/storage/session-store.js'

const input = {
  userId: 'user-1',
  sessionId: 'sess-1',
  backgroundRunId: 'bg-1',
  type: 'completed' as const,
  summary: 'Task finished',
}

function successOutput(): MessageProcessorOutput {
  return {
    correlationId: 'corr-1',
    success: true,
    result: { text: 'Task finished' },
    timestamp: new Date().toISOString(),
  }
}

function errorOutput(): MessageProcessorOutput {
  return {
    correlationId: 'corr-1',
    success: false,
    error: { code: 'LLM_FAILED', message: 'provider exploded' },
    timestamp: new Date().toISOString(),
  }
}

function createDeps(overrides: { sessionBusyTracker?: SessionBusyTracker } = {}) {
  const messageProcessor = {
    process: vi.fn(async (_input: MessageProcessorInput): Promise<MessageProcessorOutput> => successOutput()),
  }
  const deliverNotification = vi.fn(
    async (
      _kind: 'text' | 'error',
      _content: { text?: string; error?: { code: string; message: string } },
      _correlationId: string,
      _userId: string,
      _sessionId: string,
    ) => {},
  )
  const backgroundRunStore = {
    claimNotification: vi.fn(() => true),
    unclaimNotification: vi.fn(),
  }
  const sessionBusyTracker = overrides.sessionBusyTracker ?? new SessionBusyTracker()
  const sessionStore = {
    updateMetadata: vi.fn(() => true),
  }

  const deps: BackgroundNotificationTurnDeps = {
    messageProcessor,
    sessionBusyTracker,
    backgroundRunStore: backgroundRunStore as unknown as BackgroundRunStore,
    sessionStore: sessionStore as unknown as SessionStore,
    deliverNotification,
  }

  return { deps, messageProcessor, deliverNotification, backgroundRunStore, sessionStore }
}

describe('scheduleBackgroundNotificationTurn', () => {
  it('claims and processes exactly once when the session is free', async () => {
    const { deps, messageProcessor, backgroundRunStore, deliverNotification, sessionStore } = createDeps()

    await scheduleBackgroundNotificationTurn(deps, input)

    expect(backgroundRunStore.claimNotification).toHaveBeenCalledTimes(1)
    expect(backgroundRunStore.claimNotification).toHaveBeenCalledWith('bg-1', expect.any(String))
    expect(messageProcessor.process).toHaveBeenCalledTimes(1)

    const processorInput = messageProcessor.process.mock.calls[0][0] as MessageProcessorInput
    expect(processorInput.correlationId).toMatch(/^turn-bg-/)
    expect(processorInput.correlationId).toContain('bg-1')
    expect(processorInput.text).toBe('')
    expect(processorInput.userId).toBe('user-1')
    expect(processorInput.sessionId).toBe('sess-1')
    expect(processorInput.metadata).toMatchObject({
      envelopeEventType: 'background_notification',
      sourceBackgroundRunId: 'bg-1',
      autoTrigger: true,
      notificationType: 'completed',
    })

    expect(deliverNotification).toHaveBeenCalledTimes(1)
    expect(deliverNotification).toHaveBeenCalledWith(
      'text',
      { text: 'Task finished' },
      expect.stringMatching(/^turn-bg-/),
      'user-1',
      'sess-1',
    )
    expect(sessionStore.updateMetadata).toHaveBeenCalledWith('sess-1', { lastActivityAt: expect.any(String) })
  })

  it('does not process when the claim fails (already delivered or claimed)', async () => {
    const { deps, messageProcessor, backgroundRunStore, deliverNotification } = createDeps()
    backgroundRunStore.claimNotification.mockReturnValue(false)

    await scheduleBackgroundNotificationTurn(deps, input)

    expect(backgroundRunStore.claimNotification).toHaveBeenCalledTimes(1)
    expect(messageProcessor.process).not.toHaveBeenCalled()
    expect(backgroundRunStore.unclaimNotification).not.toHaveBeenCalled()
    expect(deliverNotification).not.toHaveBeenCalled()
  })

  it('does not claim or process while busy and retries once via onIdle', async () => {
    const tracker = new SessionBusyTracker()
    tracker.markBusy('sess-1')
    const onIdleSpy = vi.spyOn(tracker, 'onIdle')
    const { deps, messageProcessor, backgroundRunStore } = createDeps({ sessionBusyTracker: tracker })

    await scheduleBackgroundNotificationTurn(deps, input)

    expect(backgroundRunStore.claimNotification).not.toHaveBeenCalled()
    expect(messageProcessor.process).not.toHaveBeenCalled()
    expect(onIdleSpy).toHaveBeenCalledTimes(1)
    expect(onIdleSpy.mock.calls[0][0]).toBe('sess-1')

    // The session frees up; the registered onIdle retry must perform a second
    // attempt (claim + process).
    tracker.clearBusy('sess-1')
    const retryCallback = onIdleSpy.mock.calls[0][1] as () => void
    retryCallback()

    await vi.waitFor(() => expect(backgroundRunStore.claimNotification).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(messageProcessor.process).toHaveBeenCalledTimes(1))
  })

  it('rolls back the claim and delivers an error envelope when process reports failure', async () => {
    const { deps, messageProcessor, backgroundRunStore, deliverNotification } = createDeps()
    messageProcessor.process.mockResolvedValue(errorOutput())

    await scheduleBackgroundNotificationTurn(deps, input)

    expect(backgroundRunStore.unclaimNotification).toHaveBeenCalledWith('bg-1')
    expect(deliverNotification).toHaveBeenCalledTimes(1)
    expect(deliverNotification).toHaveBeenCalledWith(
      'error',
      { error: { code: 'LLM_FAILED', message: 'provider exploded' } },
      expect.stringMatching(/^turn-bg-/),
      'user-1',
      'sess-1',
    )
  })

  it('swallows a throwing process, rolls back the claim, and does not propagate', async () => {
    const { deps, messageProcessor, backgroundRunStore, deliverNotification } = createDeps()
    messageProcessor.process.mockRejectedValue(new Error('kaboom'))

    await expect(scheduleBackgroundNotificationTurn(deps, input)).resolves.toBeUndefined()

    expect(backgroundRunStore.unclaimNotification).toHaveBeenCalledWith('bg-1')
    expect(messageProcessor.process).toHaveBeenCalledTimes(1)
    expect(deliverNotification).toHaveBeenCalledWith(
      'error',
      { error: { code: 'PROCESSING_ERROR', message: 'kaboom' } },
      expect.stringMatching(/^turn-bg-/),
      'user-1',
      'sess-1',
    )
  })

  it('delivers via the injected deliverNotification callback only', async () => {
    const { deps, deliverNotification } = createDeps()

    await scheduleBackgroundNotificationTurn(deps, input)

    // The callback is the sole delivery surface: no channel id, envelope
    // construction, or registry lives in the processing module.
    expect(deliverNotification).toHaveBeenCalledTimes(1)
    expect(deliverNotification).toHaveBeenCalledWith(
      'text',
      { text: 'Task finished' },
      expect.stringMatching(/^turn-bg-/),
      'user-1',
      'sess-1',
    )
  })

  it('wraps the process call in runWithProvidersForUser when provided', async () => {
    const { deps, messageProcessor } = createDeps()
    const providerScopes: string[] = []
    const runWithProvidersForUser: BackgroundNotificationTurnDeps['runWithProvidersForUser'] = async <T>(
      userId: string,
      fn: () => Promise<T>,
    ): Promise<T> => {
      providerScopes.push(userId)
      return fn()
    }
    deps.runWithProvidersForUser = runWithProvidersForUser

    await scheduleBackgroundNotificationTurn(deps, input)

    expect(providerScopes).toEqual(['user-1'])
    expect(messageProcessor.process).toHaveBeenCalledTimes(1)
  })
})
