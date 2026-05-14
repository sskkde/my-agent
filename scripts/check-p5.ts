import { spawnSync } from 'node:child_process';

const commands: Array<[string, string[]]> = [
  ['npm', ['run', 'typecheck']],
  ['npx', ['vitest', 'run',
    'tests/integration/api/response-envelope-contract.test.ts',
    'tests/integration/api/error-format-contract.test.ts',
    'tests/integration/api/pagination-contract.test.ts',
    'tests/integration/api/rate-limit.test.ts',
    'tests/integration/api/request-validation.test.ts',
    'tests/integration/api/compression.test.ts',
    'tests/integration/api/health-check.test.ts',
    'tests/integration/api/swagger-ui.test.ts',
    'tests/integration/api/auth-token.test.ts',
    'tests/e2e/flow-17-p5-product-journey.test.ts',
  ]],
  ['npm', ['run', 'test:web']],
  ['npm', ['run', 'build:web']],
];

for (const [cmd, args] of commands) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
