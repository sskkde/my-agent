import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('Project Scaffold', () => {
  const rootDir = process.cwd();

  describe('package.json', () => {
    it('should exist', () => {
      expect(existsSync(join(rootDir, 'package.json'))).toBe(true);
    });

    it('should have required scripts', () => {
      const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
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
        expect(pkg.scripts?.[script], `Missing script: ${script}`).toBeDefined();
      }
    });
  });

  describe('tsconfig.json', () => {
    it('should exist', () => {
      expect(existsSync(join(rootDir, 'tsconfig.json'))).toBe(true);
    });

    it('should have strict mode enabled', () => {
      const tsconfig = JSON.parse(readFileSync(join(rootDir, 'tsconfig.json'), 'utf-8'));
      expect(tsconfig.compilerOptions?.strict).toBe(true);
    });

    it('should have noImplicitAny enabled', () => {
      const tsconfig = JSON.parse(readFileSync(join(rootDir, 'tsconfig.json'), 'utf-8'));
      expect(tsconfig.compilerOptions?.noImplicitAny).toBe(true);
    });
  });

  describe('vitest.config.ts', () => {
    it('should exist', () => {
      expect(existsSync(join(rootDir, 'vitest.config.ts'))).toBe(true);
    });
  });

  describe('Directory structure', () => {
    it('should have src/ directory', () => {
      expect(existsSync(join(rootDir, 'src'))).toBe(true);
    });

    it('should have tests/ directory', () => {
      expect(existsSync(join(rootDir, 'tests'))).toBe(true);
    });

    describe('src/ subdirectories', () => {
      const srcDirs = [
        'shared',
        'storage',
        'gateway',
        'foreground',
        'planner',
        'dispatcher',
        'kernel',
        'tools',
        'permissions',
        'context',
        'memory',
        'subagents',
        'workflows',
        'triggers',
        'connectors',
        'observability'
      ];

      for (const dir of srcDirs) {
        it(`should have src/${dir}/ directory`, () => {
          expect(existsSync(join(rootDir, 'src', dir))).toBe(true);
        });
      }
    });

    describe('tests/ subdirectories', () => {
      const testDirs = [
        'unit',
        'integration',
        'e2e',
        'fixtures',
        'state-machine'
      ];

      for (const dir of testDirs) {
        it(`should have tests/${dir}/ directory`, () => {
          expect(existsSync(join(rootDir, 'tests', dir))).toBe(true);
        });
      }
    });
  });

  describe('.gitignore', () => {
    it('should exist', () => {
      expect(existsSync(join(rootDir, '.gitignore'))).toBe(true);
    });

    it('should ignore node_modules', () => {
      const gitignore = readFileSync(join(rootDir, '.gitignore'), 'utf-8');
      expect(gitignore).toContain('node_modules');
    });
  });

  describe('Entry point', () => {
    it('should have src/index.ts', () => {
      expect(existsSync(join(rootDir, 'src', 'index.ts'))).toBe(true);
    });
  });
});
