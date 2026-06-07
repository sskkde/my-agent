import { describe, it, expect } from 'vitest'
import type { ForegroundDecision } from '../../../src/foreground/types.js'
import { closeSmokeHarness, createSession, createSmokeHarness, waitForCondition } from './smoke-test-utils.js'

describe('MVP smoke: session foreground tool dispatch', () => {
  it('runs session → foreground → tool dispatch without external services', async () => {
    const mockDecision: ForegroundDecision = {
      route: 'dispatch_tool',
      requiresPlanner: false,
      reason: 'Test routing',
      suggestedTools: ['docs_search'],
    }

    const harness = await createSmokeHarness({
      username: 'smoke-tool-user',
      foregroundDecision: mockDecision,
      enableToolCall: true,
    })

    try {
      const sessionId = await createSession(harness)
      const messageResponse = await fetch(`${harness.baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: harness.authCookie },
        body: JSON.stringify({ text: 'search deterministic smoke docs' }),
      })

      expect(messageResponse.status).toBe(202)
      const messageBody = (await messageResponse.json()) as { data: { correlationId: string } }

      await waitForCondition(() => {
        const actions = harness.baseCtx.stores.runtimeActionStore.query({ sessionId })
        expect(actions.some((action) => action.actionType === 'execute_tool')).toBe(true)
      })

      await waitForCondition(() => {
        const transcripts = harness.baseCtx.stores.transcriptStore.findBySession(sessionId)
        expect(transcripts.some((turn) => turn.turnId === messageBody.data.correlationId)).toBe(true)
      })

      const transcriptResponse = await fetch(`${harness.baseUrl}/api/v1/sessions/${sessionId}/transcripts`, {
        headers: { Cookie: harness.authCookie },
      })
      expect(transcriptResponse.status).toBe(200)
      const transcriptBody = (await transcriptResponse.json()) as { data: { transcripts: Array<{ turnId: string }> } }
      expect(transcriptBody.data.transcripts.some((turn) => turn.turnId === messageBody.data.correlationId)).toBe(true)

      const timelineResponse = await fetch(`${harness.baseUrl}/api/v1/sessions/${sessionId}/timeline`, {
        headers: { Cookie: harness.authCookie },
      })
      expect(timelineResponse.status).toBe(200)
      const timelineBody = (await timelineResponse.json()) as { data: { items: Array<{ eventType: string }> } }
      const eventTypes = timelineBody.data.items.map((item) => item.eventType)

      expect(eventTypes).toContain('system_status')

      await waitForCondition(() => {
        const actions = harness.baseCtx.stores.runtimeActionStore.query({ sessionId })
        const toolAction = actions.find((action) => action.actionType === 'execute_tool')
        expect(toolAction).toBeDefined()
        expect(toolAction?.status).toBe('completed')
        expect(toolAction?.payload.toolName).toBe('docs_search')

        const toolCallId = toolAction?.payload.toolCallId
        expect(typeof toolCallId).toBe('string')
        const toolExecution = harness.baseCtx.stores.toolExecutionStore.getById(toolCallId as string)
        expect(toolExecution?.toolName).toBe('docs_search')
        expect(toolExecution?.status).toBe('completed')
      })
    } finally {
      await closeSmokeHarness(harness)
    }
  }, 15000)
})
