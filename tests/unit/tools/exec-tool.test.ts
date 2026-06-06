import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { createExecTool, createBashTool, type ExecParams, type ExecResult } from '../../../src/tools/builtins/exec-tool.js';
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
    toolName: 'exec',
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

describe('exec-tool', () => {
  let testDir: string;
  let store: ProcessSessionStore;

  beforeEach(() => {
    testDir = join(tmpdir(), `exec-tool-test-${Date.now()}`);
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

  describe('createExecTool', () => {
    it('executes node -e "console.log(\'ok\')" and returns completed with stdout', async () => {
      const tool = createExecTool(store);
      const params: ExecParams = {
        command: 'node -e "console.log(\'ok\')"',
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as ExecResult;
      expect(data.status).toBe('completed');
      expect(data.stdout.trim()).toBe('ok');
      expect(data.exitCode).toBe(0);
    });

    it('background:true returns running + sessionId immediately', async () => {
      const tool = createExecTool(store);
      const params: ExecParams = {
        command: 'node -e "setTimeout(() => {}, 10000)"',
        background: true,
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as ExecResult;
      expect(data.status).toBe('running');
      expect(data.sessionId).toBeDefined();
      expect(data.sessionId).toMatch(/^proc_/);
    });

    it('timeout kills the process and returns status: timeout, timedOut: true', async () => {
      const tool = createExecTool(store);
      const params: ExecParams = {
        command: 'node -e "setTimeout(() => {}, 10000)"',
        timeoutMs: 100,
        yieldMs: 10000,
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      const data = result.data as ExecResult;
      expect(data.status).toBe('timeout');
      expect(data.timedOut).toBe(true);
    });

    it('dangerous command (rm -rf /tmp) returns DANGEROUS_COMMAND error', async () => {
      const tool = createExecTool(store);
      const params: ExecParams = {
        command: 'rm -rf /tmp',
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe('DANGEROUS_COMMAND');
    });

    it('workdir outside workspace returns WORKDIR_OUTSIDE_WORKSPACE error', async () => {
      const tool = createExecTool(store);
      const params: ExecParams = {
        command: 'ls',
        workdir: '/etc',
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe('WORKDIR_OUTSIDE_WORKSPACE');
    });

    it('env with non-string value returns INVALID_ENV error', async () => {
      const tool = createExecTool(store);
      const params: ExecParams = {
        command: 'ls',
        env: { 'FOO': 123 as unknown as string },
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe('INVALID_ENV');
    });

    it('yieldMs exceeded returns running + sessionId', async () => {
      const tool = createExecTool(store);
      const params: ExecParams = {
        command: 'node -e "setTimeout(() => { console.log(\'done\'); }, 5000)"',
        yieldMs: 100,
        timeoutMs: 10000,
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as ExecResult;
      expect(data.status).toBe('running');
      expect(data.sessionId).toBeDefined();
    });

    it('output > maxOutputChars is truncated, sets truncated flag', async () => {
      const tool = createExecTool(store);
      const params: ExecParams = {
        command: 'node -e "for(let i=0; i<1000; i++) console.log(\'line \' + i)"',
        maxOutputChars: 500,
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as ExecResult;
      expect(data.stdoutTruncated).toBe(true);
      expect(data.stdout.length).toBeLessThanOrEqual(500);
    });

    it('captures stderr', async () => {
      const tool = createExecTool(store);
      const params: ExecParams = {
        command: 'node -e "console.error(\'error output\')"',
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as ExecResult;
      expect(data.stdout.trim()).toBe('error output');
    });

    it('returns exit code for failed command', async () => {
      const tool = createExecTool(store);
      const params: ExecParams = {
        command: 'node -e "process.exit(42)"',
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as ExecResult;
      expect(data.status).toBe('failed');
      expect(data.exitCode).toBe(42);
    });
  });

  describe('createBashTool', () => {
    it('calls the same handler as exec', async () => {
      const bashTool = createBashTool(store);
      const execTool = createExecTool(store);
      
      const params: ExecParams = {
        command: 'node -e "console.log(\'test\')"',
      };
      const context = createToolContext();

      const bashResult = await bashTool.handler(params, context);
      const execResult = await execTool.handler(params, context);

      expect(bashResult.success).toBe(execResult.success);
      const bashData = bashResult.data as ExecResult;
      const execData = execResult.data as ExecResult;
      expect(bashData.stdout).toBe(execData.stdout);
    });

    it('has name "bash"', () => {
      const tool = createBashTool(store);
      expect(tool.name).toBe('bash');
    });

    it('has category "execute" and sensitivity "high"', () => {
      const tool = createBashTool(store);
      expect(tool.category).toBe('execute');
      expect(tool.sensitivity).toBe('high');
      expect(tool.requiresPermission).toBe(true);
    });
  });
});
