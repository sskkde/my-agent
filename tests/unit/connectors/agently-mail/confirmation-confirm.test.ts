/**
 * Tests for AgentlyMailConfirmationManager — Stage 2 (confirmOperation)
 * and full two-stage flow integration.
 * Mocks the AgentlyCliRunner; never calls real agently-cli.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  AgentlyMailConfirmationManager,
} from '../../../../src/connectors/agently-mail/confirmation.js'
import type { AgentlyCliRunResult } from '../../../../src/connectors/agently-mail/cli-runner.js'
import type { AgentlyCliRunnerOptions } from '../../../../src/connectors/agently-mail/cli-runner.js'
import type { AgentlyMailOperation } from '../../../../src/connectors/agently-mail/types.js'

// ─── Mock runner ───────────────────────────────────────────────────────────────

interface MockRunnerCall {
  operation: AgentlyMailOperation
  argv: readonly string[]
  options?: AgentlyCliRunnerOptions
}

function createMockRunner(result: AgentlyCliRunResult) {
  const calls: MockRunnerCall[] = []
  return {
    runner: {
      run: vi.fn(
        async (
          operation: AgentlyMailOperation,
          argv: readonly string[],
          options?: AgentlyCliRunnerOptions,
        ): Promise<AgentlyCliRunResult> => {
          calls.push({ operation, argv, options })
          return result
        },
      ),
    } as unknown as import('../../../../src/connectors/agently-mail/cli-runner.js').AgentlyCliRunner,
    calls,
  }
}

function cliRunResult(overrides: Partial<AgentlyCliRunResult> = {}): AgentlyCliRunResult {
  return { stdout: '', stderr: '', exitCode: 0, envelope: null, ...overrides }
}

// ─── Test data ─────────────────────────────────────────────────────────────────

const INSTANCE_ID = 'conn-agently-001'
const REQUEST_ID = 'req-test-001'
const CTK_TOKEN = 'ctk_abc123def456'

const SEND_PARAMS: Record<string, unknown> = {
  to: ['alice@example.com'],
  subject: 'Hello',
  body: 'World',
}

function ctkStdout(token: string): string {
  return JSON.stringify({
    error: { code: 'MISSING_CONFIRMATION_TOKEN', message: `Confirmation required. Token: ${token}` },
  })
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('AgentlyMailConfirmationManager — stage 2', () => {
  let manager: AgentlyMailConfirmationManager

  beforeEach(() => { manager = new AgentlyMailConfirmationManager() })

  // ── confirmOperation ───────────────────────────────────────────────────────

  describe('confirmOperation', () => {
    it('should proceed with matching token and unchanged params', async () => {
      // Stage 1
      const { runner: runner1 } = createMockRunner(
        cliRunResult({ exitCode: 8, stdout: ctkStdout(CTK_TOKEN), stderr: '' }),
      )
      await manager.startConfirmation('send_message', SEND_PARAMS, runner1, INSTANCE_ID, REQUEST_ID)

      // Stage 2
      const { runner: runner2, calls } = createMockRunner(
        cliRunResult({ exitCode: 0, stdout: JSON.stringify({ data: { id: 'msg_sent_001' } }) }),
      )
      const result = await manager.confirmOperation(
        CTK_TOKEN, SEND_PARAMS, runner2, INSTANCE_ID, REQUEST_ID,
      )

      expect(result.status).toBe('success')
      expect(result.data).toEqual({ id: 'msg_sent_001' })
      expect(calls[0].argv).toContain('--confirmation-token')
      expect(calls[0].argv).toContain(CTK_TOKEN)
      expect(manager.pendingConfirmations.has(CTK_TOKEN)).toBe(false)
    })

    it('should reject unknown token', async () => {
      const { runner } = createMockRunner(cliRunResult())
      const result = await manager.confirmOperation(
        'ctk_unknown', SEND_PARAMS, runner, INSTANCE_ID, REQUEST_ID,
      )

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('INVALID_CONFIRMATION_TOKEN')
      expect(result.error?.recoverable).toBe(false)
    })

    it('should reject expired token', async () => {
      const { runner: runner1 } = createMockRunner(
        cliRunResult({ exitCode: 8, stdout: ctkStdout(CTK_TOKEN), stderr: '' }),
      )
      await manager.startConfirmation('send_message', SEND_PARAMS, runner1, INSTANCE_ID, REQUEST_ID)

      // Manually expire
      const pending = manager.pendingConfirmations.get(CTK_TOKEN)!
      manager.pendingConfirmations.set(CTK_TOKEN, { ...pending, expiresAt: Date.now() - 1000 })

      const { runner: runner2 } = createMockRunner(cliRunResult())
      const result = await manager.confirmOperation(
        CTK_TOKEN, SEND_PARAMS, runner2, INSTANCE_ID, REQUEST_ID,
      )

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('CONFIRMATION_TOKEN_EXPIRED')
      expect(result.error?.recoverable).toBe(true)
      expect(manager.pendingConfirmations.has(CTK_TOKEN)).toBe(false)
    })

    it('should reject when params changed between stages', async () => {
      const { runner: runner1 } = createMockRunner(
        cliRunResult({ exitCode: 8, stdout: ctkStdout(CTK_TOKEN), stderr: '' }),
      )
      await manager.startConfirmation('send_message', SEND_PARAMS, runner1, INSTANCE_ID, REQUEST_ID)

      const changedParams = { ...SEND_PARAMS, body: 'Changed body!' }
      const { runner: runner2 } = createMockRunner(cliRunResult())
      const result = await manager.confirmOperation(
        CTK_TOKEN, changedParams, runner2, INSTANCE_ID, REQUEST_ID,
      )

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('CONFIRMATION_PARAMS_CHANGED')
      expect(result.error?.recoverable).toBe(true)
      expect(manager.pendingConfirmations.has(CTK_TOKEN)).toBe(false)
    })

    it('should reject when recipients changed between stages', async () => {
      const { runner: runner1 } = createMockRunner(
        cliRunResult({ exitCode: 8, stdout: ctkStdout(CTK_TOKEN), stderr: '' }),
      )
      await manager.startConfirmation('send_message', SEND_PARAMS, runner1, INSTANCE_ID, REQUEST_ID)

      const changedParams = { ...SEND_PARAMS, to: ['bob@example.com'] }
      const { runner: runner2 } = createMockRunner(cliRunResult())
      const result = await manager.confirmOperation(
        CTK_TOKEN, changedParams, runner2, INSTANCE_ID, REQUEST_ID,
      )

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('CONFIRMATION_PARAMS_CHANGED')
    })

    it('should clean up pending confirmation even on CLI error', async () => {
      const { runner: runner1 } = createMockRunner(
        cliRunResult({ exitCode: 8, stdout: ctkStdout(CTK_TOKEN), stderr: '' }),
      )
      await manager.startConfirmation('send_message', SEND_PARAMS, runner1, INSTANCE_ID, REQUEST_ID)

      const { runner: runner2 } = createMockRunner(
        cliRunResult({ exitCode: 1, stdout: '', stderr: 'server error' }),
      )
      const result = await manager.confirmOperation(
        CTK_TOKEN, SEND_PARAMS, runner2, INSTANCE_ID, REQUEST_ID,
      )

      expect(result.status).toBe('failed')
      expect(manager.pendingConfirmations.has(CTK_TOKEN)).toBe(false)
    })

    it('should pass CLI options to runner', async () => {
      const { runner: runner1 } = createMockRunner(
        cliRunResult({ exitCode: 8, stdout: ctkStdout(CTK_TOKEN), stderr: '' }),
      )
      await manager.startConfirmation('send_message', SEND_PARAMS, runner1, INSTANCE_ID, REQUEST_ID)

      const { runner: runner2, calls } = createMockRunner(
        cliRunResult({ exitCode: 0, stdout: '{}' }),
      )
      const options: AgentlyCliRunnerOptions = { timeoutMs: 120_000 }
      await manager.confirmOperation(CTK_TOKEN, SEND_PARAMS, runner2, INSTANCE_ID, REQUEST_ID, options)

      expect(calls[0].options).toBe(options)
    })

    it('should work for reply_message', async () => {
      const replyParams: Record<string, unknown> = { id: 'msg_original', body: 'Thanks!' }

      const { runner: runner1 } = createMockRunner(
        cliRunResult({ exitCode: 8, stdout: ctkStdout(CTK_TOKEN), stderr: '' }),
      )
      await manager.startConfirmation('reply_message', replyParams, runner1, INSTANCE_ID, REQUEST_ID)

      const { runner: runner2 } = createMockRunner(
        cliRunResult({ exitCode: 0, stdout: JSON.stringify({ data: { id: 'msg_reply_001' } }) }),
      )
      const result = await manager.confirmOperation(
        CTK_TOKEN, replyParams, runner2, INSTANCE_ID, REQUEST_ID,
      )

      expect(result.status).toBe('success')
    })
  })

  // ── Full two-stage flow ────────────────────────────────────────────────────

  describe('full two-stage flow', () => {
    it('should stop after Stage 1 and wait for explicit confirmation', async () => {
      const { runner: runner1 } = createMockRunner(
        cliRunResult({ exitCode: 8, stdout: ctkStdout(CTK_TOKEN), stderr: '' }),
      )
      const stage1 = await manager.startConfirmation(
        'send_message', SEND_PARAMS, runner1, INSTANCE_ID, REQUEST_ID,
      )

      expect(stage1.token).toBeDefined()
      expect(stage1.response.error?.code).toBe('REQUIRES_CONFIRMATION')

      const { runner: runner2 } = createMockRunner(
        cliRunResult({ exitCode: 0, stdout: JSON.stringify({ data: { id: 'msg_sent_final' } }) }),
      )
      const stage2 = await manager.confirmOperation(
        stage1.token!, SEND_PARAMS, runner2, INSTANCE_ID, REQUEST_ID,
      )

      expect(stage2.status).toBe('success')
      expect(stage2.data).toEqual({ id: 'msg_sent_final' })
    })

    it('should handle multiple concurrent confirmations', async () => {
      const token1 = 'ctk_token1'
      const token2 = 'ctk_token2'
      const params1: Record<string, unknown> = { to: ['a@b.com'], subject: 'S1', body: 'B1' }
      const params2: Record<string, unknown> = { to: ['c@d.com'], subject: 'S2', body: 'B2' }

      const { runner: r1 } = createMockRunner(
        cliRunResult({ exitCode: 8, stdout: ctkStdout(token1), stderr: '' }),
      )
      const { runner: r2 } = createMockRunner(
        cliRunResult({ exitCode: 8, stdout: ctkStdout(token2), stderr: '' }),
      )
      await manager.startConfirmation('send_message', params1, r1, INSTANCE_ID, REQUEST_ID)
      await manager.startConfirmation('send_message', params2, r2, INSTANCE_ID, REQUEST_ID)

      expect(manager.pendingConfirmations.size).toBe(2)

      const { runner: r3 } = createMockRunner(
        cliRunResult({ exitCode: 0, stdout: '{"data":{"id":"msg2"}}' }),
      )
      const result2 = await manager.confirmOperation(token2, params2, r3, INSTANCE_ID, REQUEST_ID)
      expect(result2.status).toBe('success')
      expect(manager.pendingConfirmations.size).toBe(1)
      expect(manager.pendingConfirmations.has(token1)).toBe(true)
    })

    it('should reject reusing a token after confirmation', async () => {
      const { runner: r1 } = createMockRunner(
        cliRunResult({ exitCode: 8, stdout: ctkStdout(CTK_TOKEN), stderr: '' }),
      )
      await manager.startConfirmation('send_message', SEND_PARAMS, r1, INSTANCE_ID, REQUEST_ID)

      const { runner: r2 } = createMockRunner(
        cliRunResult({ exitCode: 0, stdout: '{"data":{"id":"msg1"}}' }),
      )
      await manager.confirmOperation(CTK_TOKEN, SEND_PARAMS, r2, INSTANCE_ID, REQUEST_ID)

      const { runner: r3 } = createMockRunner(cliRunResult())
      const result = await manager.confirmOperation(CTK_TOKEN, SEND_PARAMS, r3, INSTANCE_ID, REQUEST_ID)

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('INVALID_CONFIRMATION_TOKEN')
    })
  })
})
