import { spawnSync } from 'node:child_process';

console.log('='.repeat(60));
console.log('Phase 6 Verification Script');
console.log('='.repeat(60));

console.log('\n[1/6] P5 Baseline Verification (ensure P5 still passes)');
console.log('-'.repeat(60));
const p5Result = spawnSync('npm', ['run', 'test:p5'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (p5Result.status !== 0) {
  console.error('\n❌ P5 baseline verification FAILED');
  process.exit(p5Result.status ?? 1);
}
console.log('\n✅ P5 baseline verification PASSED');

console.log('\n[2/6] TypeScript Type Check');
console.log('-'.repeat(60));
const typecheckResult = spawnSync('npm', ['run', 'typecheck'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (typecheckResult.status !== 0) {
  console.error('\n❌ TypeScript type check FAILED');
  process.exit(typecheckResult.status ?? 1);
}
console.log('\n✅ TypeScript type check PASSED');

console.log('\n[3/6] Unit Tests');
console.log('-'.repeat(60));
const unitResult = spawnSync('npm', ['run', 'test:unit'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (unitResult.status !== 0) {
  console.error('\n❌ Unit tests FAILED');
  process.exit(unitResult.status ?? 1);
}
console.log('\n✅ Unit tests PASSED');

console.log('\n[4/6] Integration Tests');
console.log('-'.repeat(60));
const integrationResult = spawnSync('npm', ['run', 'test:integration'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (integrationResult.status !== 0) {
  console.error('\n❌ Integration tests FAILED');
  process.exit(integrationResult.status ?? 1);
}
console.log('\n✅ Integration tests PASSED');

console.log('\n[5/6] E2E Tests');
console.log('-'.repeat(60));
const e2eResult = spawnSync('npm', ['run', 'test:e2e'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (e2eResult.status !== 0) {
  console.error('\n❌ E2E tests FAILED');
  process.exit(e2eResult.status ?? 1);
}
console.log('\n✅ E2E tests PASSED');

console.log('\n[6/6] Web Build');
console.log('-'.repeat(60));
const webBuildResult = spawnSync('npm', ['run', 'build:web'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (webBuildResult.status !== 0) {
  console.error('\n❌ Web build FAILED');
  process.exit(webBuildResult.status ?? 1);
}
console.log('\n✅ Web build PASSED');

console.log('\n' + '='.repeat(60));
console.log('P6 Specific Checks (skeleton)');
console.log('='.repeat(60));
console.log('\n[INFO] P6-specific test suites will be added here as they are developed.');
console.log('[INFO] Current baseline: P5 tests passing');

console.log('\n' + '='.repeat(60));
console.log('Phase 6 Verification Complete');
console.log('='.repeat(60));
console.log('\n✅ All checks passed');
console.log('\nBaseline Test Counts (P6):');
console.log('  - P5 tests: PASSING (baseline preserved)');
console.log('  - Unit tests: See output above');
console.log('  - Integration tests: See output above');
console.log('  - E2E tests: See output above');
console.log('  - Web build: SUCCESS');
