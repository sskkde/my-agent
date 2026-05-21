#!/usr/bin/env tsx
/**
 * Load Smoke Test Runner
 *
 * Runs performance load smoke tests and reports results with pass/fail for each threshold.
 * Exit code 0 if all tests pass, exit code 1 if any test fails.
 */

import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

interface TestResult {
  name: string;
  passed: boolean;
  p95: number;
  threshold: number;
}

const THRESHOLDS = {
  'Health Endpoint': 100,
  'Sessions List': 500,
  'Messages Query': 1000,
  'Workflow Runs List': 1000,
  'Audit Query': 1500,
} as const;

async function runLoadSmokeTests(): Promise<void> {
  console.log('========================================');
  console.log('Performance Load Smoke Tests');
  console.log('========================================\n');

  const vitest = spawn('npx', ['vitest', 'run', 'tests/performance/load-smoke.test.ts', '--reporter=verbose'], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  });

  return new Promise((resolve, reject) => {
    vitest.on('close', (code) => {
      if (code === 0) {
        console.log('\n========================================');
        console.log('All load smoke tests PASSED');
        console.log('========================================\n');
        resolve();
      } else {
        console.log('\n========================================');
        console.log('Load smoke tests FAILED');
        console.log('========================================\n');
        reject(new Error(`Tests exited with code ${code}`));
      }
    });

    vitest.on('error', (err) => {
      console.error('Failed to run tests:', err);
      reject(err);
    });
  });
}

async function main(): Promise<void> {
  try {
    await runLoadSmokeTests();
    process.exit(0);
  } catch (error) {
    console.error('Load smoke test failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
