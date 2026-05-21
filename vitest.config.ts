import { defineConfig } from 'vitest/config';

const isCI = !!process.env.CI;

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./tests/global-setup.ts'],
    include: ['tests/**/*.{test,spec}.{js,ts}'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 15_000,
    hookTimeout: isCI ? 120_000 : 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.{js,ts}'
      ]
    }
  },
  resolve: {
    alias: {
      '@': '/src'
    }
  }
});
