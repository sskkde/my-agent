import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createFileGlobTool, type FileGlobParams, type FileGlobResult } from '../../../src/tools/builtins/file-glob.js';
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

describe('file.glob tool', () => {
  let tool: ToolDefinition;
  let testDir: string;

  const createToolContext = (overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext => ({
    toolCallId: 'tc-001',
    toolName: 'file.glob',
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
    testDir = join(tmpdir(), `file-glob-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    (globalThis as { __testDir?: string }).__testDir = testDir;
    tool = createFileGlobTool();
  });

  afterEach(() => {
    delete (globalThis as { __testDir?: string }).__testDir;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Basic Globbing', () => {
    it('should find files matching simple pattern', async () => {
      writeFileSync(join(testDir, 'test.txt'), 'content');
      writeFileSync(join(testDir, 'other.txt'), 'content');
      writeFileSync(join(testDir, 'file.md'), 'content');

      const params: FileGlobParams = { pattern: '*.txt' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as FileGlobResult;
      expect(data.files.length).toBe(2);
      expect(data.files).toContain('test.txt');
      expect(data.files).toContain('other.txt');
      expect(data.files).not.toContain('file.md');
    });

    it('should find files in subdirectories', async () => {
      mkdirSync(join(testDir, 'src'), { recursive: true });
      writeFileSync(join(testDir, 'src', 'index.ts'), 'content');
      writeFileSync(join(testDir, 'src', 'utils.ts'), 'content');
      writeFileSync(join(testDir, 'test.ts'), 'content');

      const params: FileGlobParams = { pattern: '*.ts' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as FileGlobResult;
      expect(data.files.length).toBe(3);
      expect(data.files).toContain('test.ts');
      expect(data.files).toContain('src/index.ts');
      expect(data.files).toContain('src/utils.ts');
    });

    it('should support nested directories', async () => {
      mkdirSync(join(testDir, 'src', 'components'), { recursive: true });
      writeFileSync(join(testDir, 'src', 'components', 'Button.tsx'), 'content');
      writeFileSync(join(testDir, 'src', 'index.ts'), 'content');

      const params: FileGlobParams = { pattern: '*.tsx' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as FileGlobResult;
      expect(data.files.length).toBe(1);
      expect(data.files).toContain('src/components/Button.tsx');
    });

    it('should support ? wildcard', async () => {
      writeFileSync(join(testDir, 'test1.txt'), 'content');
      writeFileSync(join(testDir, 'test2.txt'), 'content');
      writeFileSync(join(testDir, 'test10.txt'), 'content');

      const params: FileGlobParams = { pattern: 'test?.txt' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as FileGlobResult;
      expect(data.files.length).toBe(2);
      expect(data.files).toContain('test1.txt');
      expect(data.files).toContain('test2.txt');
      expect(data.files).not.toContain('test10.txt');
    });

    it('should return empty array when no files match', async () => {
      writeFileSync(join(testDir, 'test.txt'), 'content');

      const params: FileGlobParams = { pattern: '*.md' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as FileGlobResult;
      expect(data.files.length).toBe(0);
      expect(data.total).toBe(0);
    });
  });

  describe('Path Parameter', () => {
    it('should search in specified path', async () => {
      mkdirSync(join(testDir, 'src'), { recursive: true });
      mkdirSync(join(testDir, 'tests'), { recursive: true });
      writeFileSync(join(testDir, 'src', 'index.ts'), 'content');
      writeFileSync(join(testDir, 'tests', 'test.ts'), 'content');

      const params: FileGlobParams = { pattern: '*.ts', path: 'src' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as FileGlobResult;
      expect(data.files.length).toBe(1);
      expect(data.files).toContain('src/index.ts');
      expect(data.files).not.toContain('tests/test.ts');
    });

    it('should reject path outside workspace', async () => {
      const params: FileGlobParams = { pattern: '*.txt', path: '../outside' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('OUTSIDE_WORKSPACE');
    });
  });

  describe('Limit Parameter', () => {
    it('should respect limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        writeFileSync(join(testDir, `file${i}.txt`), 'content');
      }

      const params: FileGlobParams = { pattern: '*.txt', limit: 5 };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as FileGlobResult;
      expect(data.files.length).toBe(5);
      expect(data.truncated).toBe(true);
    });

    it('should use default limit of 100', async () => {
      for (let i = 0; i < 150; i++) {
        writeFileSync(join(testDir, `file${i}.txt`), 'content');
      }

      const params: FileGlobParams = { pattern: '*.txt' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as FileGlobResult;
      expect(data.files.length).toBe(100);
      expect(data.truncated).toBe(true);
    });

    it('should cap limit at maximum', async () => {
      for (let i = 0; i < 600; i++) {
        writeFileSync(join(testDir, `file${i}.txt`), 'content');
      }

      const params: FileGlobParams = { pattern: '*.txt', limit: 600 };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as FileGlobResult;
      expect(data.files.length).toBe(500);
      expect(data.truncated).toBe(true);
    });
  });

  describe('Path Safety', () => {
    it('should skip sensitive files', async () => {
      writeFileSync(join(testDir, '.env'), 'secret');
      writeFileSync(join(testDir, 'normal.txt'), 'content');

      const params: FileGlobParams = { pattern: '*' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as FileGlobResult;
      expect(data.files).not.toContain('.env');
      expect(data.files).toContain('normal.txt');
    });

    it('should skip binary files by extension', async () => {
      writeFileSync(join(testDir, 'image.png'), Buffer.from([0x89, 0x50]));
      writeFileSync(join(testDir, 'text.txt'), 'content');

      const params: FileGlobParams = { pattern: '*' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as FileGlobResult;
      expect(data.files).not.toContain('image.png');
      expect(data.files).toContain('text.txt');
    });

    it('should skip symlink targets outside workspace', async () => {
      const outsideDir = join(tmpdir(), 'glob-outside');
      mkdirSync(outsideDir, { recursive: true });
      writeFileSync(join(outsideDir, 'target.txt'), 'outside');

      symlinkSync(join(outsideDir, 'target.txt'), join(testDir, 'link.txt'));
      writeFileSync(join(testDir, 'normal.txt'), 'content');

      const params: FileGlobParams = { pattern: '*.txt' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as FileGlobResult;
      expect(data.files).not.toContain('link.txt');
      expect(data.files).toContain('normal.txt');

      rmSync(outsideDir, { recursive: true, force: true });
    });
  });

  describe('Error Handling', () => {
    it('should return MISSING_PATTERN error when pattern is missing', async () => {
      const params: FileGlobParams = { pattern: '' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_PATTERN');
    });

    it('should return PATH_NOT_FOUND error for non-existent path', async () => {
      const params: FileGlobParams = { pattern: '*.txt', path: 'nonexistent' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PATH_NOT_FOUND');
    });

    it('should return NOT_A_DIRECTORY error for file path', async () => {
      writeFileSync(join(testDir, 'file.txt'), 'content');

      const params: FileGlobParams = { pattern: '*.txt', path: 'file.txt' };
      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_A_DIRECTORY');
    });
  });

  describe('Tool Definition', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('file.glob');
    });

    it('should have search category', () => {
      expect(tool.category).toBe('search');
    });

    it('should have low sensitivity', () => {
      expect(tool.sensitivity).toBe('low');
    });

    it('should have required pattern in schema', () => {
      expect(tool.schema.required).toContain('pattern');
    });
  });
});
