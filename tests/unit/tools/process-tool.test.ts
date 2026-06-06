import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { createProcessTool, type ProcessParams, type ProcessResult } from '../../../src/tools/builtins/process-tool.js';
import { ProcessSessionStore } from '../../../src/tools/builtins/process-session-store.js';
import type { ToolExecutionContext } from '../../../src/tools/types.js';

vi.mock('../../../src/tools/builtins/safe-paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/tools/builtins/safe-paths.js')>();
  return {
    ...actual,
    getWorkspaceRoot: () => (globalThis as { __testDir?: string }).__testDir || process.cwd(),
  };
});

function createToolContext(userId: string = 'user-123'): ToolExecutionContext {
  return {
    toolCallId: 'test-call-id',
    toolName: 'process',
    userId,
    permissionContext: {
      userId,
      sessionId: 'test-session',
    } as any,
    executionStartTime: new Date().toISOString(),
    stores: {
      toolExecutionStore: {
        updateStatus: vi.fn(),
        saveResult: vi.fn(),
      },
    },
  };
}

describe('process-tool', () => {
  let testDir: string;
  let store: ProcessSessionStore;

  beforeEach(() => {
    testDir = join(tmpdir(), `process-tool-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    (globalThis as { __testDir?: string }).__testDir = testDir;
    
    store = new ProcessSessionStore();
  });

  afterEach(() => {
    store.clearAllNonRunning();
    
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('list action', () => {
    it('returns empty array when no sessions', async () => {
      const tool = createProcessTool(store);
      const params: ProcessParams = { action: 'list' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as ProcessResult;
      expect(data.sessions).toBeDefined();
      expect(data.sessions!.length).toBe(0);
    });

    it('returns only user\'s sessions', async () => {
      const sessionId1 = store.start({
        userId: 'user-123',
        command: 'echo "test1"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      });

      store.start({
        userId: 'user-456',
        command: 'echo "test2"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      });

      const tool = createProcessTool(store);
      const params: ProcessParams = { action: 'list' };
      const context = createToolContext('user-123');

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as ProcessResult;
      expect(data.sessions!.length).toBe(1);
      expect(data.sessions![0].id).toBe(sessionId1);
    });
  });

  describe('poll action', () => {
    it('returns full session state', async () => {
      const sessionId = store.start({
        userId: 'user-123',
        command: 'echo "test"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      });

      const tool = createProcessTool(store);
      const params: ProcessParams = { action: 'poll', sessionId };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as ProcessResult;
      expect(data.session).toBeDefined();
      expect(data.session!.id).toBe(sessionId);
      expect(data.session!.command).toBe('echo "test"');
    });

    it('returns SESSION_NOT_FOUND for missing session', async () => {
      const tool = createProcessTool(store);
      const params: ProcessParams = { action: 'poll', sessionId: 'non-existent' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe('SESSION_NOT_FOUND');
    });
  });

  describe('kill action', () => {
    it('terminates a running session', async () => {
      const sessionId = store.start({
        userId: 'user-123',
        command: 'node -e "setTimeout(() => {}, 10000)"',
        workdir: testDir,
        env: {},
        timeoutMs: 30000,
        maxOutputChars: 1000,
      });

      const tool = createProcessTool(store);
      const params: ProcessParams = { action: 'kill', sessionId };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as ProcessResult;
      expect(data.killed).toBe(true);
    });

    it('returns KILL_FAILED for non-running session', async () => {
      const sessionId = store.start({
        userId: 'user-123',
        command: 'echo "done"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      const tool = createProcessTool(store);
      const params: ProcessParams = { action: 'kill', sessionId };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe('KILL_FAILED');
    });
  });

  describe('clear action', () => {
    it('refuses running session', async () => {
      const sessionId = store.start({
        userId: 'user-123',
        command: 'node -e "setTimeout(() => {}, 10000)"',
        workdir: testDir,
        env: {},
        timeoutMs: 30000,
        maxOutputChars: 1000,
      });

      const tool = createProcessTool(store);
      const params: ProcessParams = { action: 'clear', sessionId };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe('CLEAR_FAILED');
    });

    it('clears completed session', async () => {
      const sessionId = store.start({
        userId: 'user-123',
        command: 'echo "done"',
        workdir: testDir,
        env: {},
        timeoutMs: 5000,
        maxOutputChars: 1000,
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      const tool = createProcessTool(store);
      const params: ProcessParams = { action: 'clear', sessionId };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as ProcessResult;
      expect(data.cleared).toBe(true);
    });
  });
});
