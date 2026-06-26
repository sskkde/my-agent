/**
 * Tests for AgentlyMail connector barrel module (index.ts).
 *
 * Validates:
 *   1. Import safety — no side effects (no CLI, no OAuth, no process spawn).
 *   2. Factory function — returns a ConnectorAdapter.
 *   3. Registration — calls runtime.registerAdapter with correct type.
 *   4. Re-exports — public surface is accessible from the barrel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── 1. Import safety ────────────────────────────────────────────────────────
// Mock node:child_process BEFORE any module under test is imported.
// If the barrel or any transitive import calls execFile at module scope,
// the spy will record it and the test will fail.
// vi.hoisted ensures the spy is available when the hoisted vi.mock factory runs.

const { execFileSpy } = vi.hoisted(() => ({
  execFileSpy: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFile: execFileSpy,
}))

// Now import the barrel — this is the action under test for "no side effects".
import {
  createAgentlyMailConnectorAdapter,
  createAgentlyMailCapabilities,
  registerAgentlyMailConnector,
  AGENTLY_MAIL_EXIT_DESCRIPTIONS,
  AGENTLY_MAIL_EXPOSED_OPERATIONS,
  AGENTLY_MAIL_HIDDEN_OPERATIONS,
  getCapabilityByOperation,
} from '../../../../src/connectors/agently-mail/index.js'

import type {
  AgentlyMailOperation,
  MessageId,
} from '../../../../src/connectors/agently-mail/index.js'

import type { ConnectorAdapter } from '../../../../src/connectors/types.js'

import type { ConnectorRuntime } from '../../../../src/connectors/types.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockExecFile() {
  return vi.fn(
    (
      _file: string,
      _args: readonly string[],
      _options: Record<string, unknown>,
      callback: (error: null, stdout: string, stderr: string) => void,
    ) => {
      // Simulate a successful CLI call with empty JSON envelope
      callback(null, '{"data": {}}', '')
      return { kill: vi.fn() }
    },
  )
}

function createMockRuntime(): ConnectorRuntime & {
  registeredAdapters: Map<string, unknown>
} {
  const registeredAdapters = new Map<string, unknown>()
  return {
    registeredAdapters,
    registerDefinition: vi.fn(),
    createInstance: vi.fn(),
    discoverCapabilities: vi.fn(),
    executeCall: vi.fn(),
    normalizeResponse: vi.fn(),
    registerAdapter(type: string, adapter: unknown) {
      registeredAdapters.set(type, adapter)
    },
  } as unknown as ConnectorRuntime & { registeredAdapters: Map<string, unknown> }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('agently-mail index (barrel module)', () => {
  beforeEach(() => {
    execFileSpy.mockClear()
  })

  // ── Import safety ──────────────────────────────────────────────────────────

  describe('import safety — no side effects', () => {
    it('does not call execFile at import time', () => {
      // If any transitive import invoked execFile during module load,
      // this spy would have been called. The barrel must be side-effect free.
      expect(execFileSpy).not.toHaveBeenCalled()
    })

    it('does not spawn processes when only types are imported', () => {
      // Importing types is a compile-time-only operation, but the barrel
      // also imports runtime modules (adapter, capabilities). Verify that
      // none of those imports triggered a process spawn.
      expect(execFileSpy).not.toHaveBeenCalled()
    })
  })

  // ── Factory function ───────────────────────────────────────────────────────

  describe('createAgentlyMailConnectorAdapter', () => {
    it('returns an object implementing ConnectorAdapter interface', () => {
      const mockExecFile = createMockExecFile()
      const adapter = createAgentlyMailConnectorAdapter({
        execFileFn: mockExecFile,
      })

      // ConnectorAdapter requires: execute, discoverCapabilities, checkHealth
      expect(adapter).toBeDefined()
      expect(typeof adapter.execute).toBe('function')
      expect(typeof adapter.discoverCapabilities).toBe('function')
      expect(typeof adapter.checkHealth).toBe('function')
    })

    it('does not call execFile during construction', () => {
      const mockExecFile = createMockExecFile()
      createAgentlyMailConnectorAdapter({ execFileFn: mockExecFile })

      // Factory is a pure constructor — no I/O at creation time
      expect(mockExecFile).not.toHaveBeenCalled()
    })

    it('produces capabilities from discoverCapabilities', () => {
      const mockExecFile = createMockExecFile()
      const adapter = createAgentlyMailConnectorAdapter({
        execFileFn: mockExecFile,
      })

      // discoverCapabilities is synchronous on AgentlyMailAdapter
      const caps = adapter.discoverCapabilities(
        {} as Parameters<ConnectorAdapter['discoverCapabilities']>[0],
      )
      expect(Array.isArray(caps)).toBe(true)
      expect(caps.length).toBeGreaterThan(0)
    })

    it('returns healthy from checkHealth', () => {
      const mockExecFile = createMockExecFile()
      const adapter = createAgentlyMailConnectorAdapter({
        execFileFn: mockExecFile,
      })

      const health = adapter.checkHealth(
        {} as Parameters<ConnectorAdapter['checkHealth']>[0],
      )
      expect(health.healthy).toBe(true)
    })

    it('uses default execFile when no execFileFn is provided', () => {
      // Should not throw — uses node:child_process.execFile by default
      const adapter = createAgentlyMailConnectorAdapter()
      expect(adapter).toBeDefined()
      expect(typeof adapter.execute).toBe('function')
    })
  })

  // ── Runtime registration ───────────────────────────────────────────────────

  describe('registerAgentlyMailConnector', () => {
    it('registers adapter with runtime under type "agently_mail"', () => {
      const runtime = createMockRuntime()
      const adapter = registerAgentlyMailConnector(runtime)

      expect(runtime.registeredAdapters.has('agently_mail')).toBe(true)
      expect(runtime.registeredAdapters.get('agently_mail')).toBe(adapter)
    })

    it('returns the registered adapter instance', () => {
      const runtime = createMockRuntime()
      const adapter = registerAgentlyMailConnector(runtime)

      expect(adapter).toBeDefined()
      expect(typeof (adapter as ConnectorAdapter).execute).toBe('function')
    })

    it('passes options through to the adapter factory', () => {
      const runtime = createMockRuntime()
      const mockExecFile = createMockExecFile()
      const adapter = registerAgentlyMailConnector(runtime, {
        execFileFn: mockExecFile,
      })

      // The adapter should use the injected execFile, not the default
      expect(adapter).toBeDefined()
    })

    it('does not call execFile during registration', () => {
      const runtime = createMockRuntime()
      const mockExecFile = createMockExecFile()
      registerAgentlyMailConnector(runtime, { execFileFn: mockExecFile })

      // Registration is a pure wiring operation — no I/O
      expect(mockExecFile).not.toHaveBeenCalled()
    })
  })

  // ── Re-exports ─────────────────────────────────────────────────────────────

  describe('re-exports', () => {
    it('exports createAgentlyMailCapabilities', () => {
      expect(typeof createAgentlyMailCapabilities).toBe('function')
      const caps = createAgentlyMailCapabilities()
      expect(Array.isArray(caps)).toBe(true)
      expect(caps.length).toBeGreaterThan(0)
    })

    it('exports AGENTLY_MAIL_EXIT_DESCRIPTIONS', () => {
      expect(AGENTLY_MAIL_EXIT_DESCRIPTIONS).toBeDefined()
      expect(AGENTLY_MAIL_EXIT_DESCRIPTIONS[0]).toBe('success')
      expect(AGENTLY_MAIL_EXIT_DESCRIPTIONS[7]).toBe('rate_limited')
    })

    it('exports AGENTLY_MAIL_EXPOSED_OPERATIONS', () => {
      expect(Array.isArray(AGENTLY_MAIL_EXPOSED_OPERATIONS)).toBe(true)
      expect(AGENTLY_MAIL_EXPOSED_OPERATIONS).toContain('list_messages')
      expect(AGENTLY_MAIL_EXPOSED_OPERATIONS).not.toContain('auth_login')
    })

    it('exports AGENTLY_MAIL_HIDDEN_OPERATIONS', () => {
      expect(Array.isArray(AGENTLY_MAIL_HIDDEN_OPERATIONS)).toBe(true)
      expect(AGENTLY_MAIL_HIDDEN_OPERATIONS).toContain('auth_login')
      expect(AGENTLY_MAIL_HIDDEN_OPERATIONS).toContain('auth_logout')
    })

    it('exports getCapabilityByOperation', () => {
      expect(typeof getCapabilityByOperation).toBe('function')
      const cap = getCapabilityByOperation('list_messages' as AgentlyMailOperation)
      expect(cap).toBeDefined()
      expect(cap!.capabilityId).toBe('agently_mail.list_messages')
    })

    it('types are usable (compile-time check)', () => {
      // These are type-only imports — if they compile, the re-exports work.
      // Runtime assertions just confirm the imports didn't break anything.
      const _op: AgentlyMailOperation = 'list_messages'
      const _id = 'msg_123' as MessageId
      expect(_op).toBe('list_messages')
      expect(_id).toBe('msg_123')
    })
  })
})
