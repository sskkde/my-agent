import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createFileWriteTool, type FileWriteParams, type FileWriteResult } from '../../../src/tools/builtins/file-write.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../src/tools/types.js';
import { sha256Text } from '../../../src/tools/builtins/safe-file-write.js';

vi.mock('../../../src/tools/builtins/safe-paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/tools/builtins/safe-paths.js')>();
  return {
    ...actual,
    getWorkspaceRoot: () => {
      return (globalThis as { __testDir?: string }).__testDir || process.cwd();
    },
  };
});

describe('file_write tool', () => {
  let tool: ToolDefinition;
  let testDir: string;

  const createToolContext = (overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext => ({
    toolCallId: 'tc-001',
    toolName: 'file_write',
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
    testDir = join(tmpdir(), `file-write-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    (globalThis as { __testDir?: string }).__testDir = testDir;
    tool = createFileWriteTool();
  });

  afterEach(() => {
    delete (globalThis as { __testDir?: string }).__testDir;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Basic Writing', () => {
    it('should create new file successfully', async () => {
      const params: FileWriteParams = {
        filePath: 'new-file.txt',
        content: 'Hello, World!',
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      const data = result.data as FileWriteResult;
      expect(data.created).toBe(true);
      expect(data.bytesWritten).toBe(13);
      expect(data.filePath).toBe('new-file.txt');
      expect(existsSync(join(testDir, 'new-file.txt'))).toBe(true);
      expect(readFileSync(join(testDir, 'new-file.txt'), 'utf8')).toBe('Hello, World!');
    });

    it('should reject overwrite when overwrite=false', async () => {
      writeFileSync(join(testDir, 'existing.txt'), 'Old content');
      
      const params: FileWriteParams = {
        filePath: 'existing.txt',
        content: 'New content',
        overwrite: false,
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('FILE_EXISTS');
      expect(readFileSync(join(testDir, 'existing.txt'), 'utf8')).toBe('Old content');
    });

    it('should allow overwrite when overwrite=true', async () => {
      writeFileSync(join(testDir, 'existing.txt'), 'Old content');
      
      const params: FileWriteParams = {
        filePath: 'existing.txt',
        content: 'New content',
        overwrite: true,
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as FileWriteResult;
      expect(data.created).toBe(false);
      expect(data.previousHash).toBeDefined();
      expect(readFileSync(join(testDir, 'existing.txt'), 'utf8')).toBe('New content');
    });

    it('should create parent directories with createDirs option', async () => {
      const params: FileWriteParams = {
        filePath: 'subdir/nested/file.txt',
        content: 'Content',
        createDirs: true,
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      expect(existsSync(join(testDir, 'subdir/nested/file.txt'))).toBe(true);
    });
  });

  describe('Hash Verification', () => {
    it('should reject hash mismatch', async () => {
      writeFileSync(join(testDir, 'file.txt'), 'Original content');
      
      const params: FileWriteParams = {
        filePath: 'file.txt',
        content: 'New content',
        overwrite: true,
        expectedHash: 'wrong-hash',
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('HASH_MISMATCH');
    });

    it('should allow write when hash matches', async () => {
      writeFileSync(join(testDir, 'file.txt'), 'Original content');
      const originalHash = sha256Text('Original content');
      
      const params: FileWriteParams = {
        filePath: 'file.txt',
        content: 'New content',
        overwrite: true,
        expectedHash: originalHash,
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
    });
  });

  describe('Path Safety', () => {
    it('should reject path with .. escape', async () => {
      const params: FileWriteParams = {
        filePath: '../outside.txt',
        content: 'Content',
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PATH_ESCAPE');
    });

    it('should reject absolute path outside workspace', async () => {
      const params: FileWriteParams = {
        filePath: '/etc/passwd',
        content: 'Content',
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('OUTSIDE_WORKSPACE');
    });

    it('should reject sensitive .env files', async () => {
      const params: FileWriteParams = {
        filePath: '.env',
        content: 'SECRET=value',
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SENSITIVE_FILE');
    });

    it('should reject binary file extensions', async () => {
      const params: FileWriteParams = {
        filePath: 'image.png',
        content: 'binary data',
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('BINARY_FILE');
    });
  });

  describe('Content Validation', () => {
    it('should reject NUL bytes in content', async () => {
      const params: FileWriteParams = {
        filePath: 'file.txt',
        content: 'Content with \0 NUL byte',
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('BINARY_CONTENT');
    });

    it('should reject content exceeding size limit', async () => {
      const largeContent = 'x'.repeat(600 * 1024); // 600 KiB
      
      const params: FileWriteParams = {
        filePath: 'large.txt',
        content: largeContent,
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CONTENT_TOO_LARGE');
    });
  });

  describe('Result Preview', () => {
    it('should not include full content in resultPreview', async () => {
      const params: FileWriteParams = {
        filePath: 'file.txt',
        content: 'This is some content that should not appear in preview',
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      expect(result.resultPreview).toBeDefined();
      expect(result.resultPreview).not.toContain('This is some content');
      expect(result.resultPreview).toContain('file.txt');
      expect(result.resultPreview).toContain('bytes');
    });
  });

  describe('Error Handling', () => {
    it('should return MISSING_FILE_PATH error when filePath is missing', async () => {
      const params: FileWriteParams = {
        filePath: '',
        content: 'Content',
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_FILE_PATH');
    });

    it('should return MISSING_CONTENT error when content is missing', async () => {
      const params: FileWriteParams = {
        filePath: 'file.txt',
        content: undefined as unknown as string,
      };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_CONTENT');
    });
  });

  describe('Tool Definition', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('file_write');
    });

    it('should have write category', () => {
      expect(tool.category).toBe('write');
    });

    it('should have high sensitivity', () => {
      expect(tool.sensitivity).toBe('high');
    });

    it('should have required filePath and content in schema', () => {
      expect(tool.schema.required).toContain('filePath');
      expect(tool.schema.required).toContain('content');
    });
  });
});
