import { describe, expect, it } from 'vitest'
import { AgentlyMailAdapter } from '../../../../src/connectors/agently-mail/adapter.js'
import type { AgentlyCliRunResult, AgentlyCliRunner } from '../../../../src/connectors/agently-mail/cli-runner.js'
import type { AgentlyMailOperation } from '../../../../src/connectors/agently-mail/types.js'
import type { ConnectorCallRequest, ConnectorInstance, ConnectorResponse } from '../../../../src/connectors/types.js'

const FAKE_INSTANCE = {
  id: 'inst_1',
  connectorInstanceId: 'inst_1',
  connectorDefinitionId: 'def_1',
  userId: 'user_1',
  name: 'Test',
  authStateRef: 'auth_ref_1',
  status: 'active' as const,
  config: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} satisfies ConnectorInstance

type CapturedCall = {
  readonly operation: AgentlyMailOperation
  readonly argv: readonly string[]
}

function makeRequest(overrides: Partial<ConnectorCallRequest> = {}): ConnectorCallRequest {
  return {
    requestId: 'req_1',
    connectorInstanceId: 'inst_1',
    capabilityId: 'agently_mail.send_message',
    operation: 'send_message',
    params: {},
    userId: 'user_1',
    ...overrides,
  }
}

function createQueuedRunner(results: readonly AgentlyCliRunResult[]): {
  readonly runner: AgentlyCliRunner
  readonly calls: readonly CapturedCall[]
} {
  const calls: CapturedCall[] = []
  const queue = [...results]
  const runner = {
    async run(operation: AgentlyMailOperation, argv: readonly string[]): Promise<AgentlyCliRunResult> {
      calls.push({ operation, argv })
      return queue.shift() ?? { stdout: '', stderr: '', exitCode: 0, envelope: null }
    },
  }
  return { runner: runner as AgentlyCliRunner, calls }
}

function confirmationStdout(token: string): string {
  return JSON.stringify({
    error: { code: 'MISSING_CONFIRMATION_TOKEN', message: `Confirmation required. Token: ${token}` },
  })
}

describe('AgentlyMailAdapter write confirmation', () => {
  it('starts send_message confirmation through the confirmation manager', async () => {
    const { runner, calls } = createQueuedRunner([
      { stdout: confirmationStdout('ctk_send_123'), stderr: '', exitCode: 8, envelope: null },
    ])
    const adapter = new AgentlyMailAdapter(runner)

    const response = await adapter.execute(
      FAKE_INSTANCE,
      makeRequest({
        params: { to: ['alice@example.com'], subject: 'Hello', body: 'World' },
      }),
    ) as ConnectorResponse

    expect(calls).toHaveLength(1)
    expect(calls[0]?.argv).toEqual(['message', '+send', '--to', 'alice@example.com', '--subject', 'Hello', '--body', 'World'])
    expect(response.status).toBe('failed')
    expect(response.error?.code).toBe('REQUIRES_CONFIRMATION')
    expect(response.error?.recoverable).toBe(true)
    expect(response.metadata?.confirmationToken).toBe('ctk_send_123')
  })

  it('confirms send_message with unchanged params and confirmation token', async () => {
    const params = { to: ['alice@example.com'], subject: 'Hello', body: 'World' }
    const { runner, calls } = createQueuedRunner([
      { stdout: confirmationStdout('ctk_send_456'), stderr: '', exitCode: 8, envelope: null },
      { stdout: JSON.stringify({ data: { id: 'msg_sent_1' } }), stderr: '', exitCode: 0, envelope: null },
    ])
    const adapter = new AgentlyMailAdapter(runner)

    await adapter.execute(FAKE_INSTANCE, makeRequest({ params }))
    const response = await adapter.execute(
      FAKE_INSTANCE,
      makeRequest({ params: { ...params, confirmationToken: 'ctk_send_456' } }),
    ) as ConnectorResponse

    expect(calls).toHaveLength(2)
    expect(calls[1]?.argv).toEqual([
      'message', '+send',
      '--to', 'alice@example.com',
      '--subject', 'Hello',
      '--body', 'World',
      '--confirmation-token', 'ctk_send_456',
    ])
    expect(response.status).toBe('success')
    expect(response.data).toEqual({ id: 'msg_sent_1' })
  })
})
