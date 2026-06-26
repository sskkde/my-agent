/**
 * Tests for AgentlyMailAdapter — argv construction and response normalisation.
 * Uses a fake runner that captures argv and returns fixture JSON.
 * Never calls real agently-cli.
 */

import { describe, it, expect } from 'vitest'
import { AgentlyMailAdapter } from '../../../../src/connectors/agently-mail/adapter.js'
import type { AgentlyCliRunner, AgentlyCliRunResult } from '../../../../src/connectors/agently-mail/cli-runner.js'
import type { AgentlyMailOperation } from '../../../../src/connectors/agently-mail/types.js'
import type { ConnectorInstance } from '../../../../src/connectors/types.js'
import type { ConnectorCallRequest, ConnectorResponse } from '../../../../src/connectors/types.js'

// ─── Fixtures ──────────────────────────────────────────────────────────────────

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

function makeRequest(overrides: Partial<ConnectorCallRequest> = {}): ConnectorCallRequest {
  return {
    requestId: 'req_1',
    connectorInstanceId: 'inst_1',
    capabilityId: 'agently-mail.me',
    operation: 'me',
    params: {},
    userId: 'user_1',
    ...overrides,
  }
}

// ─── Fake runner ───────────────────────────────────────────────────────────────

type CapturedCall = {
  operation: AgentlyMailOperation
  argv: readonly string[]
}

function createFakeRunner(fixtureStdout: string, fixtureExitCode = 0): {
  runner: AgentlyCliRunner
  calls: CapturedCall[]
} {
  const calls: CapturedCall[] = []

  const runner = {
    async run(
      operation: AgentlyMailOperation,
      argv: readonly string[],
    ): Promise<AgentlyCliRunResult> {
      calls.push({ operation, argv })
      return {
        stdout: fixtureStdout,
        stderr: '',
        exitCode: fixtureExitCode,
        envelope: null,
      }
    },
  } as unknown as AgentlyCliRunner

  return { runner, calls }
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('AgentlyMailAdapter', () => {
  // ── me ──────────────────────────────────────────────────────────────────────

  describe('execute("me")', () => {
    it('builds argv ["+me"] and returns normalised success', async () => {
      const fixture = JSON.stringify({ data: { id: 'u_1', email: 'test@example.com' } })
      const { runner, calls } = createFakeRunner(fixture)
      const adapter = new AgentlyMailAdapter(runner)

      const result = (await adapter.execute(
        FAKE_INSTANCE,
        makeRequest({ operation: 'me', capabilityId: 'agently-mail.me' }),
      )) as ConnectorResponse

      expect(calls).toHaveLength(1)
      expect(calls[0]!.operation).toBe('me')
      expect(calls[0]!.argv).toEqual(['+me'])
      expect(result.status).toBe('success')
    })
  })

  // ── auth_status ─────────────────────────────────────────────────────────────

  describe('execute("auth_status")', () => {
    it('builds argv ["+status"] and returns normalised success', async () => {
      const fixture = JSON.stringify({ data: { authenticated: true } })
      const { runner, calls } = createFakeRunner(fixture)
      const adapter = new AgentlyMailAdapter(runner)

      const result = (await adapter.execute(
        FAKE_INSTANCE,
        makeRequest({ operation: 'auth_status', capabilityId: 'agently-mail.auth_status' }),
      )) as ConnectorResponse

      expect(calls).toHaveLength(1)
      expect(calls[0]!.operation).toBe('auth_status')
      expect(calls[0]!.argv).toEqual(['+status'])
      expect(result.status).toBe('success')
    })
  })

  // ── list_messages ───────────────────────────────────────────────────────────

  describe('execute("list_messages")', () => {
    it('builds argv with --dir inbox --limit 10', async () => {
      const fixture = JSON.stringify({ data: { messages: [], nextCursor: null } })
      const { runner, calls } = createFakeRunner(fixture)
      const adapter = new AgentlyMailAdapter(runner)

      const result = (await adapter.execute(
        FAKE_INSTANCE,
        makeRequest({
          operation: 'list_messages',
          capabilityId: 'agently-mail.list_messages',
          params: { dir: 'inbox', limit: 10 },
        }),
      )) as ConnectorResponse

      expect(calls).toHaveLength(1)
      expect(calls[0]!.operation).toBe('list_messages')
      expect(calls[0]!.argv).toEqual(['message', '+list', '--dir', 'inbox', '--limit', '10'])
      expect(result.status).toBe('success')
    })

    it('builds argv with all optional params', async () => {
      const fixture = JSON.stringify({ data: { messages: [] } })
      const { runner, calls } = createFakeRunner(fixture)
      const adapter = new AgentlyMailAdapter(runner)

      await adapter.execute(
        FAKE_INSTANCE,
        makeRequest({
          operation: 'list_messages',
          capabilityId: 'agently-mail.list_messages',
          params: {
            dir: 'sent',
            limit: 25,
            cursor: 'cur_abc',
            after: '2025-01-01',
            before: '2025-06-01',
            hasAttachments: true,
            isUnread: true,
          },
        }),
      )

      expect(calls[0]!.argv).toEqual([
        'message', '+list',
        '--dir', 'sent',
        '--limit', '25',
        '--cursor', 'cur_abc',
        '--after', '2025-01-01',
        '--before', '2025-06-01',
        '--has-attachments',
        '--is-unread',
      ])
    })

    it('builds argv with no optional params (bare list)', async () => {
      const fixture = JSON.stringify({ data: { messages: [] } })
      const { runner, calls } = createFakeRunner(fixture)
      const adapter = new AgentlyMailAdapter(runner)

      await adapter.execute(
        FAKE_INSTANCE,
        makeRequest({
          operation: 'list_messages',
          capabilityId: 'agently-mail.list_messages',
          params: {},
        }),
      )

      expect(calls[0]!.argv).toEqual(['message', '+list'])
    })
  })

  // ── read_message ────────────────────────────────────────────────────────────

  describe('execute("read_message")', () => {
    it('builds argv with --id msg_xxx', async () => {
      const fixture = JSON.stringify({
        data: { id: 'msg_123', subject: 'Hello', body: 'World' },
      })
      const { runner, calls } = createFakeRunner(fixture)
      const adapter = new AgentlyMailAdapter(runner)

      const result = (await adapter.execute(
        FAKE_INSTANCE,
        makeRequest({
          operation: 'read_message',
          capabilityId: 'agently-mail.read_message',
          params: { id: 'msg_123' },
        }),
      )) as ConnectorResponse

      expect(calls).toHaveLength(1)
      expect(calls[0]!.operation).toBe('read_message')
      expect(calls[0]!.argv).toEqual(['message', '+read', '--id', 'msg_123'])
      expect(result.status).toBe('success')
    })

    it('returns validation failure for invalid message ID (no msg_ prefix)', async () => {
      const { runner, calls } = createFakeRunner('{}')
      const adapter = new AgentlyMailAdapter(runner)

      const result = (await adapter.execute(
        FAKE_INSTANCE,
        makeRequest({
          operation: 'read_message',
          capabilityId: 'agently-mail.read_message',
          params: { id: 'bad_id_123' },
        }),
      )) as ConnectorResponse

      // Runner should NOT be called
      expect(calls).toHaveLength(0)
      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error!.code).toBe('INVALID_PARAMETERS')
      expect(result.error!.message).toContain('msg_')
    })

    it('returns validation failure for missing id param', async () => {
      const { runner, calls } = createFakeRunner('{}')
      const adapter = new AgentlyMailAdapter(runner)

      const result = (await adapter.execute(
        FAKE_INSTANCE,
        makeRequest({
          operation: 'read_message',
          capabilityId: 'agently-mail.read_message',
          params: {},
        }),
      )) as ConnectorResponse

      expect(calls).toHaveLength(0)
      expect(result.status).toBe('failed')
      expect(result.error!.code).toBe('INVALID_PARAMETERS')
    })

    it('returns validation failure for numeric id', async () => {
      const { runner, calls } = createFakeRunner('{}')
      const adapter = new AgentlyMailAdapter(runner)

      const result = (await adapter.execute(
        FAKE_INSTANCE,
        makeRequest({
          operation: 'read_message',
          capabilityId: 'agently-mail.read_message',
          params: { id: 42 },
        }),
      )) as ConnectorResponse

      expect(calls).toHaveLength(0)
      expect(result.status).toBe('failed')
      expect(result.error!.code).toBe('INVALID_PARAMETERS')
    })
  })

  // ── search_messages ─────────────────────────────────────────────────────────

  describe('execute("search_messages")', () => {
    it('builds argv with --q "test"', async () => {
      const fixture = JSON.stringify({ data: { messages: [] } })
      const { runner, calls } = createFakeRunner(fixture)
      const adapter = new AgentlyMailAdapter(runner)

      const result = (await adapter.execute(
        FAKE_INSTANCE,
        makeRequest({
          operation: 'search_messages',
          capabilityId: 'agently-mail.search_messages',
          params: { q: 'test' },
        }),
      )) as ConnectorResponse

      expect(calls).toHaveLength(1)
      expect(calls[0]!.operation).toBe('search_messages')
      expect(calls[0]!.argv).toEqual(['message', '+search', '--q', 'test'])
      expect(result.status).toBe('success')
    })

    it('builds argv with all search params', async () => {
      const fixture = JSON.stringify({ data: { messages: [] } })
      const { runner, calls } = createFakeRunner(fixture)
      const adapter = new AgentlyMailAdapter(runner)

      await adapter.execute(
        FAKE_INSTANCE,
        makeRequest({
          operation: 'search_messages',
          capabilityId: 'agently-mail.search_messages',
          params: {
            q: 'invoice',
            searchIn: 'SEARCH_IN_SUBJECT',
            from: 'boss@corp.com',
            to: 'me@corp.com',
            dir: 'inbox',
            after: '2025-01-01',
            before: '2025-06-01',
            hasAttachments: true,
            isUnread: true,
            limit: 5,
            cursor: 'cur_xyz',
          },
        }),
      )

      expect(calls[0]!.argv).toEqual([
        'message', '+search',
        '--q', 'invoice',
        '--search-in', 'SEARCH_IN_SUBJECT',
        '--from', 'boss@corp.com',
        '--to', 'me@corp.com',
        '--dir', 'inbox',
        '--after', '2025-01-01',
        '--before', '2025-06-01',
        '--has-attachments',
        '--is-unread',
        '--limit', '5',
        '--cursor', 'cur_xyz',
      ])
    })

    it('preserves cursor in pagination (search conditions retained)', async () => {
      const fixture = JSON.stringify({ data: { messages: [], nextCursor: 'cur_next' } })
      const { runner, calls } = createFakeRunner(fixture)
      const adapter = new AgentlyMailAdapter(runner)

      await adapter.execute(
        FAKE_INSTANCE,
        makeRequest({
          operation: 'search_messages',
          capabilityId: 'agently-mail.search_messages',
          params: { q: 'important', dir: 'inbox', cursor: 'cur_page2' },
        }),
      )

      // Cursor must be appended alongside the original conditions
      expect(calls[0]!.argv).toEqual([
        'message', '+search',
        '--q', 'important',
        '--dir', 'inbox',
        '--cursor', 'cur_page2',
      ])
    })
  })

  // ── write operations ────────────────────────────────────────────────────────

  describe('write operations route through confirmation flow', () => {
    const writeOps = ['send_message', 'reply_message', 'forward_message', 'trash_message'] as const

    for (const op of writeOps) {
      it(`${op} invokes the runner instead of short-circuiting as unimplemented`, async () => {
        const { runner, calls } = createFakeRunner(JSON.stringify({ data: { ok: true } }))
        const adapter = new AgentlyMailAdapter(runner)

        const result = (await adapter.execute(
          FAKE_INSTANCE,
          makeRequest({
            operation: op,
            capabilityId: `agently-mail.${op}`,
            params: { id: 'msg_1', to: ['a@b.com'], subject: 'x', body: 'y' },
          }),
        )) as ConnectorResponse

        expect(calls).toHaveLength(1)
        expect(result.status).toBe('success')
      })
    }
  })

  // ── unknown operation ───────────────────────────────────────────────────────

  describe('unknown operation', () => {
    it('returns INVALID_PARAMETERS without calling runner', async () => {
      const { runner, calls } = createFakeRunner('{}')
      const adapter = new AgentlyMailAdapter(runner)

      const result = (await adapter.execute(
        FAKE_INSTANCE,
        makeRequest({
          operation: 'do_something_random',
          capabilityId: 'agently-mail.unknown',
          params: {},
        }),
      )) as ConnectorResponse

      expect(calls).toHaveLength(0)
      expect(result.status).toBe('failed')
      expect(result.error!.code).toBe('INVALID_PARAMETERS')
      expect(result.error!.message).toContain('Unknown operation')
    })
  })

  // ── CLI failure normalisation ───────────────────────────────────────────────

  describe('CLI failure passthrough', () => {
    it('normalises exit code 3 as auth_required', async () => {
      const errEnv = JSON.stringify({ error: { code: 'AUTH_EXPIRED', message: 'Token expired' } })
      const { runner } = createFakeRunner(errEnv, 3)
      const adapter = new AgentlyMailAdapter(runner)

      const result = (await adapter.execute(
        FAKE_INSTANCE,
        makeRequest({ operation: 'me', capabilityId: 'agently-mail.me' }),
      )) as ConnectorResponse

      expect(result.status).toBe('auth_required')
      expect(result.error!.code).toBe('AUTH_EXPIRED')
    })

    it('normalises exit code 7 as rate_limited with retryAfterMs', async () => {
      const errEnv = JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } })
      const { runner } = createFakeRunner(errEnv, 7)
      const adapter = new AgentlyMailAdapter(runner)

      const result = (await adapter.execute(
        FAKE_INSTANCE,
        makeRequest({ operation: 'me', capabilityId: 'agently-mail.me' }),
      )) as ConnectorResponse

      expect(result.status).toBe('rate_limited')
      expect(result.metadata?.retryAfterMs).toBeDefined()
    })
  })

  // ── discoverCapabilities ────────────────────────────────────────────────────

  describe('discoverCapabilities()', () => {
    it('returns all agently-mail capabilities', () => {
      const { runner } = createFakeRunner('{}')
      const adapter = new AgentlyMailAdapter(runner)

      const caps = adapter.discoverCapabilities(FAKE_INSTANCE)

      expect(caps.length).toBeGreaterThanOrEqual(6)
      const ids = caps.map((c) => c.capabilityId)
      expect(ids).toContain('agently_mail.me')
      expect(ids).toContain('agently_mail.list_messages')
      expect(ids).toContain('agently_mail.read_message')
      expect(ids).toContain('agently_mail.search_messages')
      expect(ids).toContain('agently_mail.send_message')
    })
  })

  // ── checkHealth ─────────────────────────────────────────────────────────────

  describe('checkHealth()', () => {
    it('returns healthy true', () => {
      const { runner } = createFakeRunner('{}')
      const adapter = new AgentlyMailAdapter(runner)

      const health = adapter.checkHealth(FAKE_INSTANCE)

      expect(health.healthy).toBe(true)
      expect(health.message).toBeDefined()
    })
  })
})
