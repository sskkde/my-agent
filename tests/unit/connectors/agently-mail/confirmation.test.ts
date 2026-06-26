/**
 * Tests for AgentlyMailConfirmationManager — Stage 1 (startConfirmation),
 * cancelConfirmation, purgeExpired, and isConfirmationRequired.
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

const TRASH_PARAMS: Record<string, unknown> = { id: 'msg_abc123' }

function ctkStdout(token: string): string {
  return JSON.stringify({
    error: { code: 'MISSING_CONFIRMATION_TOKEN', message: `Confirmation required. Token: ${token}` },
  })
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('AgentlyMailConfirmationManager — stage 1', () => {
  let manager: AgentlyMailConfirmationManager

  beforeEach(() => { manager = new AgentlyMailConfirmationManager() })

  // ── isConfirmationRequired ─────────────────────────────────────────────────

  describe('isConfirmationRequired', () => {
    it('should return true for send_message', () => {
      expect(manager.isConfirmationRequired('send_message')).toBe(true)
    })

    it('should return true for reply_message', () => {
      expect(manager.isConfirmationRequired('reply_message')).toBe(true)
    })

    it('should return true for forward_message', () => {
      expect(manager.isConfirmationRequired('forward_message')).toBe(true)
    })

    it('should return true for trash_message', () => {
      expect(manager.isConfirmationRequired('trash_message')).toBe(true)
    })

    it('should return false for read operations', () => {
      expect(manager.isConfirmationRequired('list_messages')).toBe(false)
      expect(manager.isConfirmationRequired('read_message')).toBe(false)
      expect(manager.isConfirmationRequired('search_messages')).toBe(false)
      expect(manager.isConfirmationRequired('me')).toBe(false)
    })
  })

  // ── startConfirmation ──────────────────────────────────────────────────────

  describe('startConfirmation', () => {
    it('should return pending confirmation with token when exit code is 8', async () => {
      const { runner, calls } = createMockRunner(
        cliRunResult({ exitCode: 8, stdout: ctkStdout(CTK_TOKEN), stderr: '' }),
      )

      const result = await manager.startConfirmation(
        'send_message', SEND_PARAMS, runner, INSTANCE_ID, REQUEST_ID,
      )

      expect(result.response.status).toBe('failed')
      expect(result.response.error?.code).toBe('REQUIRES_CONFIRMATION')
      expect(result.response.error?.recoverable).toBe(true)
      expect(result.token).toBe(CTK_TOKEN)
      expect((result.response.metadata as Record<string, unknown>).confirmationToken).toBe(CTK_TOKEN)
      expect((result.response.metadata as Record<string, unknown>).expiresAt).toBeDefined()
      expect(calls).toHaveLength(1)
      expect(calls[0].argv).not.toContain('--confirmation-token')
    })

    it('should extract token from stderr when not in stdout', async () => {
      const { runner } = createMockRunner(
        cliRunResult({
          exitCode: 8,
          stdout: JSON.stringify({ error: { code: 'MISSING_CONFIRMATION_TOKEN', message: 'need token' } }),
          stderr: `missing confirmation token: ${CTK_TOKEN}`,
        }),
      )

      const result = await manager.startConfirmation(
        'send_message', SEND_PARAMS, runner, INSTANCE_ID, REQUEST_ID,
      )

      expect(result.token).toBe(CTK_TOKEN)
    })

    it('should store pending confirmation in the map', async () => {
      const { runner } = createMockRunner(
        cliRunResult({ exitCode: 8, stdout: ctkStdout(CTK_TOKEN), stderr: '' }),
      )

      await manager.startConfirmation('send_message', SEND_PARAMS, runner, INSTANCE_ID, REQUEST_ID)

      const pending = manager.pendingConfirmations.get(CTK_TOKEN)!
      expect(pending.operation).toBe('send_message')
      expect(pending.params).toEqual(SEND_PARAMS)
      expect(pending.expiresAt).toBeGreaterThan(Date.now())
    })

    it('should return normalized error when exit code 8 but no token found', async () => {
      const { runner } = createMockRunner(
        cliRunResult({
          exitCode: 8,
          stdout: JSON.stringify({ error: { code: 'MISSING_CONFIRMATION_TOKEN', message: 'no token' } }),
          stderr: '',
        }),
      )

      const result = await manager.startConfirmation(
        'send_message', SEND_PARAMS, runner, INSTANCE_ID, REQUEST_ID,
      )

      expect(result.response.status).toBe('failed')
      expect(result.response.error?.code).toBe('MISSING_CONFIRMATION_TOKEN')
      expect(result.token).toBeUndefined()
    })

    it('should return success response directly when exit code is 0', async () => {
      const { runner } = createMockRunner(
        cliRunResult({
          exitCode: 0,
          stdout: JSON.stringify({ data: { id: 'msg_xyz789' } }),
          stderr: '',
        }),
      )

      const result = await manager.startConfirmation(
        'send_message', SEND_PARAMS, runner, INSTANCE_ID, REQUEST_ID,
      )

      expect(result.response.status).toBe('success')
      expect(result.token).toBeUndefined()
    })

    it('should skip confirmation for non-write operations', async () => {
      const { runner, calls } = createMockRunner(cliRunResult())

      const result = await manager.startConfirmation(
        'list_messages', {}, runner, INSTANCE_ID, REQUEST_ID,
      )

      expect(result.response.status).toBe('success')
      expect(calls).toHaveLength(0)
    })

    it('should work for trash_message', async () => {
      const { runner } = createMockRunner(
        cliRunResult({ exitCode: 8, stdout: ctkStdout(CTK_TOKEN), stderr: '' }),
      )

      const result = await manager.startConfirmation(
        'trash_message', TRASH_PARAMS, runner, INSTANCE_ID, REQUEST_ID,
      )

      expect(result.token).toBe(CTK_TOKEN)
      expect(result.response.error?.code).toBe('REQUIRES_CONFIRMATION')
    })

    it('should pass CLI options to runner', async () => {
      const { runner, calls } = createMockRunner(
        cliRunResult({ exitCode: 8, stdout: ctkStdout(CTK_TOKEN), stderr: '' }),
      )

      const options: AgentlyCliRunnerOptions = { timeoutMs: 60_000 }
      await manager.startConfirmation(
        'send_message', SEND_PARAMS, runner, INSTANCE_ID, REQUEST_ID, options,
      )

      expect(calls[0].options).toBe(options)
    })

    it('should extract summary from error envelope message', async () => {
      const summary = `You are about to send an email. Token: ${CTK_TOKEN}`
      const { runner } = createMockRunner(
        cliRunResult({
          exitCode: 8,
          stdout: JSON.stringify({ error: { code: 'MISSING_CONFIRMATION_TOKEN', message: summary } }),
          stderr: '',
        }),
      )

      const result = await manager.startConfirmation(
        'send_message', SEND_PARAMS, runner, INSTANCE_ID, REQUEST_ID,
      )

      expect((result.response.metadata as Record<string, unknown>).summary).toBe(summary)
    })

    it('should redact tokens in stderr summary', async () => {
      const { runner } = createMockRunner(
        cliRunResult({
          exitCode: 8,
          stdout: 'not-json',
          stderr: `confirm with token ${CTK_TOKEN} please`,
        }),
      )

      const result = await manager.startConfirmation(
        'send_message', SEND_PARAMS, runner, INSTANCE_ID, REQUEST_ID,
      )

      const summary = (result.response.metadata as Record<string, unknown>).summary as string
      expect(summary).toContain('[REDACTED]')
      expect(summary).not.toContain(CTK_TOKEN)
    })
  })

  // ── cancelConfirmation ─────────────────────────────────────────────────────

  describe('cancelConfirmation', () => {
    it('should remove a pending confirmation', async () => {
      const { runner } = createMockRunner(
        cliRunResult({ exitCode: 8, stdout: ctkStdout(CTK_TOKEN), stderr: '' }),
      )
      await manager.startConfirmation('send_message', SEND_PARAMS, runner, INSTANCE_ID, REQUEST_ID)

      const removed = manager.cancelConfirmation(CTK_TOKEN)
      expect(removed).toBe(true)
      expect(manager.pendingConfirmations.has(CTK_TOKEN)).toBe(false)
    })

    it('should return false for non-existent token', () => {
      expect(manager.cancelConfirmation('ctk_nonexistent')).toBe(false)
    })
  })

  // ── purgeExpired ───────────────────────────────────────────────────────────

  describe('purgeExpired', () => {
    it('should remove expired entries', async () => {
      const { runner } = createMockRunner(
        cliRunResult({ exitCode: 8, stdout: ctkStdout(CTK_TOKEN), stderr: '' }),
      )
      await manager.startConfirmation('send_message', SEND_PARAMS, runner, INSTANCE_ID, REQUEST_ID)

      const pending = manager.pendingConfirmations.get(CTK_TOKEN)!
      manager.pendingConfirmations.set(CTK_TOKEN, { ...pending, expiresAt: Date.now() - 1000 })

      expect(manager.purgeExpired()).toBe(1)
      expect(manager.pendingConfirmations.has(CTK_TOKEN)).toBe(false)
    })

    it('should not remove non-expired entries', async () => {
      const { runner } = createMockRunner(
        cliRunResult({ exitCode: 8, stdout: ctkStdout(CTK_TOKEN), stderr: '' }),
      )
      await manager.startConfirmation('send_message', SEND_PARAMS, runner, INSTANCE_ID, REQUEST_ID)

      expect(manager.purgeExpired()).toBe(0)
      expect(manager.pendingConfirmations.has(CTK_TOKEN)).toBe(true)
    })
  })
})
