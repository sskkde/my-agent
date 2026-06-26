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

function makeRequest(params: Record<string, unknown>): ConnectorCallRequest {
  return {
    requestId: 'req_1',
    connectorInstanceId: 'inst_1',
    capabilityId: 'agently_mail.download_attachment',
    operation: 'download_attachment',
    params,
    userId: 'user_1',
  }
}

function createRunner(result: AgentlyCliRunResult): {
  readonly runner: AgentlyCliRunner
  readonly calls: readonly CapturedCall[]
} {
  const calls: CapturedCall[] = []
  const runner = {
    async run(operation: AgentlyMailOperation, argv: readonly string[]): Promise<AgentlyCliRunResult> {
      calls.push({ operation, argv })
      return result
    },
  }
  return { runner: runner as AgentlyCliRunner, calls }
}

describe('AgentlyMailAdapter attachment download', () => {
  it('runs download_attachment with validated upstream argv', async () => {
    const { runner, calls } = createRunner({
      stdout: JSON.stringify({ data: { saved: 'downloads/report.pdf' } }),
      stderr: '',
      exitCode: 0,
      envelope: null,
    })
    const adapter = new AgentlyMailAdapter(runner)

    const response = await adapter.execute(
      FAKE_INSTANCE,
      makeRequest({ msg: 'msg_123', att: 'att_456', output: 'downloads' }),
    ) as ConnectorResponse

    expect(calls).toHaveLength(1)
    expect(calls[0]?.operation).toBe('download_attachment')
    expect(calls[0]?.argv).toEqual([
      'attachment', '+download',
      '--msg', 'msg_123',
      '--att', 'att_456',
      '--output', 'downloads',
    ])
    expect(response.status).toBe('success')
  })

  it('rejects absolute output paths before invoking the runner', async () => {
    const { runner, calls } = createRunner({ stdout: '{}', stderr: '', exitCode: 0, envelope: null })
    const adapter = new AgentlyMailAdapter(runner)

    const response = await adapter.execute(
      FAKE_INSTANCE,
      makeRequest({ msg: 'msg_123', att: 'att_456', output: '/tmp/downloads' }),
    ) as ConnectorResponse

    expect(calls).toHaveLength(0)
    expect(response.status).toBe('failed')
    expect(response.error?.code).toBe('INVALID_PARAMETERS')
  })
})
