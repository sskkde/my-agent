import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('Documentation and Runbook', () => {
  const rootDir = process.cwd();

  describe('README.md', () => {
    const readmePath = join(rootDir, 'README.md');

    it('should exist', () => {
      expect(existsSync(readmePath)).toBe(true);
    });

    it('should contain project description', () => {
      const readme = readFileSync(readmePath, 'utf-8');
      expect(readme).toContain('multi-agent');
      expect(readme).toContain('orchestration');
    });

    it('should contain prerequisites', () => {
      const readme = readFileSync(readmePath, 'utf-8');
      expect(readme).toContain('Node.js');
      expect(readme).toContain('SQLite');
    });

    it('should contain installation command npm install', () => {
      const readme = readFileSync(readmePath, 'utf-8');
      expect(readme).toContain('npm install');
    });

    it('should contain database setup command npm run db:migrate', () => {
      const readme = readFileSync(readmePath, 'utf-8');
      expect(readme).toContain('npm run db:migrate');
    });

    it('should contain development start command npm run start:dev', () => {
      const readme = readFileSync(readmePath, 'utf-8');
      expect(readme).toContain('npm run start:dev');
    });

    it('should contain testing commands', () => {
      const readme = readFileSync(readmePath, 'utf-8');
      expect(readme).toContain('npm test');
      expect(readme).toContain('npm run typecheck');
      expect(readme).toContain('npm run test:e2e');
    });

    it('should contain LLM provider configuration', () => {
      const readme = readFileSync(readmePath, 'utf-8');
      expect(readme).toContain('OPENROUTER_API_KEY');
      expect(readme).toContain('OLLAMA_BASE_URL');
    });

    it('should contain architecture overview', () => {
      const readme = readFileSync(readmePath, 'utf-8');
      expect(readme).toContain('Architecture');
      expect(readme).toContain('Core Components');
    });

    it('should contain directory structure', () => {
      const readme = readFileSync(readmePath, 'utf-8');
      expect(readme).toContain('Directory Structure');
      expect(readme).toContain('src/');
    });
  });

  describe('RUNBOOK.md', () => {
    const runbookPath = join(rootDir, 'docs', 'RUNBOOK.md');

    it('should exist', () => {
      expect(existsSync(runbookPath)).toBe(true);
    });

    it('should contain restart procedure', () => {
      const runbook = readFileSync(runbookPath, 'utf-8');
      expect(runbook).toContain('Restart');
      expect(runbook).toContain('Shutdown');
      expect(runbook).toContain('Startup');
    });

    it('should contain recovery procedure', () => {
      const runbook = readFileSync(runbookPath, 'utf-8');
      expect(runbook).toContain('Recovery');
      expect(runbook).toContain('Pending Approvals');
      expect(runbook).toContain('Active Waits');
    });

    it('should contain resource tuning guidance for 2C2G', () => {
      const runbook = readFileSync(runbookPath, 'utf-8');
      expect(runbook).toContain('2C2G');
      expect(runbook).toContain('maxConcurrentPlannerRunsPerSession');
      expect(runbook).toContain('maxConcurrentLLMCalls');
      expect(runbook).toContain('maxCacheSizeMB');
      expect(runbook).toContain('maxContextTokens');
    });

    it('should contain resource tuning values', () => {
      const runbook = readFileSync(runbookPath, 'utf-8');
      expect(runbook).toContain('3');
      expect(runbook).toContain('2');
      expect(runbook).toContain('256');
      expect(runbook).toContain('8000');
    });

    it('should contain environment variable reference', () => {
      const runbook = readFileSync(runbookPath, 'utf-8');
      expect(runbook).toContain('Environment Variables');
      expect(runbook).toContain('Variable');
      expect(runbook).toContain('Description');
    });

    it('should contain web search backend configuration', () => {
      const runbook = readFileSync(runbookPath, 'utf-8');
      expect(runbook).toContain('WEB_SEARCH_BACKEND');
      expect(runbook).toContain('SEARXNG_BASE_URL');
      expect(runbook).toContain('TAVILY_API_KEY');
    });

    it('should contain web search troubleshooting', () => {
      const runbook = readFileSync(runbookPath, 'utf-8');
      expect(runbook).toContain('Web Search');
      expect(runbook).toContain('PROVIDER_NOT_CONFIGURED');
    });

    it('should contain troubleshooting guide', () => {
      const runbook = readFileSync(runbookPath, 'utf-8');
      expect(runbook).toContain('Common Issues');
      expect(runbook).toContain('Solutions');
    });

    it('should contain log locations', () => {
      const runbook = readFileSync(runbookPath, 'utf-8');
      expect(runbook).toContain('Log');
      expect(runbook).toContain('Debugging');
    });
  });

  describe('.env.example', () => {
    const envExamplePath = join(rootDir, '.env.example');

    it('should exist', () => {
      expect(existsSync(envExamplePath)).toBe(true);
    });

    it('should contain OPENROUTER_API_KEY placeholder', () => {
      const envExample = readFileSync(envExamplePath, 'utf-8');
      expect(envExample).toContain('OPENROUTER_API_KEY=');
      expect(envExample).toContain('your_openrouter_api_key_here');
    });

    it('should contain OLLAMA_BASE_URL placeholder', () => {
      const envExample = readFileSync(envExamplePath, 'utf-8');
      expect(envExample).toContain('OLLAMA_BASE_URL=');
      expect(envExample).toContain('localhost');
    });

    it('should NOT contain real API keys', () => {
      const envExample = readFileSync(envExamplePath, 'utf-8');
      // Check for common API key patterns
      expect(envExample).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
      expect(envExample).not.toContain('SECRET_TOKEN');
      expect(envExample).not.toContain('actual_key');
      expect(envExample).not.toContain('real_key');
    });

    it('should contain only placeholder values', () => {
      const envExample = readFileSync(envExamplePath, 'utf-8');
      const lines = envExample.split('\n');

      for (const line of lines) {
        // Skip comments and empty lines
        if (line.trim().startsWith('#') || line.trim() === '') {
          continue;
        }

        // Check that values contain placeholder indicators
        if (line.includes('=')) {
          const value = line.split('=')[1] || '';
          // Values should contain placeholder words or be simple defaults
          const isValid =
            value.includes('your_') ||
            value.includes('localhost') ||
            value.includes('development') ||
            value.includes('info') ||
            value.includes('warn') ||
            value.includes('./') ||
            value.includes('30000') ||
            value === 'mock' ||
            value === 'disabled' ||
            value === 'true' ||
            value.startsWith('#') ||
            value.trim() === '';

          expect(isValid, `Line "${line}" may contain a real secret`).toBe(true);
        }
      }
    });

    it('should contain web search environment variables', () => {
      const envExample = readFileSync(envExamplePath, 'utf-8');
      expect(envExample).toContain('WEB_SEARCH_BACKEND');
      expect(envExample).toContain('SEARXNG_BASE_URL');
      expect(envExample).toContain('TAVILY_API_KEY');
      expect(envExample).toContain('WEB_SEARCH_API_URL');
    });
  });

  describe('docs directory', () => {
    it('should exist', () => {
      expect(existsSync(join(rootDir, 'docs'))).toBe(true);
    });
  });
});
