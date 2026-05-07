import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createFileReadTool, type FileReadParams, type FileReadResult } from '../../../src/tools/builtins/file-read.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../src/tools/types.js';

vi.mock('../../../src/tools/builtins/safe-paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/tools/builtins/safe-paths.js')>();
  return {
    ...actual,
    getWorkspaceRoot: () => {
      return (globalThis as { __testDir?: string }).__testDir || process.cwd();
    },
  };
});

describe('file.read tool', () => {
  let tool: ToolDefinition;
  let testDir: string;

  const createToolContext = (overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext => ({
    toolCallId: 'tc-001',
    toolName: 'file.read',
    userId: 'user-123',
    sessionId: 'session-001',
    permissionContext: {
      userId: 'user-123',
      sessionId: 'session-001',
      mode: 'ask_on_write',
      grants: [],
    },
    executionStartTime: new Date().toISOString(),
    stores: {
      toolExecutionStore: {
        updateStatus: () => {},
        saveResult: () => {},
      },
    },
    ...overrides,
  });

  beforeEach(() => {
    testDir = join(tmpdir(), `file-read-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    (globalThis as { __testDir?: string }).__testDir = testDir;
    tool = createFileReadTool();
  });

  afterEach(() => {
    delete (globalThis as { __testDir?: string }).__testDir;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Basic Reading', () => {
    it('should read a simple text file', async () => {
      const filePath = 'test.txt';
      writeFileSync(join(testDir, filePath), 'Hello, World!\n');

      const params: FileReadParams = { filePath };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      const data = result.data as FileReadResult;
      expect(data.content).toBe('Hello, World!\n');
      expect(data.filePath).toBe(filePath);
      expect(data.totalLines).toBe(2);
      expect(data.returnedLines).toBe(2);
      expect(data.truncated).toBe(false);
    });

    it('should read file with multiple lines', async () => {
      const filePath = 'multi.txt';
      const content = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
      writeFileSync(join(testDir, filePath), content);

      const params: FileReadParams = { filePath };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as FileReadResult;
      expect(data.totalLines).toBe(5);
      expect(data.content).toBe(content);
    });

    it('should support offset parameter', async () => {
      const filePath = 'offset.txt';
      writeFileSync(join(testDir, filePath), 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5');

      const params: FileReadParams = { filePath, offset: 3 };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as FileReadResult;
      expect(data.startLine).toBe(3);
      expect(data.content).toBe('Line 3\nLine 4\nLine 5');
      expect(data.returnedLines).toBe(3);
    });

    it('should support limit parameter', async () => {
      const filePath = 'limit.txt';
      writeFileSync(join(testDir, filePath), 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5');

      const params: FileReadParams = { filePath, limit: 2 };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as FileReadResult;
      expect(data.content).toBe('Line 1\nLine 2');
      expect(data.returnedLines).toBe(2);
      expect(data.truncated).toBe(true);
    });

    it('should support both offset and limit', async () => {
      const filePath = 'both.txt';
      writeFileSync(join(testDir, filePath), 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5');

      const params: FileReadParams = { filePath, offset: 2, limit: 2 };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as FileReadResult;
      expect(data.startLine).toBe(2);
      expect(data.content).toBe('Line 2\nLine 3');
      expect(data.returnedLines).toBe(2);
    });
  });

  describe('Path Safety', () => {
    it('should reject path with .. escape', async () => {
      const params: FileReadParams = { filePath: '../outside.txt' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PATH_ESCAPE');
    });

    it('should reject absolute path outside workspace', async () => {
      const params: FileReadParams = { filePath: '/etc/passwd' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('OUTSIDE_WORKSPACE');
    });

    it('should reject symlink pointing outside workspace', async () => {
      const outsideDir = join(tmpdir(), 'outside-workspace');
      mkdirSync(outsideDir, { recursive: true });
      writeFileSync(join(outsideDir, 'target.txt'), 'outside content');

      const symlinkPath = join(testDir, 'link.txt');
      symlinkSync(join(outsideDir, 'target.txt'), symlinkPath);

      const params: FileReadParams = { filePath: 'link.txt' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('OUTSIDE_WORKSPACE');

      rmSync(outsideDir, { recursive: true, force: true });
    });

    it('should reject sensitive .env files', async () => {
      writeFileSync(join(testDir, '.env'), 'SECRET=value');

      const params: FileReadParams = { filePath: '.env' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SENSITIVE_FILE');
    });

    it('should reject .env.local files', async () => {
      writeFileSync(join(testDir, '.env.local'), 'SECRET=value');

      const params: FileReadParams = { filePath: '.env.local' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SENSITIVE_FILE');
    });

    it('should reject private key files', async () => {
      writeFileSync(join(testDir, 'id_rsa'), 'private key content');

      const params: FileReadParams = { filePath: 'id_rsa' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SENSITIVE_FILE');
    });

    it('should reject database files', async () => {
      writeFileSync(join(testDir, 'data.db'), 'database content');

      const params: FileReadParams = { filePath: 'data.db' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SENSITIVE_FILE');
    });
  });

  describe('Binary Detection', () => {
    it('should reject files with binary extensions', async () => {
      writeFileSync(join(testDir, 'image.png'), Buffer.from([0x89, 0x50, 0x4E, 0x47]));

      const params: FileReadParams = { filePath: 'image.png' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('BINARY_FILE');
    });

    it('should reject files with null bytes (binary content)', async () => {
      writeFileSync(join(testDir, 'binary.dat'), Buffer.from([0x00, 0x01, 0x02, 0x03]));

      const params: FileReadParams = { filePath: 'binary.dat' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('BINARY_FILE');
    });

    it('should accept text files without null bytes', async () => {
      writeFileSync(join(testDir, 'text.txt'), 'Normal text content');

      const params: FileReadParams = { filePath: 'text.txt' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should return MISSING_FILE_PATH error when filePath is missing', async () => {
      const params: FileReadParams = { filePath: '' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_FILE_PATH');
    });

    it('should return FILE_NOT_FOUND error for non-existent file', async () => {
      const params: FileReadParams = { filePath: 'nonexistent.txt' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('FILE_NOT_FOUND');
    });

    it('should return NOT_A_FILE error for directories', async () => {
      mkdirSync(join(testDir, 'subdir'), { recursive: true });

      const params: FileReadParams = { filePath: 'subdir' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_A_FILE');
    });

    it('should return FILE_TOO_LARGE error for oversized files', async () => {
      const largeContent = Buffer.alloc(300 * 1024, 'x');
      writeFileSync(join(testDir, 'large.txt'), largeContent);

      const params: FileReadParams = { filePath: 'large.txt' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('FILE_TOO_LARGE');
    });
  });

  describe('Tool Definition', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('file.read');
    });

    it('should have read category', () => {
      expect(tool.category).toBe('read');
    });

    it('should have medium sensitivity', () => {
      expect(tool.sensitivity).toBe('medium');
    });

    it('should have required filePath in schema', () => {
      expect(tool.schema.required).toContain('filePath');
    });
  });
});
