import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ProcessSessionStore } from '../../../src/tools/builtins/process-session-store.js'

vi.mock('../../../src/tools/builtins/safe-paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/tools/builtins/safe-paths.js')>()
  return {
    ...actual,
    getWorkspaceRoot: () => {
      return (globalThis as { __testDir?: string }).__testDir || process.cwd()
    },
  }
})

describe('ProcessSessionStore', () => {
  let store: ProcessSessionStore
  let testDir: string
  const userId = 'user-123'
  const otherUserId = 'user-456'

  beforeEach(() => {
    testDir = join(tmpdir(), `process-store-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    ;(globalThis as { __testDir?: string }).__testDir = testDir

    store = new ProcessSessionStore({
      defaultMaxOutputChars: 8000,
      defaultTimeoutMs: 30000,
    })
  })

  afterEach(async () => {
    // Cleanup all non-running sessions
    store.clearAllNonRunning()

    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('start()', () => {
    it('returns a sessionId', () => {
      const sessionId = store.start({
        userId,
        command: 'node -e "console.log(\'hello\')"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      })

      expect(sessionId).toBeDefined()
      expect(typeof sessionId).toBe('string')
      expect(sessionId).toMatch(/^proc_/)
    })

    it('runs `node -e "console.log(\'hello\')"` and captures output', async () => {
      const sessionId = store.start({
        userId,
        command: 'node -e "console.log(\'hello\')"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      })

      // Wait for process to complete
      await new Promise((resolve) => setTimeout(resolve, 500))

      const session = store.get(userId, sessionId)
      expect(session).toBeDefined()
      expect(session!.status).toBe('completed')
      expect(session!.output).toContain('hello')
      expect(session!.exitCode).toBe(0)
    })

    it('captures both stdout and stderr', async () => {
      const sessionId = store.start({
        userId,
        command: "node -e \"console.log('stdout'); console.error('stderr')\"",
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      })

      await new Promise((resolve) => setTimeout(resolve, 500))

      const session = store.get(userId, sessionId)
      expect(session!.output).toContain('stdout')
      expect(session!.output).toContain('stderr')
      expect(session!.status).toBe('completed')
    })
  })

  describe('get()', () => {
    it('returns the session after completion', async () => {
      const sessionId = store.start({
        userId,
        command: 'node -e "console.log(\'test\')"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      })

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 500))

      const session = store.get(userId, sessionId)
      expect(session).toBeDefined()
      expect(session!.id).toBe(sessionId)
      expect(session!.userId).toBe(userId)
      expect(session!.command).toBe('node -e "console.log(\'test\')"')
      expect(session!.status).toBe('completed')
      expect(session!.exitCode).toBe(0)
      expect(session!.endedAt).toBeDefined()
    })

    it('returns null for non-existent session', () => {
      const session = store.get(userId, 'non-existent-id')
      expect(session).toBeNull()
    })
  })

  describe('list()', () => {
    it("returns the user's sessions", () => {
      const sessionId1 = store.start({
        userId,
        command: 'echo "test1"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      })

      const sessionId2 = store.start({
        userId,
        command: 'echo "test2"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      })

      const sessions = store.list(userId)
      expect(sessions.length).toBe(2)
      expect(sessions.map((s) => s.id)).toContain(sessionId1)
      expect(sessions.map((s) => s.id)).toContain(sessionId2)
    })

    it('does not include sessions from other users', () => {
      store.start({
        userId,
        command: 'echo "user1"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      })

      store.start({
        userId: otherUserId,
        command: 'echo "user2"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      })

      const user1Sessions = store.list(userId)
      const user2Sessions = store.list(otherUserId)

      expect(user1Sessions.length).toBe(1)
      expect(user2Sessions.length).toBe(1)
      expect(user1Sessions[0].command).toBe('echo "user1"')
      expect(user2Sessions[0].command).toBe('echo "user2"')
    })
  })

  describe('user isolation', () => {
    it("user A cannot see user B's session via get() (returns null)", () => {
      const sessionId = store.start({
        userId,
        command: 'node -e "console.log(\'test\')"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      })

      // Try to get the session with a different user
      const session = store.get(otherUserId, sessionId)
      expect(session).toBeNull()
    })

    it("user A cannot kill user B's session (returns false)", () => {
      const sessionId = store.start({
        userId,
        command: 'node -e "setTimeout(() => {}, 10000)"',
        workdir: testDir,
        env: {},
        timeoutMs: 30000,
        maxOutputChars: 1000,
      })

      // Try to kill with different user
      const result = store.kill(otherUserId, sessionId)
      expect(result).toBe(false)

      // Verify session is still running
      const session = store.get(userId, sessionId)
      expect(session!.status).toBe('running')
    })
  })

  describe('appendInput()', () => {
    it('writes to stdin of a running process; verify via process that reads stdin', async () => {
      const scriptFile = join(testDir, 'stdin-test.js')
      writeFileSync(
        scriptFile,
        `
        process.stdin.on('data', (chunk) => {
          console.log('Received:', chunk.toString().trim());
        });
        process.stdin.on('end', () => {
          console.log('EOF received');
          process.exit(0);
        });
      `,
      )

      const sessionId = store.start({
        userId,
        command: `node ${scriptFile}`,
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      })

      // Write to stdin
      const result1 = store.appendInput(userId, sessionId, 'hello\n', false)
      expect(result1).toBe(true)

      const result2 = store.appendInput(userId, sessionId, 'world\n', false)
      expect(result2).toBe(true)

      // Send EOF
      const result3 = store.appendInput(userId, sessionId, '', true)
      expect(result3).toBe(true)

      // Wait for process to complete
      await new Promise((resolve) => setTimeout(resolve, 500))

      const session = store.get(userId, sessionId)
      expect(session!.output).toContain('Received:')
      expect(session!.output).toContain('hello')
      expect(session!.output).toContain('world')
      expect(session!.output).toContain('EOF received')
      expect(session!.status).toBe('completed')
    })

    it('returns false if session is not running', async () => {
      const sessionId = store.start({
        userId,
        command: 'node -e "console.log(\'done\')"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      })

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 500))

      const result = store.appendInput(userId, sessionId, 'test\n', false)
      expect(result).toBe(false)
    })

    it('returns false for non-existent session', () => {
      const result = store.appendInput(userId, 'non-existent', 'test\n', false)
      expect(result).toBe(false)
    })

    it('returns false if userId does not match', () => {
      const sessionId = store.start({
        userId,
        command: 'node -e "setTimeout(() => {}, 10000)"',
        workdir: testDir,
        env: {},
        timeoutMs: 30000,
        maxOutputChars: 1000,
      })

      const result = store.appendInput(otherUserId, sessionId, 'test\n', false)
      expect(result).toBe(false)
    })
  })

  describe('kill()', () => {
    it('terminates a long-running process and sets status to killed', async () => {
      const sessionId = store.start({
        userId,
        command: 'node -e "setTimeout(() => {}, 10000)"',
        workdir: testDir,
        env: {},
        timeoutMs: 30000,
        maxOutputChars: 1000,
      })

      // Verify it's running
      let session = store.get(userId, sessionId)
      expect(session!.status).toBe('running')

      // Kill it
      const result = store.kill(userId, sessionId)
      expect(result).toBe(true)

      // Wait a bit for the signal to be processed
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Verify it's killed
      session = store.get(userId, sessionId)
      expect(session!.status).toBe('killed')
      expect(session!.endedAt).toBeDefined()
      expect(session!.signal).toBe('SIGTERM')
    })

    it('returns false if session is not running', async () => {
      const sessionId = store.start({
        userId,
        command: 'node -e "console.log(\'done\')"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      })

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 500))

      const result = store.kill(userId, sessionId)
      expect(result).toBe(false)
    })

    it('returns false for non-existent session', () => {
      const result = store.kill(userId, 'non-existent')
      expect(result).toBe(false)
    })
  })

  describe('clear()', () => {
    it('removes a non-running session', async () => {
      const sessionId = store.start({
        userId,
        command: 'node -e "console.log(\'done\')"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      })

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 500))

      const result = store.clear(userId, sessionId)
      expect(result).toBe(true)

      // Verify it's gone
      const session = store.get(userId, sessionId)
      expect(session).toBeNull()
    })

    it('refuses to remove a running session (returns false)', () => {
      const sessionId = store.start({
        userId,
        command: 'node -e "setTimeout(() => {}, 10000)"',
        workdir: testDir,
        env: {},
        timeoutMs: 30000,
        maxOutputChars: 1000,
      })

      const result = store.clear(userId, sessionId)
      expect(result).toBe(false)

      // Verify session still exists
      const session = store.get(userId, sessionId)
      expect(session).toBeDefined()
      expect(session!.status).toBe('running')
    })

    it('returns false if userId does not match', async () => {
      const sessionId = store.start({
        userId,
        command: 'node -e "console.log(\'done\')"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      })

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 500))

      const result = store.clear(otherUserId, sessionId)
      expect(result).toBe(false)

      // Verify session still exists
      const session = store.get(userId, sessionId)
      expect(session).toBeDefined()
    })

    it('returns false for non-existent session', () => {
      const result = store.clear(userId, 'non-existent')
      expect(result).toBe(false)
    })
  })

  describe('clearAllNonRunning()', () => {
    it('removes only completed/failed/timeout/killed sessions', async () => {
      // Start 3 quick processes
      const sessionId1 = store.start({
        userId,
        command: 'node -e "console.log(\'1\')"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      })

      const sessionId2 = store.start({
        userId,
        command: 'node -e "console.log(\'2\')"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      })

      // Start a long-running process
      const sessionId3 = store.start({
        userId,
        command: 'node -e "setTimeout(() => {}, 10000)"',
        workdir: testDir,
        env: {},
        timeoutMs: 30000,
        maxOutputChars: 1000,
      })

      // Wait for first two to complete
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Clear all non-running
      const count = store.clearAllNonRunning()
      expect(count).toBe(2)

      // Verify completed sessions are gone
      expect(store.get(userId, sessionId1)).toBeNull()
      expect(store.get(userId, sessionId2)).toBeNull()

      // Verify running session still exists
      const session3 = store.get(userId, sessionId3)
      expect(session3).toBeDefined()
      expect(session3!.status).toBe('running')
    })

    it('removes sessions with different statuses', async () => {
      // Completed
      const sessionId1 = store.start({
        userId,
        command: 'node -e "console.log(\'done\')"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      })

      // Failed
      const sessionId2 = store.start({
        userId,
        command: 'node -e "process.exit(1)"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      })

      // Timeout
      const sessionId3 = store.start({
        userId,
        command: 'node -e "setTimeout(() => {}, 10000)"',
        workdir: testDir,
        env: {},
        timeoutMs: 100,
        maxOutputChars: 1000,
      })

      // Wait for all to finish
      await new Promise((resolve) => setTimeout(resolve, 500))

      const count = store.clearAllNonRunning()
      expect(count).toBeGreaterThanOrEqual(2)

      // All should be gone
      expect(store.get(userId, sessionId1)).toBeNull()
      expect(store.get(userId, sessionId2)).toBeNull()
      expect(store.get(userId, sessionId3)).toBeNull()
    })
  })

  describe('output truncation', () => {
    it('long output is tail-truncated, outputTruncated=true', async () => {
      const sessionId = store.start({
        userId,
        command: 'node -e "for(let i=0; i<1000; i++) console.log(\'line \' + i)"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 500,
      })

      // Wait for process to complete
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const session = store.get(userId, sessionId)
      expect(session!.outputTruncated).toBe(true)
      expect(session!.output.length).toBeLessThanOrEqual(500)
      // Should contain the tail (later lines)
      expect(session!.output).toContain('line 999')
      // Should not contain the head (earlier lines)
      expect(session!.output).not.toContain('line 0')
    })

    it('short output is not truncated', async () => {
      const sessionId = store.start({
        userId,
        command: 'node -e "console.log(\'short output\')"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      })

      await new Promise((resolve) => setTimeout(resolve, 500))

      const session = store.get(userId, sessionId)
      expect(session!.outputTruncated).toBe(false)
      expect(session!.output).toContain('short output')
    })
  })

  describe('timeout handling', () => {
    it('sets status to timeout when process exceeds timeout', async () => {
      const sessionId = store.start({
        userId,
        command: 'node -e "setTimeout(() => {}, 10000)"',
        workdir: testDir,
        env: {},
        timeoutMs: 100,
        maxOutputChars: 1000,
      })

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 300))

      const session = store.get(userId, sessionId)
      expect(session!.status).toBe('timeout')
      expect(session!.endedAt).toBeDefined()
    })
  })

  describe('failed processes', () => {
    it('sets status to failed when process exits with non-zero code', async () => {
      const sessionId = store.start({
        userId,
        command: 'node -e "process.exit(1)"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      })

      await new Promise((resolve) => setTimeout(resolve, 500))

      const session = store.get(userId, sessionId)
      expect(session!.status).toBe('failed')
      expect(session!.exitCode).toBe(1)
    })

    it('sets status to failed when command does not exist', async () => {
      const sessionId = store.start({
        userId,
        command: 'nonexistentcommand12345',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      })

      await new Promise((resolve) => setTimeout(resolve, 500))

      const session = store.get(userId, sessionId)
      expect(session!.status).toBe('failed')
    })
  })
})
