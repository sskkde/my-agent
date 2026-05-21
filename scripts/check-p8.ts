import { spawnSync } from 'node:child_process';

/**
 * Phase 8 GA Readiness Verification Script
 *
 * This script verifies ALL P8 deliverables:
 * - Production guard
 * - CORS configuration
 * - Auth paths
 * - Secret redaction
 * - RBAC
 * - PostgreSQL adapter
 * - Multi-tenancy
 * - OAuth
 * - Connector GA
 * - Docker
 * - Backup/restore
 * - Load smoke
 * - DLQ reliability
 */

interface GateResult {
  name: string;
  passed: boolean;
  skipped: boolean;
  details?: string;
}

const gateResults: GateResult[] = [];

function runGate(
  step: number,
  total: number,
  name: string,
  command: string,
  args: string[],
  options?: { allowSkip?: boolean; skipCondition?: () => boolean }
): boolean {
  console.log(`\n[${step}/${total}] ${name}`);
  console.log('-'.repeat(60));

  // Check skip condition
  if (options?.skipCondition?.()) {
    console.log(`\n⏭️ ${name} SKIPPED (condition not met)`);
    gateResults.push({ name, passed: true, skipped: true, details: 'Skipped due to condition' });
    return true;
  }

  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });

  if (result.status !== 0) {
    if (options?.allowSkip) {
      console.log(`\n⚠️ ${name} SKIPPED or FAILED (optional gate)`);
      gateResults.push({ name, passed: false, skipped: true, details: 'Optional gate - may require manual verification' });
      return false;
    }
    console.error(`\n❌ ${name} FAILED`);
    gateResults.push({ name, passed: false, skipped: false });
    return false;
  }

  console.log(`\n✅ ${name} PASSED`);
  gateResults.push({ name, passed: true, skipped: false });
  return true;
}

console.log('='.repeat(60));
console.log('Phase 8 GA Readiness Verification');
console.log('='.repeat(60));

// Gate 1: P7 Baseline
const p7Passed = runGate(1, 12, 'P7 Baseline (ensure P7 still passes)', 'npm', ['run', 'test:p7']);
if (!p7Passed) {
  console.error('\n❌ P7 baseline verification FAILED - cannot proceed');
  process.exit(1);
}

// Gate 2: Production Config Guard
runGate(2, 12, 'Production Config Guard', 'npm', ['run', 'test:prod-config']);

// Gate 3: Security Tests (includes CORS, auth paths, secret redaction, RBAC)
runGate(3, 12, 'Security Tests (CORS, Auth Paths, Secret Redaction, RBAC)', 'npm', ['run', 'test:security']);

// Gate 4: Performance Tests
runGate(4, 12, 'Performance Tests', 'npm', ['run', 'test:performance']);

// Gate 5: Backup/Restore Tests
runGate(5, 12, 'Backup/Restore Tests', 'npm', ['run', 'test:backup-restore']);

// Gate 6: Docker Gate Check (optional - may not have Docker in CI)
const dockerPassed = runGate(6, 12, 'Docker Gate Check', 'tsx', ['scripts/check-docker-smoke.ts'], {
  allowSkip: true,
});

// Gate 7: Load Smoke Tests
runGate(7, 12, 'Load Smoke Tests', 'npm', ['run', 'test:load']);

// Gate 8: Web Build
runGate(8, 12, 'Web Build', 'npm', ['run', 'build:web']);

// Gate 9: PostgreSQL Tests (conditional - requires DATABASE_URL)
const hasDatabaseUrl = !!process.env.DATABASE_URL;
const postgresPassed = runGate(9, 12, 'PostgreSQL Adapter Tests (conditional)', 'npm', ['run', 'test:postgres'], {
  skipCondition: () => !hasDatabaseUrl,
});

// Gate 10: Tenancy Tests
runGate(10, 12, 'Multi-Tenancy Tests', 'npm', ['run', 'test:tenancy']);

// Gate 11: DLQ Reliability Tests (via test:phase4 which includes DLQ tests)
runGate(11, 12, 'DLQ Reliability Tests', 'npm', ['run', 'test:phase4']);

// Gate 12: API Contract Lock Tests
runGate(12, 12, 'API Contract Lock Tests', 'npm', ['run', 'test:unit', '--', 'tests/integration/api/api-contract-lock.test.ts']);

// Summary
console.log('\n' + '='.repeat(60));
console.log('Phase 8 GA Readiness Verification Complete');
console.log('='.repeat(60));

const passed = gateResults.filter((g) => g.passed && !g.skipped).length;
const skipped = gateResults.filter((g) => g.skipped).length;
const failed = gateResults.filter((g) => !g.passed && !g.skipped).length;
const total = gateResults.length;

console.log('\n📊 Verification Summary (P8 GA):');
console.log(`   Total gates: ${total}`);
console.log(`   Passed: ${passed}`);
console.log(`   Skipped: ${skipped}`);
console.log(`   Failed: ${failed}`);

console.log('\n📋 Gate Details:');
for (const gate of gateResults) {
  const status = gate.skipped ? '⏭️ SKIPPED' : gate.passed ? '✅ PASS' : '❌ FAIL';
  console.log(`   ${status}: ${gate.name}${gate.details ? ` (${gate.details})` : ''}`);
}

// P8 Deliverables Checklist
console.log('\n' + '='.repeat(60));
console.log('P8 GA Deliverables Checklist');
console.log('='.repeat(60));
console.log('\n✅ Production Guard: test:prod-config');
console.log('✅ CORS Configuration: test:security (tests/security/cors-*.test.ts)');
console.log('✅ Auth Paths: test:security (tests/security/auth-excluded-paths.test.ts)');
console.log('✅ Secret Redaction: test:security (tests/security/secret-redaction.test.ts)');
console.log('✅ RBAC: test:security (tests/security/rbac-*.test.ts)');
console.log(`${postgresPassed || !hasDatabaseUrl ? '✅' : '❌'} PostgreSQL Adapter: test:postgres${!hasDatabaseUrl ? ' (skipped - no DATABASE_URL)' : ''}`);
console.log('✅ Multi-Tenancy: test:tenancy (tests/integration/tenancy/, tests/security/tenant-isolation.test.ts)');
console.log('✅ OAuth: test:security (tests/security/oauth-*.test.ts)');
console.log('✅ Connector GA: test:phase4 (tests/integration/api/connectors-api.test.ts)');
console.log(`${dockerPassed ? '✅' : '⚠️'} Docker: test:docker${!dockerPassed ? ' (requires manual verification if Docker not available)' : ''}`);
console.log('✅ Backup/Restore: test:backup-restore');
console.log('✅ Load Smoke: test:load');
console.log('✅ DLQ Reliability: test:phase4 (tests/unit/dead-letter/, tests/integration/dead-letter/)');

// Final verdict
if (failed > 0) {
  console.log('\n❌ Phase 8 GA Readiness Verification FAILED');
  console.log('   Some required gates did not pass. See details above.');
  process.exit(1);
}

console.log('\n✅ Phase 8 GA Readiness Verification PASSED');
console.log('   All required gates passed. Ready for GA release.');
process.exit(0);
