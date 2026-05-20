import { spawnSync } from 'node:child_process';

// ANSI color codes
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

// Test counters
let passCount = 0;
let failCount = 0;

function logPass(message: string): void {
  console.log(`${GREEN}✅ PASS${RESET} ${message}`);
  passCount++;
}

function logFail(message: string): void {
  console.log(`${RED}❌ FAIL${RESET} ${message}`);
  failCount++;
}

function logSkip(message: string): void {
  console.log(`${YELLOW}⏭️  SKIP${RESET} ${message}`);
}

function logInfo(message: string): void {
  console.log(`ℹ️  ${message}`);
}

function runCommand(
  command: string,
  args: string[],
  options?: { silent?: boolean; timeout?: number }
): { success: boolean; output: string; error: string } {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    shell: process.platform === 'win32',
    timeout: options?.timeout ?? 120000,
    ...(options?.silent ? {} : { stdio: 'inherit' }),
  });

  return {
    success: result.status === 0,
    output: result.stdout ?? '',
    error: result.stderr ?? '',
  };
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

console.log('='.repeat(60));
console.log('Docker Smoke Test');
console.log('='.repeat(60));

// Step 1: Check Docker availability
console.log('\n[1/7] Checking Docker availability');
console.log('-'.repeat(60));

const dockerCheck = runCommand('docker', ['--version'], { silent: true });
if (!dockerCheck.success) {
  logSkip('Docker is not available on this system');
  console.log('\n' + '='.repeat(60));
  console.log('Docker Smoke Test: SKIPPED');
  console.log('='.repeat(60));
  console.log('\nDocker is required to run this smoke test.');
  console.log('Please install Docker and try again.');
  process.exit(0);
}

logPass(`Docker is available: ${dockerCheck.output.trim()}`);

// Step 2: Check docker compose availability
console.log('\n[2/7] Checking docker compose availability');
console.log('-'.repeat(60));

const composeCheck = runCommand('docker', ['compose', 'version'], { silent: true });
if (!composeCheck.success) {
  logFail('docker compose is not available');
  console.log('\n' + '='.repeat(60));
  console.log('Docker Smoke Test: FAILED');
  console.log('='.repeat(60));
  console.log(`\nSummary: ${passCount} passed, ${failCount} failed`);
  process.exit(1);
}

logPass(`docker compose is available: ${composeCheck.output.trim()}`);

// Step 3: Build Docker images
console.log('\n[3/7] Building Docker images');
console.log('-'.repeat(60));

logInfo('Running: docker compose build');
const buildResult = runCommand('docker', ['compose', 'build']);
if (!buildResult.success) {
  logFail('Docker image build failed');
  console.log('\n' + '='.repeat(60));
  console.log('Docker Smoke Test: FAILED');
  console.log('='.repeat(60));
  console.log(`\nSummary: ${passCount} passed, ${failCount} failed`);
  process.exit(1);
}

logPass('Docker images built successfully');

// Step 4: Start containers
console.log('\n[4/7] Starting containers');
console.log('-'.repeat(60));

logInfo('Running: docker compose up -d');
const upResult = runCommand('docker', ['compose', 'up', '-d']);
if (!upResult.success) {
  logFail('Failed to start containers');
  // Cleanup attempt
  runCommand('docker', ['compose', 'down'], { silent: true });
  console.log('\n' + '='.repeat(60));
  console.log('Docker Smoke Test: FAILED');
  console.log('='.repeat(60));
  console.log(`\nSummary: ${passCount} passed, ${failCount} failed`);
  process.exit(1);
}

logPass('Containers started successfully');

// Step 5: Wait for API health check
console.log('\n[5/7] Waiting for API health check (max 60s)');
console.log('-'.repeat(60));

const maxAttempts = 10;
const retryDelayMs = 6000;
let apiHealthy = false;

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  logInfo(`Health check attempt ${attempt}/${maxAttempts}...`);
  
  const healthCheck = runCommand('curl', ['-f', '-s', '-o', '/dev/null', '-w', '%{http_code}', 'http://localhost:3003/api/v1/health'], { silent: true });
  
  if (healthCheck.success && healthCheck.output.trim() === '200') {
    apiHealthy = true;
    logPass(`API health check passed (attempt ${attempt})`);
    break;
  }
  
  if (attempt < maxAttempts) {
    logInfo(`API not ready yet, waiting ${retryDelayMs / 1000}s...`);
    sleep(retryDelayMs);
  }
}

if (!apiHealthy) {
  logFail('API health check failed after maximum attempts');
  // Cleanup
  console.log('\nCleaning up...');
  runCommand('docker', ['compose', 'down'], { silent: true });
  console.log('\n' + '='.repeat(60));
  console.log('Docker Smoke Test: FAILED');
  console.log('='.repeat(60));
  console.log(`\nSummary: ${passCount} passed, ${failCount} failed`);
  process.exit(1);
}

// Step 6: Verify endpoints
console.log('\n[6/7] Verifying endpoints');
console.log('-'.repeat(60));

// 6a: Verify API health endpoint returns 200
logInfo('Checking API health endpoint...');
const apiHealthResult = runCommand('curl', ['-f', '-s', '-o', '/dev/null', '-w', '%{http_code}', 'http://localhost:3003/api/v1/health'], { silent: true });
if (apiHealthResult.success && apiHealthResult.output.trim() === '200') {
  logPass('API health endpoint returns 200');
} else {
  logFail(`API health endpoint returned: ${apiHealthResult.output.trim() || 'error'}`);
}

// 6b: Verify web returns 200
logInfo('Checking web endpoint...');
const webResult = runCommand('curl', ['-f', '-s', '-o', '/dev/null', '-w', '%{http_code}', 'http://localhost:3002/'], { silent: true });
if (webResult.success && webResult.output.trim() === '200') {
  logPass('Web endpoint returns 200');
} else {
  logFail(`Web endpoint returned: ${webResult.output.trim() || 'error'}`);
}

// Step 7: Check security headers
console.log('\n[7/7] Checking security headers');
console.log('-'.repeat(60));

logInfo('Checking API security headers...');
const headersResult = runCommand('curl', ['-sI', 'http://localhost:3003/api/v1/health'], { silent: true });

if (headersResult.success) {
  const headers = headersResult.output.toLowerCase();
  if (headers.includes('x-content-type-options: nosniff')) {
    logPass('API has x-content-type-options: nosniff header');
  } else {
    logFail('API missing x-content-type-options: nosniff header');
    logInfo(`Headers received:\n${headersResult.output}`);
  }
} else {
  logFail('Failed to retrieve API headers');
}

// Cleanup
console.log('\n' + '='.repeat(60));
console.log('Cleanup');
console.log('='.repeat(60));

logInfo('Running: docker compose down');
const downResult = runCommand('docker', ['compose', 'down']);
if (downResult.success) {
  logInfo('Containers stopped successfully');
} else {
  logInfo('Note: Cleanup may have had issues, but tests completed');
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('Docker Smoke Test Complete');
console.log('='.repeat(60));

if (failCount === 0) {
  console.log(`\n${GREEN}✅ All checks passed${RESET}`);
  console.log(`\nSummary: ${passCount} passed, ${failCount} failed`);
  process.exit(0);
} else {
  console.log(`\n${RED}❌ Some checks failed${RESET}`);
  console.log(`\nSummary: ${passCount} passed, ${failCount} failed`);
  process.exit(1);
}
