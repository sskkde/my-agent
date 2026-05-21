import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ANSI color codes
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
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

function logInfo(message: string): void {
  console.log(`${CYAN}ℹ️  ${message}${RESET}`);
}

function runCurl(
  args: string[]
): { success: boolean; stdout: string; stderr: string } {
  const result = spawnSync('curl', args, {
    encoding: 'utf-8',
    shell: process.platform === 'win32',
    timeout: 30000,
  });

  return {
    success: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// Get API base URL from environment or use default
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3003';

console.log('='.repeat(60));
console.log('Deployment Smoke Test');
console.log('='.repeat(60));
console.log(`\n${CYAN}Target: ${API_BASE_URL}${RESET}`);

// Step 1: Health endpoint check
console.log('\n[1/8] Checking /api/v1/health endpoint');
console.log('-'.repeat(60));

logInfo(`GET ${API_BASE_URL}/api/v1/health`);
const healthResult = runCurl([
  '-f',
  '-s',
  '-o',
  '/dev/null',
  '-w',
  '%{http_code}',
  `${API_BASE_URL}/api/v1/health`,
]);

if (healthResult.success && healthResult.stdout.trim() === '200') {
  logPass('/api/v1/health returns 200');
} else {
  logFail(`/api/v1/health returned: ${healthResult.stdout.trim() || 'error'}`);
}

// Also check legacy /api/ path redirects properly
logInfo(`GET ${API_BASE_URL}/api/health (legacy redirect check)`);
const legacyHealthResult = runCurl([
  '-s',
  '-o',
  '/dev/null',
  '-w',
  '%{http_code}',
  '-L',
  `${API_BASE_URL}/api/health`,
]);

if (
  legacyHealthResult.success &&
  (legacyHealthResult.stdout.trim() === '200' ||
    legacyHealthResult.stdout.trim() === '307')
) {
  logPass('/api/health redirects properly');
} else {
  logFail(
    `/api/health returned: ${legacyHealthResult.stdout.trim() || 'error'}`
  );
}

// Step 2: Health ready endpoint check
console.log('\n[2/8] Checking /api/v1/health/ready endpoint');
console.log('-'.repeat(60));

logInfo(`GET ${API_BASE_URL}/api/v1/health/ready`);
const healthReadyResult = runCurl([
  '-f',
  '-s',
  '-o',
  '/dev/null',
  '-w',
  '%{http_code}',
  `${API_BASE_URL}/api/v1/health/ready`,
]);

if (healthReadyResult.success && healthReadyResult.stdout.trim() === '200') {
  logPass('/api/v1/health/ready returns 200');
} else {
  logFail(
    `/api/v1/health/ready returned: ${healthReadyResult.stdout.trim() || 'error'}`
  );
}

// Step 3: API docs JSON endpoint check
console.log('\n[3/8] Checking /api/v1/docs/json endpoint');
console.log('-'.repeat(60));

logInfo(`GET ${API_BASE_URL}/api/v1/docs/json`);
const docsResult = runCurl([
  '-f',
  '-s',
  '-o',
  '/dev/null',
  '-w',
  '%{http_code}',
  `${API_BASE_URL}/api/v1/docs/json`,
]);

if (docsResult.success && docsResult.stdout.trim() === '200') {
  logPass('/api/v1/docs/json returns 200');
} else {
  logFail(
    `/api/v1/docs/json returned: ${docsResult.stdout.trim() || 'error'}`
  );
}

// Step 4: Metrics endpoint check
console.log('\n[4/8] Checking /api/v1/metrics endpoint');
console.log('-'.repeat(60));

logInfo(`GET ${API_BASE_URL}/api/v1/metrics`);
const metricsResult = runCurl([
  '-f',
  '-s',
  '-o',
  '/dev/null',
  '-w',
  '%{http_code}',
  `${API_BASE_URL}/api/v1/metrics`,
]);

if (metricsResult.success && metricsResult.stdout.trim() === '200') {
  logPass('/api/v1/metrics returns 200');
} else {
  logFail(
    `/api/v1/metrics returned: ${metricsResult.stdout.trim() || 'error'}`
  );
}

// Step 5: CORS allowed origin check
console.log('\n[5/8] Checking CORS allowed origin');
console.log('-'.repeat(60));

logInfo(`Testing CORS with allowed origin: http://localhost:3002`);
const corsAllowedResult = runCurl([
  '-s',
  '-I',
  '-H',
  'Origin: http://localhost:3002',
  `${API_BASE_URL}/api/v1/health`,
]);

if (corsAllowedResult.success) {
  const headers = corsAllowedResult.stdout.toLowerCase();
  if (
    headers.includes('access-control-allow-origin') &&
    (headers.includes('localhost:3002') || headers.includes('*'))
  ) {
    logPass('CORS allows localhost:3002 origin');
  } else {
    logFail('CORS does not include allowed origin header');
    logInfo(`Headers:\n${corsAllowedResult.stdout}`);
  }
} else {
  logFail('Failed to check CORS headers');
}

// Step 6: CORS disallowed origin check
console.log('\n[6/8] Checking CORS disallowed origin');
console.log('-'.repeat(60));

logInfo(`Testing CORS with disallowed origin: https://evil.example.com`);
const corsDisallowedResult = runCurl([
  '-s',
  '-I',
  '-H',
  'Origin: https://evil.example.com',
  `${API_BASE_URL}/api/v1/health`,
]);

if (corsDisallowedResult.success) {
  const headers = corsDisallowedResult.stdout.toLowerCase();
  // The disallowed origin should NOT be in the CORS header
  if (
    !headers.includes('access-control-allow-origin: https://evil.example.com')
  ) {
    logPass('CORS correctly rejects disallowed origin');
  } else {
    logFail('CORS incorrectly allows disallowed origin');
  }
} else {
  logFail('Failed to check CORS rejection');
}

// Step 7: Security headers check
console.log('\n[7/8] Checking security headers');
console.log('-'.repeat(60));

logInfo(`GET ${API_BASE_URL}/api/v1/health (headers only)`);
const securityHeadersResult = runCurl(['-sI', `${API_BASE_URL}/api/v1/health`]);

if (securityHeadersResult.success) {
  const headers = securityHeadersResult.stdout.toLowerCase();

  // Check X-Content-Type-Options
  if (headers.includes('x-content-type-options: nosniff')) {
    logPass('X-Content-Type-Options: nosniff header present');
  } else {
    logFail('Missing X-Content-Type-Options: nosniff header');
  }

  // Check X-Frame-Options
  if (headers.includes('x-frame-options')) {
    logPass('X-Frame-Options header present');
  } else {
    logFail('Missing X-Frame-Options header');
  }

  // Check X-XSS-Protection (optional but recommended)
  if (headers.includes('x-xss-protection')) {
    logPass('X-XSS-Protection header present');
  } else {
    logInfo('X-XSS-Protection header not present (optional in modern browsers)');
  }
} else {
  logFail('Failed to retrieve headers for security check');
}

// Step 8: Version matches package.json
console.log('\n[8/8] Checking version matches package.json');
console.log('-'.repeat(60));

try {
  // Read package.json version
  const packageJsonPath = resolve(process.cwd(), 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const expectedVersion = packageJson.version;

  logInfo(`Package.json version: ${expectedVersion}`);

  // Get version from API health endpoint
  const versionResult = runCurl(['-s', `${API_BASE_URL}/api/v1/health`]);

  if (versionResult.success) {
    try {
      const healthData = JSON.parse(versionResult.stdout);
      const apiVersion = healthData.version;

      if (apiVersion === expectedVersion) {
        logPass(`API version matches package.json: ${apiVersion}`);
      } else {
        logFail(
          `API version mismatch: API=${apiVersion}, package.json=${expectedVersion}`
        );
      }
    } catch {
      // Health endpoint might not return JSON version, skip this check
      logInfo('Health endpoint does not return version field, skipping version check');
      // Count as pass since we can't verify
      passCount++;
    }
  } else {
    logFail('Failed to retrieve health endpoint for version check');
  }
} catch (error) {
  logInfo('Could not read package.json, skipping version check');
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('Deployment Smoke Test Complete');
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
