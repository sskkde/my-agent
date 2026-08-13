import { describe, it, expect, vi } from 'vitest'
import { SessionBusyTracker } from '../../../src/processing/session-busy-tracker.js'
import type { AskResponseTurnDeps } from '../../../src/processing/ask-response-turn.js'
import { scheduleAskResponseTurn } from '../../../src/processing/ask-response-turn.js'
import type { MessageProcessorInput, MessageProcessorOutput } from '../../../src/processing/types.js'
import type { AskStore } from '../../../src/storage/ask-store.js'
import type { SessionStore } from '../../../src/storage/session-store.js'

const input = {
  askId: 'ask_1',
  userId: 'user-1',
  sessionId: 'sess-1',
  answers: [{ value: 'shanghai', label: 'Shanghai' }],
}

function successOutput(): MessageProcessorOutput {
  return {
    correlationId: 'corr-1',
    success: true,
    result: { text: 'Got it, booking Shanghai.' },
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
  const askStore = {
    claimResponse: vi.fn(() => true),
    unclaimResponse: vi.fn(),
  }
  const sessionBusyTracker = overrides.sessionBusyTracker ?? new SessionBusyTracker()
  const sessionStore = {
    updateMetadata: vi.fn(() => true),
  }

  const deps: AskResponseTurnDeps = {
    messageProcessor,
    sessionBusyTracker,
    askStore: askStore as unknown as AskStore,
    sessionStore: sessionStore as unknown as SessionStore,
    deliverNotification,
  }

  return { deps, messageProcessor, deliverNotification, askStore, sessionStore }
}

describe('scheduleAskResponseTurn', () => {
  it('claims and processes exactly once when the session is free', async () => {
    const { deps, messageProcessor, askStore, deliverNotification, sessionStore } = createDeps()

    await scheduleAskResponseTurn(deps, input)

    expect(askStore.claimResponse).toHaveBeenCalledTimes(1)
    expect(askStore.claimResponse).toHaveBeenCalledWith('ask_1', expect.any(String))
    expect(messageProcessor.process).toHaveBeenCalledTimes(1)

    const processorInput = messageProcessor.process.mock.calls[0][0] as MessageProcessorInput
    expect(processorInput.correlationId).toMatch(/^turn-ask-/)
    expect(processorInput.correlationId).toContain('ask_1')
    expect(processorInput.text).toBe('')
    expect(processorInput.userId).toBe('user-1')
    expect(processorInput.sessionId).toBe('sess-1')
    expect(processorInput.metadata).toMatchObject({
      envelopeEventType: 'ask_response',
      askResponse: {
        askId: 'ask_1',
        answers: [{ value: 'shanghai', label: 'Shanghai' }],
      },
      autoTrigger: true,
    })

    expect(deliverNotification).toHaveBeenCalledTimes(1)
    expect(deliverNotification).toHaveBeenCalledWith(
      'text',
      { text: 'Got it, booking Shanghai.' },
      expect.stringMatching(/^turn-ask-/),
      'user-1',
      'sess-1',
    )
    expect(sessionStore.updateMetadata).toHaveBeenCalledWith('sess-1', { lastActivityAt: expect.any(String) })
  })

  it('carries the question through to the processor metadata when provided', async () => {
    const { deps, messageProcessor } = createDeps()

    await scheduleAskResponseTurn(deps, { ...input, question: 'Which city?' })

    const processorInput = messageProcessor.process.mock.calls[0][0] as MessageProcessorInput
    expect(processorInput.metadata).toMatchObject({
      envelopeEventType: 'ask_response',
      askResponse: {
        askId: 'ask_1',
        answers: [{ value: 'shanghai', label: 'Shanghai' }],
        question: 'Which city?',
      },
      autoTrigger: true,
    })
  })

  it('does not process when the claim fails (already claimed)', async () => {
    const { deps, messageProcessor, askStore, deliverNotification } = createDeps()
    askStore.claimResponse.mockReturnValue(false)

    await scheduleAskResponseTurn(deps, input)

    expect(askStore.claimResponse).toHaveBeenCalledTimes(1)
    expect(messageProcessor.process).not.toHaveBeenCalled()
    expect(askStore.unclaimResponse).not.toHaveBeenCalled()
    expect(deliverNotification).not.toHaveBeenCalled()
  })

  it('does not claim or process while busy and retries once via onIdle', async () => {
    const tracker = new SessionBusyTracker()
    tracker.markBusy('sess-1')
    const onIdleSpy = vi.spyOn(tracker, 'onIdle')
    const { deps, messageProcessor, askStore } = createDeps({ sessionBusyTracker: tracker })

    await scheduleAskResponseTurn(deps, input)

    expect(askStore.claimResponse).not.toHaveBeenCalled()
    expect(messageProcessor.process).not.toHaveBeenCalled()
    expect(onIdleSpy).toHaveBeenCalledTimes(1)
    expect(onIdleSpy.mock.calls[0][0]).toBe('sess-1')

    // The session frees up; the registered onIdle retry must perform a second
    // attempt (claim + process).
    tracker.clearBusy('sess-1')
    const retryCallback = onIdleSpy.mock.calls[0][1] as () => void
    retryCallback()

    await vi.waitFor(() => expect(askStore.claimResponse).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(messageProcessor.process).toHaveBeenCalledTimes(1))
  })

  it('rolls back the claim and delivers an error envelope when process reports failure', async () => {
    const { deps, messageProcessor, askStore, deliverNotification } = createDeps()
    messageProcessor.process.mockResolvedValue(errorOutput())

    await scheduleAskResponseTurn(deps, input)

    expect(askStore.unclaimResponse).toHaveBeenCalledWith('ask_1')
    expect(deliverNotification).toHaveBeenCalledTimes(1)
    expect(deliverNotification).toHaveBeenCalledWith(
      'error',
      { error: { code: 'LLM_FAILED', message: 'provider exploded' } },
      expect.stringMatching(/^turn-ask-/),
      'user-1',
      'sess-1',
    )
  })

  it('swallows a throwing process, rolls back the claim, and does not propagate', async () => {
    const { deps, messageProcessor, askStore, deliverNotification } = createDeps()
    messageProcessor.process.mockRejectedValue(new Error('kaboom'))

    await expect(scheduleAskResponseTurn(deps, input)).resolves.toBeUndefined()

    expect(askStore.unclaimResponse).toHaveBeenCalledWith('ask_1')
    expect(messageProcessor.process).toHaveBeenCalledTimes(1)
    expect(deliverNotification).toHaveBeenCalledWith(
      'error',
      { error: { code: 'PROCESSING_ERROR', message: 'kaboom' } },
      expect.stringMatching(/^turn-ask-/),
      'user-1',
      'sess-1',
    )
  })

  it('wraps the process call in runWithProvidersForUser when provided', async () => {
    const { deps, messageProcessor } = createDeps()
    const providerScopes: string[] = []
    const runWithProvidersForUser: AskResponseTurnDeps['runWithProvidersForUser'] = async <T>(
      userId: string,
      fn: () => Promise<T>,
    ): Promise<T> => {
      providerScopes.push(userId)
      return fn()
    }
    deps.runWithProvidersForUser = runWithProvidersForUser

    await scheduleAskResponseTurn(deps, input)

    expect(providerScopes).toEqual(['user-1'])
    expect(messageProcessor.process).toHaveBeenCalledTimes(1)
  })
})
