import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  sha256Text,
  sha256Buffer,
  validateWritePathSafety,
  writeTextFileAtomic,
  readTextFileForEdit,
  MAX_FILE_WRITE_BYTES,
  MAX_FILE_EDIT_BYTES,
} from '../../../src/tools/builtins/safe-file-write.js';

describe('safe-file-write', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `safe-file-write-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('sha256Text', () => {
    it('should compute SHA-256 hash of text content', () => {
      const content = 'Hello, World!';
      const hash = sha256Text(content);
      
      expect(hash).toBe('dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f');
      expect(hash).toHaveLength(64);
    });

    it('should return consistent hash for same input', () => {
      const content = 'test content';
      const hash1 = sha256Text(content);
      const hash2 = sha256Text(content);
      
      expect(hash1).toBe(hash2);
    });

    it('should return different hash for different input', () => {
      const hash1 = sha256Text('content 1');
      const hash2 = sha256Text('content 2');
      
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = sha256Text('');
      expect(hash).toHaveLength(64);
    });
  });

  describe('sha256Buffer', () => {
    it('should compute SHA-256 hash of buffer', () => {
      const buffer = Buffer.from('Hello, World!', 'utf8');
      const hash = sha256Buffer(buffer);
      
      expect(hash).toHaveLength(64);
    });

    it('should return same hash as sha256Text for UTF-8 content', () => {
      const content = 'Test content';
      const buffer = Buffer.from(content, 'utf8');
      
      const textHash = sha256Text(content);
      const bufferHash = sha256Buffer(buffer);
      
      expect(textHash).toBe(bufferHash);
    });
  });

  describe('validateWritePathSafety', () => {
    it('should accept safe relative paths', () => {
      const result = validateWritePathSafety('test.txt', testDir);
      
      expect(result.safe).toBe(true);
      expect(result.canonicalPath).toBe(join(testDir, 'test.txt'));
      expect(result.relativePath).toBe('test.txt');
    });

    it('should reject paths with .. escape', () => {
      const result = validateWritePathSafety('../outside.txt', testDir);
      
      expect(result.safe).toBe(false);
      expect(result.error?.code).toBe('PATH_ESCAPE');
    });

    it('should reject paths outside workspace', () => {
      const result = validateWritePathSafety('/etc/passwd', testDir);
      
      expect(result.safe).toBe(false);
      expect(result.error?.code).toBe('OUTSIDE_WORKSPACE');
    });

    it('should reject sensitive .env files', () => {
      const result = validateWritePathSafety('.env', testDir);
      
      expect(result.safe).toBe(false);
      expect(result.error?.code).toBe('SENSITIVE_FILE');
    });

    it('should reject .env.local files', () => {
      const result = validateWritePathSafety('.env.local', testDir);
      
      expect(result.safe).toBe(false);
      expect(result.error?.code).toBe('SENSITIVE_FILE');
    });

    it('should reject private key files', () => {
      const result = validateWritePathSafety('id_rsa', testDir);
      
      expect(result.safe).toBe(false);
      expect(result.error?.code).toBe('SENSITIVE_FILE');
    });

    it('should reject database files', () => {
      const result = validateWritePathSafety('data.db', testDir);
      
      expect(result.safe).toBe(false);
      expect(result.error?.code).toBe('SENSITIVE_FILE');
    });

    it('should reject binary extensions', () => {
      const result = validateWritePathSafety('image.png', testDir);
      
      expect(result.safe).toBe(false);
      expect(result.error?.code).toBe('BINARY_FILE');
    });

    it('should reject .exe files', () => {
      const result = validateWritePathSafety('program.exe', testDir);
      
      expect(result.safe).toBe(false);
      expect(result.error?.code).toBe('BINARY_FILE');
    });

    it('should allow new file creation with allowNew option', () => {
      const result = validateWritePathSafety('new-file.txt', testDir, { allowNew: true });
      
      expect(result.safe).toBe(true);
    });

    it('should validate parent directory for new files', () => {
      mkdirSync(join(testDir, 'subdir'), { recursive: true });
      const result = validateWritePathSafety('subdir/new-file.txt', testDir, { allowNew: true });
      
      expect(result.safe).toBe(true);
    });
  });

  describe('writeTextFileAtomic', () => {
    it('should create new file successfully', () => {
      const result = writeTextFileAtomic({
        filePath: 'new-file.txt',
        content: 'Hello, World!',
        workspaceRoot: testDir,
      });

      expect(result.created).toBe(true);
      expect(result.bytesWritten).toBe(13);
      expect(result.newHash).toHaveLength(64);
      expect(result.previousHash).toBeUndefined();
      expect(existsSync(join(testDir, 'new-file.txt'))).toBe(true);
    });

    it('should overwrite existing file', () => {
      writeFileSync(join(testDir, 'existing.txt'), 'Old content');
      
      const result = writeTextFileAtomic({
        filePath: 'existing.txt',
        content: 'New content',
        workspaceRoot: testDir,
      });

      expect(result.created).toBe(false);
      expect(result.previousHash).toBeDefined();
      expect(readFileSync(join(testDir, 'existing.txt'), 'utf8')).toBe('New content');
    });

    it('should reject hash mismatch', () => {
      writeFileSync(join(testDir, 'file.txt'), 'Original content');
      
      expect(() => {
        writeTextFileAtomic({
          filePath: 'file.txt',
          content: 'New content',
          workspaceRoot: testDir,
          expectedHash: 'wrong-hash',
        });
      }).toThrow('Hash mismatch');
    });

    it('should allow write when hash matches', () => {
      writeFileSync(join(testDir, 'file.txt'), 'Original content');
      const originalHash = sha256Text('Original content');
      
      const result = writeTextFileAtomic({
        filePath: 'file.txt',
        content: 'New content',
        workspaceRoot: testDir,
        expectedHash: originalHash,
      });

      expect(result.created).toBe(false);
    });

    it('should reject NUL bytes in content', () => {
      expect(() => {
        writeTextFileAtomic({
          filePath: 'file.txt',
          content: 'Content with \0 NUL byte',
          workspaceRoot: testDir,
        });
      }).toThrow('NUL bytes');
    });

    it('should reject content exceeding size limit', () => {
      const largeContent = 'x'.repeat(MAX_FILE_WRITE_BYTES + 1);
      
      expect(() => {
        writeTextFileAtomic({
          filePath: 'large.txt',
          content: largeContent,
          workspaceRoot: testDir,
        });
      }).toThrow('exceeds maximum size');
    });

    it('should create parent directories with createDirs option', () => {
      const result = writeTextFileAtomic({
        filePath: 'subdir/nested/file.txt',
        content: 'Content',
        workspaceRoot: testDir,
        createDirs: true,
      });

      expect(result.created).toBe(true);
      expect(existsSync(join(testDir, 'subdir/nested/file.txt'))).toBe(true);
    });

    it('should reject when parent directory does not exist without createDirs', () => {
      expect(() => {
        writeTextFileAtomic({
          filePath: 'nonexistent/file.txt',
          content: 'Content',
          workspaceRoot: testDir,
          createDirs: false,
        });
      }).toThrow('Parent directory does not exist');
    });

    it('should reject path escape', () => {
      expect(() => {
        writeTextFileAtomic({
          filePath: '../outside.txt',
          content: 'Content',
          workspaceRoot: testDir,
        });
      }).toThrow();
    });

    it('should reject sensitive files', () => {
      expect(() => {
        writeTextFileAtomic({
          filePath: '.env',
          content: 'SECRET=value',
          workspaceRoot: testDir,
        });
      }).toThrow();
    });
  });

  describe('readTextFileForEdit', () => {
    it('should read existing file', () => {
      writeFileSync(join(testDir, 'file.txt'), 'File content');
      
      const result = readTextFileForEdit({
        filePath: 'file.txt',
        workspaceRoot: testDir,
      });

      expect(result.exists).toBe(true);
      expect(result.content).toBe('File content');
      expect(result.hash).toHaveLength(64);
    });

    it('should return empty for non-existent file', () => {
      const result = readTextFileForEdit({
        filePath: 'nonexistent.txt',
        workspaceRoot: testDir,
      });

      expect(result.exists).toBe(false);
      expect(result.content).toBe('');
      expect(result.hash).toBe(sha256Text(''));
    });

    it('should reject binary content', () => {
      writeFileSync(join(testDir, 'binary.dat'), Buffer.from([0x00, 0x01, 0x02]));
      
      expect(() => {
        readTextFileForEdit({
          filePath: 'binary.dat',
          workspaceRoot: testDir,
        });
      }).toThrow();
    });

    it('should reject files exceeding edit size limit', () => {
      const largeContent = 'x'.repeat(MAX_FILE_EDIT_BYTES + 1);
      writeFileSync(join(testDir, 'large.txt'), largeContent);
      
      expect(() => {
        readTextFileForEdit({
          filePath: 'large.txt',
          workspaceRoot: testDir,
        });
      }).toThrow('exceeds maximum size');
    });

    it('should reject path escape', () => {
      expect(() => {
        readTextFileForEdit({
          filePath: '../outside.txt',
          workspaceRoot: testDir,
        });
      }).toThrow();
    });

    it('should reject sensitive files', () => {
      writeFileSync(join(testDir, '.env'), 'SECRET=value');
      
      expect(() => {
        readTextFileForEdit({
          filePath: '.env',
          workspaceRoot: testDir,
        });
      }).toThrow();
    });
  });
});
