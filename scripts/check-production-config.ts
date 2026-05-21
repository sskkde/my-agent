import { checkProductionConfig } from '../src/config/production-guard.js';

const result = checkProductionConfig();

if (result.ok) {
  if (process.env.NODE_ENV === 'production') {
    console.log('✅ Production configuration check PASSED');
  } else {
    console.log('ℹ️  Production configuration check skipped (NODE_ENV is not "production")');
  }
  process.exit(0);
}

console.error('❌ Production configuration check FAILED:\n');
for (const err of result.errors) {
  console.error(`  - ${err}`);
}
console.error(`\n${result.errors.length} error(s) found. Fix the above issues before deploying to production.`);
process.exit(1);
