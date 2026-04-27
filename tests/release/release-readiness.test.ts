import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, extname } from 'path';

describe('Release Readiness', () => {
  const rootDir = process.cwd();

  describe('Package Scripts', () => {
    let pkg: any;

    it('should have valid package.json', () => {
      const pkgPath = join(rootDir, 'package.json');
      expect(existsSync(pkgPath)).toBe(true);
      pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      expect(pkg).toBeDefined();
      expect(pkg.scripts).toBeDefined();
    });

    it('should have all required scripts', () => {
      pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
      const requiredScripts = [
        'test',
        'test:unit',
        'test:integration',
        'test:e2e',
        'typecheck',
        'start:dev',
        'db:migrate'
      ];

      for (const script of requiredScripts) {
        expect(pkg.scripts?.[script], `Missing required script: ${script}`).toBeDefined();
        expect(typeof pkg.scripts[script], `Script ${script} should be a string`).toBe('string');
        expect(pkg.scripts[script].length, `Script ${script} should not be empty`).toBeGreaterThan(0);
      }
    });

    it('should have valid test script', () => {
      pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
      expect(pkg.scripts.test).toContain('vitest');
    });

    it('should have valid typecheck script', () => {
      pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
      expect(pkg.scripts.typecheck).toContain('tsc');
      expect(pkg.scripts.typecheck).toContain('--noEmit');
    });

    it('should have valid start:dev script', () => {
      pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
      expect(pkg.scripts['start:dev']).toContain('tsx');
    });

    it('should have valid db:migrate script', () => {
      pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
      expect(pkg.scripts['db:migrate']).toBeDefined();
    });
  });

  describe('No Database Artifacts', () => {
    function findFiles(dir: string, patterns: string[]): string[] {
      const results: string[] = [];
      const entries = readdirSync(dir);

      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const relativePath = relative(rootDir, fullPath);

        // Skip node_modules, .git, and data directories (local DB files)
        if (relativePath.startsWith('node_modules') ||
            relativePath.startsWith('.git') ||
            relativePath.startsWith('data/')) {
          continue;
        }

        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
          results.push(...findFiles(fullPath, patterns));
        } else {
          for (const pattern of patterns) {
            if (entry.endsWith(pattern) || entry.includes(pattern)) {
              results.push(relativePath);
            }
          }
        }
      }

      return results;
    }

    it('should not have .db files in project', () => {
      const dbFiles = findFiles(rootDir, ['.db', '.sqlite', '.sqlite3', '.db-journal', '.db-wal', '.db-shm']);
      expect(dbFiles, `Found database files: ${dbFiles.join(', ')}`).toHaveLength(0);
    });
  });

  describe('No Secrets in Code', () => {
    function getSourceFiles(dir: string, extensions: string[]): string[] {
      const results: string[] = [];

      if (!existsSync(dir)) return results;

      const entries = readdirSync(dir);

      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stats = statSync(fullPath);

        if (stats.isDirectory()) {
          results.push(...getSourceFiles(fullPath, extensions));
        } else if (extensions.includes(extname(entry))) {
          results.push(fullPath);
        }
      }

      return results;
    }

    it('should not have OpenAI API keys (sk-...) in source files', () => {
      const srcFiles = getSourceFiles(join(rootDir, 'src'), ['.ts']);
      const suspiciousFiles: string[] = [];

      for (const file of srcFiles) {
        const content = readFileSync(file, 'utf-8');
        // Look for patterns like sk-xxxxxxxx in non-test files
        if (/sk-[a-zA-Z0-9]{10,}/.test(content)) {
          suspiciousFiles.push(relative(rootDir, file));
        }
      }

      expect(suspiciousFiles, `Potential API keys found in: ${suspiciousFiles.join(', ')}`).toHaveLength(0);
    });

    it('should not have hardcoded SECRET_TOKEN in source files', () => {
      const srcFiles = getSourceFiles(join(rootDir, 'src'), ['.ts']);
      const suspiciousFiles: string[] = [];

      for (const file of srcFiles) {
        const content = readFileSync(file, 'utf-8');
        // Look for hardcoded secret patterns (not env vars)
        if (/SECRET_TOKEN\s*=\s*["\'][^"\']{10,}["\']/.test(content)) {
          suspiciousFiles.push(relative(rootDir, file));
        }
      }

      expect(suspiciousFiles, `Potential hardcoded secrets found in: ${suspiciousFiles.join(', ')}`).toHaveLength(0);
    });

    it('should not have private keys in source files', () => {
      const srcFiles = getSourceFiles(join(rootDir, 'src'), ['.ts']);
      const suspiciousFiles: string[] = [];

      for (const file of srcFiles) {
        const content = readFileSync(file, 'utf-8');
        // Look for common private key patterns
        if (/-----BEGIN (RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) {
          suspiciousFiles.push(relative(rootDir, file));
        }
      }

      expect(suspiciousFiles, `Private keys found in: ${suspiciousFiles.join(', ')}`).toHaveLength(0);
    });
  });

  describe('No TODO/FIXME in Runtime Code', () => {
    function getSourceFiles(dir: string, extensions: string[]): string[] {
      const results: string[] = [];

      if (!existsSync(dir)) return results;

      const entries = readdirSync(dir);

      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stats = statSync(fullPath);

        if (stats.isDirectory()) {
          results.push(...getSourceFiles(fullPath, extensions));
        } else if (extensions.includes(extname(entry))) {
          results.push(fullPath);
        }
      }

      return results;
    }

    it('should not have TODO markers in src/ files', () => {
      const srcFiles = getSourceFiles(join(rootDir, 'src'), ['.ts']);
      const filesWithTODO: string[] = [];

      for (const file of srcFiles) {
        const content = readFileSync(file, 'utf-8');
        // Match TODO: or TODO ( but not within words
        if (/\bTODO[:\s(]/.test(content)) {
          filesWithTODO.push(relative(rootDir, file));
        }
      }

      expect(filesWithTODO, `TODO markers found in src/: ${filesWithTODO.join(', ')}`).toHaveLength(0);
    });

    it('should not have FIXME markers in src/ files', () => {
      const srcFiles = getSourceFiles(join(rootDir, 'src'), ['.ts']);
      const filesWithFIXME: string[] = [];

      for (const file of srcFiles) {
        const content = readFileSync(file, 'utf-8');
        if (/\bFIXME[:\s(]/.test(content)) {
          filesWithFIXME.push(relative(rootDir, file));
        }
      }

      expect(filesWithFIXME, `FIXME markers found in src/: ${filesWithFIXME.join(', ')}`).toHaveLength(0);
    });

    it('should not have XXX markers in src/ files', () => {
      const srcFiles = getSourceFiles(join(rootDir, 'src'), ['.ts']);
      const filesWithXXX: string[] = [];

      for (const file of srcFiles) {
        const content = readFileSync(file, 'utf-8');
        if (/\bXXX[:\s]/.test(content)) {
          filesWithXXX.push(relative(rootDir, file));
        }
      }

      expect(filesWithXXX, `XXX markers found in src/: ${filesWithXXX.join(', ')}`).toHaveLength(0);
    });
  });

  describe('No Forbidden Dependencies', () => {
    it('should not depend on forbidden packages', () => {
      const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
      const forbiddenPackages = [
        'pg',           // PostgreSQL driver - using SQLite
        'redis',        // Redis client - not needed
        'mongodb',      // MongoDB driver - using SQLite
        'mysql',        // MySQL driver - using SQLite
        'mongoose',     // MongoDB ORM - not needed
        'sequelize',    // Heavy ORM - using better-sqlite3
        'typeorm',      // Heavy ORM - not needed
      ];

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies
      };

      const foundForbidden: string[] = [];
      for (const forbidden of forbiddenPackages) {
        if (allDeps[forbidden]) {
          foundForbidden.push(forbidden);
        }
      }

      expect(foundForbidden, `Forbidden dependencies found: ${foundForbidden.join(', ')}`).toHaveLength(0);
    });
  });

  describe('TypeScript Configuration', () => {
    it('should have valid tsconfig.json', () => {
      const tsconfigPath = join(rootDir, 'tsconfig.json');
      expect(existsSync(tsconfigPath)).toBe(true);

      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'));
      expect(tsconfig.compilerOptions).toBeDefined();
    });

    it('should have strict mode enabled', () => {
      const tsconfig = JSON.parse(readFileSync(join(rootDir, 'tsconfig.json'), 'utf-8'));
      expect(tsconfig.compilerOptions?.strict).toBe(true);
    });

    it('should include src and tests directories', () => {
      const tsconfig = JSON.parse(readFileSync(join(rootDir, 'tsconfig.json'), 'utf-8'));
      const includes = tsconfig.include || [];

      expect(includes.some((i: string) => i.includes('src'))).toBe(true);
      expect(includes.some((i: string) => i.includes('tests'))).toBe(true);
    });

    it('should exclude node_modules', () => {
      const tsconfig = JSON.parse(readFileSync(join(rootDir, 'tsconfig.json'), 'utf-8'));
      const excludes = tsconfig.exclude || [];

      expect(excludes.some((e: string) => e.includes('node_modules'))).toBe(true);
    });
  });

  describe('.gitignore Configuration', () => {
    it('should exist', () => {
      expect(existsSync(join(rootDir, '.gitignore'))).toBe(true);
    });

    it('should ignore node_modules', () => {
      const gitignore = readFileSync(join(rootDir, '.gitignore'), 'utf-8');
      expect(gitignore).toContain('node_modules');
    });

    it('should ignore database files', () => {
      const gitignore = readFileSync(join(rootDir, '.gitignore'), 'utf-8');
      expect(gitignore).toContain('*.db');
    });

    it('should ignore environment files', () => {
      const gitignore = readFileSync(join(rootDir, '.gitignore'), 'utf-8');
      expect(gitignore).toContain('.env');
    });

    it('should ignore build output', () => {
      const gitignore = readFileSync(join(rootDir, '.gitignore'), 'utf-8');
      expect(gitignore).toContain('dist/');
    });
  });

  describe('Entry Points', () => {
    it('should have src/index.ts', () => {
      expect(existsSync(join(rootDir, 'src', 'index.ts'))).toBe(true);
    });

    it('should have valid package type module', () => {
      const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
      expect(pkg.type).toBe('module');
    });
  });

  describe('Test Infrastructure', () => {
    it('should have vitest.config.ts', () => {
      expect(existsSync(join(rootDir, 'vitest.config.ts'))).toBe(true);
    });

    it('should have tests directory', () => {
      expect(existsSync(join(rootDir, 'tests'))).toBe(true);
    });

    it('should have unit tests directory', () => {
      expect(existsSync(join(rootDir, 'tests', 'unit'))).toBe(true);
    });

    it('should have e2e tests directory', () => {
      expect(existsSync(join(rootDir, 'tests', 'e2e'))).toBe(true);
    });
  });

  describe('Version and Metadata', () => {
    it('should have valid package name', () => {
      const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
      expect(pkg.name).toBeDefined();
      expect(pkg.name.length).toBeGreaterThan(0);
    });

    it('should have version', () => {
      const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
      expect(pkg.version).toBeDefined();
      expect(pkg.version.length).toBeGreaterThan(0);
    });

    it('should have license', () => {
      const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
      expect(pkg.license).toBeDefined();
    });
  });
});
