import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createFileApplyPatchTool, type FileApplyPatchParams, type FileApplyPatchResult } from '../../../src/tools/builtins/file-apply-patch.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../src/tools/types.js';
import type { FilePatchOperation } from '../../../src/tools/builtins/patch-parser.js';

vi.mock('../../../src/tools/builtins/safe-paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/tools/builtins/safe-paths.js')>();
  return {
    ...actual,
    getWorkspaceRoot: () => (globalThis as { __testDir?: string }).__testDir || process.cwd(),
  };
});

describe('file_apply_patch tool', () => {
  let tool: ToolDefinition;
  let testDir: string;

  const createToolContext = (overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext => ({
    toolCallId: 'tc-001',
    toolName: 'file_apply_patch',
    userId: 'user-123',
    sessionId: 'session-001',
    permissionContext: { userId: 'user-123', sessionId: 'session-001', mode: 'ask_on_write', grants: [] },
    executionStartTime: new Date().toISOString(),
    stores: { toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} } },
    ...overrides,
  });

  beforeEach(() => {
    testDir = join(tmpdir(), `file-apply-patch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    (globalThis as { __testDir?: string }).__testDir = testDir;
    tool = createFileApplyPatchTool();
  });

  afterEach(() => {
    delete (globalThis as { __testDir?: string }).__testDir;
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('should add a new file', async () => {
    const operations: FilePatchOperation[] = [
      { type: 'add', filePath: 'new.txt', content: 'created' },
    ];
    
    const params: FileApplyPatchParams = { operations };
    const result = await tool.handler(params, createToolContext());
    
    expect(result.success).toBe(true);
    expect(existsSync(join(testDir, 'new.txt'))).toBe(true);
    expect(readFileSync(join(testDir, 'new.txt'), 'utf8')).toBe('created');
  });

  it('should update an existing file', async () => {
    writeFileSync(join(testDir, 'file.txt'), 'Hello world');
    
    const operations: FilePatchOperation[] = [
      { type: 'update', filePath: 'file.txt', oldString: 'world', newString: 'universe' },
    ];
    
    const params: FileApplyPatchParams = { operations };
    const result = await tool.handler(params, createToolContext());
    
    expect(result.success).toBe(true);
    expect(readFileSync(join(testDir, 'file.txt'), 'utf8')).toBe('Hello universe');
  });

  it('should delete a file', async () => {
    writeFileSync(join(testDir, 'old.txt'), 'content');
    
    const operations: FilePatchOperation[] = [
      { type: 'delete', filePath: 'old.txt' },
    ];
    
    const params: FileApplyPatchParams = { operations };
    const result = await tool.handler(params, createToolContext());
    
    expect(result.success).toBe(true);
    expect(existsSync(join(testDir, 'old.txt'))).toBe(false);
  });

  it('should apply multi-op patch in order', async () => {
    writeFileSync(join(testDir, 'file1.txt'), 'old content');
    
    const operations: FilePatchOperation[] = [
      { type: 'add', filePath: 'new.txt', content: 'new file' },
      { type: 'update', filePath: 'file1.txt', oldString: 'old', newString: 'updated' },
      { type: 'delete', filePath: 'new.txt' },
    ];
    
    const params: FileApplyPatchParams = { operations };
    const result = await tool.handler(params, createToolContext());
    
    expect(result.success).toBe(true);
    expect(readFileSync(join(testDir, 'file1.txt'), 'utf8')).toBe('updated content');
    expect(existsSync(join(testDir, 'new.txt'))).toBe(false);
  });

  it('should not write files in dryRun mode', async () => {
    const operations: FilePatchOperation[] = [
      { type: 'add', filePath: 'new.txt', content: 'created' },
    ];
    
    const params: FileApplyPatchParams = { operations, dryRun: true };
    const result = await tool.handler(params, createToolContext());
    
    expect(result.success).toBe(true);
    expect(existsSync(join(testDir, 'new.txt'))).toBe(false);
    const data = result.data as FileApplyPatchResult;
    expect(data.dryRun).toBe(true);
  });

  it('should reject when both operations and patch are provided', async () => {
    const params: FileApplyPatchParams = {
      operations: [{ type: 'add', filePath: 'new.txt', content: 'test' }],
      patch: '*** Begin Patch\n*** End Patch',
    };
    
    const result = await tool.handler(params, createToolContext());
    
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CONFLICTING_INPUT');
  });

  it('should reject when neither operations nor patch are provided', async () => {
    const params: FileApplyPatchParams = {};
    const result = await tool.handler(params, createToolContext());
    
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('MISSING_INPUT');
  });

  it('should reject invalid patch text format', async () => {
    const params: FileApplyPatchParams = { patch: 'invalid patch' };
    const result = await tool.handler(params, createToolContext());
    
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PATCH_FORMAT');
  });

  it('should report failed status when update does not match', async () => {
    writeFileSync(join(testDir, 'file.txt'), 'Hello world');
    
    const operations: FilePatchOperation[] = [
      { type: 'update', filePath: 'file.txt', oldString: 'nonexistent', newString: 'new' },
    ];
    
    const params: FileApplyPatchParams = { operations };
    const result = await tool.handler(params, createToolContext());
    
    expect(result.success).toBe(false);
    const data = result.data as FileApplyPatchResult;
    expect(data.failed).toBe(1);
    expect(data.applied).toBe(0);
    expect(readFileSync(join(testDir, 'file.txt'), 'utf8')).toBe('Hello world');
  });

  it('should count applied and failed operations correctly', async () => {
    writeFileSync(join(testDir, 'file.txt'), 'content');
    
    const operations: FilePatchOperation[] = [
      { type: 'update', filePath: 'file.txt', oldString: 'content', newString: 'updated' },
      { type: 'add', filePath: 'new.txt', content: 'new file' },
    ];
    
    const params: FileApplyPatchParams = { operations };
    const result = await tool.handler(params, createToolContext());
    
    expect(result.success).toBe(true);
    const data = result.data as FileApplyPatchResult;
    expect(data.applied).toBe(2);
    expect(data.failed).toBe(0);
  });
});
