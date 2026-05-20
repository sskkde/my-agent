import { spawnSync } from 'node:child_process';

console.log('='.repeat(60));
console.log('Phase 7 Release Verification');
console.log('='.repeat(60));

console.log('\n[1/8] P6 Baseline (ensure P6 still passes)');
console.log('-'.repeat(60));
const p6Result = spawnSync('npm', ['run', 'test:p6'], { stdio: 'inherit', shell: true });
if (p6Result.status !== 0) {
  console.error('\n❌ P6 baseline verification FAILED');
  process.exit(p6Result.status ?? 1);
}
console.log('\n✅ P6 baseline verification PASSED');

console.log('\n[2/8] TypeScript Type Check');
console.log('-'.repeat(60));
const typecheckResult = spawnSync('npm', ['run', 'typecheck'], { stdio: 'inherit', shell: true });
if (typecheckResult.status !== 0) {
  console.error('\n❌ TypeScript type check FAILED');
  process.exit(typecheckResult.status ?? 1);
}
console.log('\n✅ TypeScript type check PASSED');

console.log('\n[3/8] ESLint');
console.log('-'.repeat(60));
const lintResult = spawnSync('npm', ['run', 'lint'], { stdio: 'inherit', shell: true });
if (lintResult.status !== 0) {
  console.error('\n❌ ESLint FAILED');
  process.exit(lintResult.status ?? 1);
}
console.log('\n✅ ESLint PASSED');

console.log('\n[4/8] Unit Tests');
console.log('-'.repeat(60));
const unitResult = spawnSync('npm', ['run', 'test:unit'], { stdio: 'inherit', shell: true });
if (unitResult.status !== 0) {
  console.error('\n❌ Unit tests FAILED');
  process.exit(unitResult.status ?? 1);
}
console.log('\n✅ Unit tests PASSED');

console.log('\n[5/8] Integration Tests');
console.log('-'.repeat(60));
const integrationResult = spawnSync('npm', ['run', 'test:integration'], { stdio: 'inherit', shell: true });
if (integrationResult.status !== 0) {
  console.error('\n❌ Integration tests FAILED');
  process.exit(integrationResult.status ?? 1);
}
console.log('\n✅ Integration tests PASSED');

console.log('\n[6/8] Security Tests');
console.log('-'.repeat(60));
const securityResult = spawnSync('npm', ['run', 'test:unit', '--', 'tests/security/'], { stdio: 'inherit', shell: true });
if (securityResult.status !== 0) {
  console.error('\n❌ Security tests FAILED');
  process.exit(securityResult.status ?? 1);
}
console.log('\n✅ Security tests PASSED');

console.log('\n[7/8] Performance Tests');
console.log('-'.repeat(60));
const perfResult = spawnSync('npm', ['run', 'test:unit', '--', 'tests/performance/'], { stdio: 'inherit', shell: true });
if (perfResult.status !== 0) {
  console.error('\n❌ Performance tests FAILED');
  process.exit(perfResult.status ?? 1);
}
console.log('\n✅ Performance tests PASSED');

console.log('\n[8/8] Web Build');
console.log('-'.repeat(60));
const webBuildResult = spawnSync('npm', ['run', 'build:web'], { stdio: 'inherit', shell: true });
if (webBuildResult.status !== 0) {
  console.error('\n❌ Web build FAILED');
  process.exit(webBuildResult.status ?? 1);
}
console.log('\n✅ Web build PASSED');

console.log('\n' + '='.repeat(60));
console.log('Phase 7 Release Verification Complete');
console.log('='.repeat(60));
console.log('\n✅ All 8 checks passed');
console.log('\nVerification Summary (P7):');
console.log('  - P6 baseline: PASSING (baseline preserved)');
console.log('  - TypeScript: PASSING');
console.log('  - ESLint: PASSING');
console.log('  - Unit tests: PASSING');
console.log('  - Integration tests: PASSING');
console.log('  - Security tests: PASSING');
console.log('  - Performance tests: PASSING');
console.log('  - Web build: PASSING');
