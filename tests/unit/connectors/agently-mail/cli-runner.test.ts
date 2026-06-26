/**
 * Tests for AgentlyCliRunner — safe subprocess execution via execFile.
 * Mocks at the execFile boundary; never calls real agently-cli.
 */

import { describe, it, expect } from 'vitest'
import {
  AgentlyCliRunner,
  type ExecFileFn,
} from '../../../../src/connectors/agently-mail/cli-runner.js'
import type { AgentlyMailCliEnvelope } from '../../../../src/connectors/agently-mail/types.js'

// ─── Mock helpers ──────────────────────────────────────────────────────────────

type MockExecFileArgs = {
  exitCode?: number
  stdout?: string
  stderr?: string
  error?: Error & { code?: string | number; killed?: boolean; signal?: string }
  delayMs?: number
}

function createMockExecFile(args: MockExecFileArgs = {}): {
  fn: ExecFileFn
  calls: Array<{ file: string; args: readonly string[]; options: Record<string, unknown> }>
} {
  const calls: Array<{ file: string; args: readonly string[]; options: Record<string, unknown> }> = []

  const fn: ExecFileFn = (file, execArgs, options, callback) => {
    calls.push({ file, args: execArgs, options })

    const invoke = () => {
      if (args.error) {
        callback(args.error, args.stdout ?? '', args.stderr ?? '')
      } else {
        callback(null, args.stdout ?? '', args.stderr ?? '')
      }
    }

    if (args.delayMs && args.delayMs > 0) {
      const timer = setTimeout(invoke, args.delayMs)
      // Allow abort to clear the timer
      return {
        kill: (_signal?: string) => {
          clearTimeout(timer)
          // Simulate killed process
          callback(
            { message: 'killed', code: 1, killed: true, signal: 'SIGTERM' },
            args.stdout ?? '',
            args.stderr ?? '',
          )
          return true
        },
      }
    }

    invoke()
    return { kill: () => true }
  }

  return { fn, calls }
}

function successEnvelope<T>(data: T): string {
  return JSON.stringify({ data })
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('AgentlyCliRunner', () => {
  // --- exit codes ---

  describe('exit code handling', () => {
    const exitCodes = [0, 1, 2, 3, 4, 6, 7, 8] as const

    for (const code of exitCodes) {
      it(`should capture exit code ${code}`, async () => {
        const envelope: AgentlyMailCliEnvelope = code === 0
          ? { data: { ok: true } }
          : { error: { code: `E${code}`, message: `fail-${code}` } }

        const stdout = JSON.stringify(envelope)
        const error = code === 0
          ? undefined
          : Object.assign(new Error(`exit ${code}`), { code, killed: false, signal: undefined as string | undefined })

        const { fn } = createMockExecFile({
          stdout,
          stderr: '',
          ...(error ? { error } : {}),
        })

        const runner = new AgentlyCliRunner(fn)
        const result = await runner.run('me', [])

        expect(result.exitCode).toBe(code)
        expect(result.envelope).toEqual(envelope)
      })
    }

    it('should set exitCode 1 for signal-killed process (no numeric code)', async () => {
      const error = Object.assign(new Error('killed'), {
        code: undefined as string | number | undefined,
        killed: true,
        signal: 'SIGTERM',
      })

      const { fn } = createMockExecFile({ stdout: '', stderr: '', error })
      const runner = new AgentlyCliRunner(fn)
      const result = await runner.run('me', [])

      expect(result.exitCode).toBe(1)
    })
  })

  // --- JSON envelope parsing ---

  describe('JSON envelope parsing', () => {
    it('should parse a success envelope from stdout', async () => {
      const envelope = { data: { id: 'msg_123', subject: 'hello' } }
      const { fn } = createMockExecFile({ stdout: JSON.stringify(envelope) })
      const runner = new AgentlyCliRunner(fn)
      const result = await runner.run('read_message', ['--id', 'msg_123'])

      expect(result.envelope).toEqual(envelope)
      expect(result.exitCode).toBe(0)
    })

    it('should parse an error envelope from stdout', async () => {
      const envelope = { error: { code: 'AUTH_EXPIRED', message: 'token expired' } }
      const { fn } = createMockExecFile({
        stdout: JSON.stringify(envelope),
        error: Object.assign(new Error('exit 3'), { code: 3, killed: false }),
      })
      const runner = new AgentlyCliRunner(fn)
      const result = await runner.run('list_messages', [])

      expect(result.envelope).toEqual(envelope)
      expect(result.exitCode).toBe(3)
    })

    it('should return null envelope for non-JSON stdout', async () => {
      const { fn } = createMockExecFile({ stdout: 'not json at all\nline 2' })
      const runner = new AgentlyCliRunner(fn)
      const result = await runner.run('me', [])

      expect(result.envelope).toBeNull()
      expect(result.stdout).toBe('not json at all\nline 2')
    })

    it('should return null envelope for JSON that is not an envelope (array)', async () => {
      const { fn } = createMockExecFile({ stdout: '[1, 2, 3]' })
      const runner = new AgentlyCliRunner(fn)
      const result = await runner.run('me', [])

      expect(result.envelope).toBeNull()
    })

    it('should return null envelope for JSON object without data/error keys', async () => {
      const { fn } = createMockExecFile({ stdout: '{"foo":"bar"}' })
      const runner = new AgentlyCliRunner(fn)
      const result = await runner.run('me', [])

      expect(result.envelope).toBeNull()
    })
  })

  // --- stderr redaction ---

  describe('stderr redaction', () => {
    it('should redact token= values from stderr', async () => {
      const { fn } = createMockExecFile({ stderr: 'auth token=abc123secret done' })
      const runner = new AgentlyCliRunner(fn)
      const result = await runner.run('me', [])

      expect(result.stderr).toContain('[REDACTED]')
      expect(result.stderr).not.toContain('abc123secret')
    })

    it('should redact cookie= values from stderr', async () => {
      const { fn } = createMockExecFile({ stderr: 'cookie=sessionXYZ123456 expired' })
      const runner = new AgentlyCliRunner(fn)
      const result = await runner.run('me', [])

      expect(result.stderr).toContain('[REDACTED]')
      expect(result.stderr).not.toContain('sessionXYZ123456')
    })

    it('should redact Bearer tokens from stderr', async () => {
      const { fn } = createMockExecFile({ stderr: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U' })
      const runner = new AgentlyCliRunner(fn)
      const result = await runner.run('me', [])

      expect(result.stderr).toContain('[REDACTED]')
      expect(result.stderr).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    })

    it('should redact ctk_ prefixed tokens from stderr', async () => {
      const { fn } = createMockExecFile({ stderr: 'confirmation ctk_abc123def456ghi789jkl received' })
      const runner = new AgentlyCliRunner(fn)
      const result = await runner.run('me', [])

      expect(result.stderr).toContain('[REDACTED]')
      expect(result.stderr).not.toContain('ctk_abc123def456ghi789jkl')
    })

    it('should not mutate stdout — only stderr is redacted', async () => {
      const stdout = successEnvelope({ token: 'keep-this' })
      const { fn } = createMockExecFile({ stdout, stderr: 'token=leaked123' })
      const runner = new AgentlyCliRunner(fn)
      const result = await runner.run('me', [])

      // stdout preserved as-is (JSON parsing will keep it)
      expect(result.stdout).toContain('keep-this')
      // stderr redacted
      expect(result.stderr).not.toContain('leaked123')
    })
  })

  // --- argv / shell safety ---

  describe('shell safety', () => {
    it('should pass args as argv array — not interpolated through shell', async () => {
      const { fn, calls } = createMockExecFile({ stdout: successEnvelope({}) })
      const runner = new AgentlyCliRunner(fn)

      const maliciousBody = '; rm -rf /'
      await runner.run('send_message', ['--to', 'a@b.com', '--body', maliciousBody])

      expect(calls).toHaveLength(1)
      const call = calls[0]!
      // The command should be the CLI path, not a shell string
      expect(call.file).toBe('agently-cli')
      expect(call.args).toEqual(['--to', 'a@b.com', '--body', maliciousBody])
      // The dangerous string appears as one arg, not parsed as shell
      expect(call.args).toContain(maliciousBody)
    })

    it('should never set shell: true in options', async () => {
      const { fn, calls } = createMockExecFile({ stdout: successEnvelope({}) })
      const runner = new AgentlyCliRunner(fn)
      await runner.run('me', [])

      expect(calls).toHaveLength(1)
      expect(calls[0]!.options.shell).toBe(false)
    })

    it('should pass body with backticks and pipes as literal arg', async () => {
      const { fn, calls } = createMockExecFile({ stdout: successEnvelope({}) })
      const runner = new AgentlyCliRunner(fn)

      const tricky = '`whoami` | cat /etc/passwd'
      await runner.run('send_message', ['--body', tricky])

      expect(calls[0]!.args).toContain(tricky)
    })

    it('should pass body with dollar signs as literal arg', async () => {
      const { fn, calls } = createMockExecFile({ stdout: successEnvelope({}) })
      const runner = new AgentlyCliRunner(fn)

      const withDollar = 'price is $100 and $(reboot)'
      await runner.run('send_message', ['--body', withDollar])

      expect(calls[0]!.args).toContain(withDollar)
    })
  })

  // --- options forwarding ---

  describe('options forwarding', () => {
    it('should use default cliPath "agently-cli"', async () => {
      const { fn, calls } = createMockExecFile({ stdout: successEnvelope({}) })
      const runner = new AgentlyCliRunner(fn)
      await runner.run('me', [])

      expect(calls[0]!.file).toBe('agently-cli')
    })

    it('should use custom cliPath when provided', async () => {
      const { fn, calls } = createMockExecFile({ stdout: successEnvelope({}) })
      const runner = new AgentlyCliRunner(fn)
      await runner.run('me', [], { cliPath: '/usr/local/bin/agently-cli' })

      expect(calls[0]!.file).toBe('/usr/local/bin/agently-cli')
    })

    it('should forward cwd to execFile options', async () => {
      const { fn, calls } = createMockExecFile({ stdout: successEnvelope({}) })
      const runner = new AgentlyCliRunner(fn)
      await runner.run('me', [], { cwd: '/tmp/workdir' })

      expect(calls[0]!.options.cwd).toBe('/tmp/workdir')
    })

    it('should forward custom env to execFile options', async () => {
      const { fn, calls } = createMockExecFile({ stdout: successEnvelope({}) })
      const runner = new AgentlyCliRunner(fn)
      const customEnv = { PATH: '/usr/bin', HOME: '/tmp' }
      await runner.run('me', [], { env: customEnv })

      expect(calls[0]!.options.env).toEqual(customEnv)
    })

    it('should default timeoutMs to 30000', async () => {
      const { fn, calls } = createMockExecFile({ stdout: successEnvelope({}) })
      const runner = new AgentlyCliRunner(fn)
      await runner.run('me', [])

      expect(calls[0]!.options.timeout).toBe(30_000)
    })

    it('should use custom timeoutMs when provided', async () => {
      const { fn, calls } = createMockExecFile({ stdout: successEnvelope({}) })
      const runner = new AgentlyCliRunner(fn)
      await runner.run('me', [], { timeoutMs: 5000 })

      expect(calls[0]!.options.timeout).toBe(5000)
    })
  })

  // --- operation + argv wiring ---

  describe('operation + argv wiring', () => {
    it('should pass upstream CLI argv without internal operation prefix', async () => {
      const { fn, calls } = createMockExecFile({ stdout: successEnvelope({}) })
      const runner = new AgentlyCliRunner(fn)
      await runner.run('search_messages', ['message', '+search', '--q', 'hello world', '--dir', 'inbox'])

      expect(calls[0]!.args).toEqual(['message', '+search', '--q', 'hello world', '--dir', 'inbox'])
    })

    it('should work with empty argv', async () => {
      const { fn, calls } = createMockExecFile({ stdout: successEnvelope({}) })
      const runner = new AgentlyCliRunner(fn)
      await runner.run('auth_status', [])

      expect(calls[0]!.args).toEqual([])
    })

    it('should handle all operation types', async () => {
      const { fn } = createMockExecFile({ stdout: successEnvelope({}) })
      const runner = new AgentlyCliRunner(fn)

      const operations = [
        'auth_login', 'auth_logout', 'auth_status', 'me',
        'list_messages', 'read_message', 'search_messages',
        'send_message', 'reply_message', 'forward_message',
        'trash_message', 'download_attachment',
      ] as const

      for (const op of operations) {
        const result = await runner.run(op, [])
        expect(result.exitCode).toBe(0)
      }
    })
  })

  // --- AbortSignal ---

  describe('AbortSignal cancellation', () => {
    it('should reject immediately if signal is already aborted', async () => {
      const { fn } = createMockExecFile({ stdout: successEnvelope({}) })
      const runner = new AgentlyCliRunner(fn)
      const controller = new AbortController()
      controller.abort()

      await expect(runner.run('me', [], { abortSignal: controller.signal }))
        .rejects.toThrow('The operation was aborted.')
    })

    it('should reject with AbortError when signal fires during execution', async () => {
      // Create a mock that delays
      const { fn } = createMockExecFile({ delayMs: 1000, stdout: successEnvelope({}) })
      const runner = new AgentlyCliRunner(fn)
      const controller = new AbortController()

      // Abort after a short delay
      setTimeout(() => controller.abort(), 10)

      await expect(runner.run('me', [], { abortSignal: controller.signal }))
        .rejects.toThrow('The operation was aborted.')
    })

    it('should work normally when signal is provided but never aborted', async () => {
      const { fn } = createMockExecFile({ stdout: successEnvelope({ ok: true }) })
      const runner = new AgentlyCliRunner(fn)
      const controller = new AbortController()

      const result = await runner.run('me', [], { abortSignal: controller.signal })
      expect(result.exitCode).toBe(0)
      expect(result.envelope).toEqual({ data: { ok: true } })
    })
  })

  // --- stdout capture ---

  describe('stdout capture', () => {
    it('should capture raw stdout alongside parsed envelope', async () => {
      const raw = successEnvelope({ id: 'msg_1' })
      const { fn } = createMockExecFile({ stdout: raw })
      const runner = new AgentlyCliRunner(fn)
      const result = await runner.run('read_message', ['--id', 'msg_1'])

      expect(result.stdout).toBe(raw)
      expect(result.envelope).toEqual({ data: { id: 'msg_1' } })
    })

    it('should capture stderr alongside stdout', async () => {
      const { fn } = createMockExecFile({
        stdout: successEnvelope({}),
        stderr: 'warning: deprecated flag',
      })
      const runner = new AgentlyCliRunner(fn)
      const result = await runner.run('me', [])

      expect(result.stderr).toContain('deprecated flag')
    })

    it('should handle empty stdout', async () => {
      const { fn } = createMockExecFile({ stdout: '' })
      const runner = new AgentlyCliRunner(fn)
      const result = await runner.run('me', [])

      expect(result.stdout).toBe('')
      expect(result.envelope).toBeNull()
    })
  })
})
