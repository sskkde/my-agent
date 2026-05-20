# Phase 7 Release Checklist

## P7 Security Hardening Gate

- [x] Security headers middleware verified — tests/integration/api/security-headers.test.ts
- [x] API key auth complete test suite — tests/security/api-key-auth.test.ts
- [x] SSRF protection tests — tests/security/ssrf-protection.test.ts
- [x] Auth lifecycle fix (401 stops processing) — src/api/middleware/auth.ts, src/api/middleware/api-key-auth.ts

## P7 RBAC Full Coverage Gate

- [x] Route policy mapping — src/api/routes/route-policy.ts
- [x] All 25 route files have requirePermission — grep verified
- [x] RBAC integration tests pass — tests/integration/api/rbac-integration.test.ts

## P7 Docker Production Gate

- [x] API Dockerfile production-ready — Dockerfile
- [x] Web Dockerfile production-ready — web/Dockerfile
- [x] Docker Compose health checks — docker-compose.yml
- [x] Docker smoke check script — scripts/check-docker-smoke.ts

## P7 Performance Baseline Gate

- [x] API latency smoke tests — tests/performance/api-latency-smoke.test.ts
- [x] Performance baseline docs — docs/performance/baseline.md

## P7 API Contract Freeze Gate

- [x] Response envelope contract — tests/integration/api/response-envelope-contract.test.ts
- [x] Error format contract — tests/integration/api/error-format-contract.test.ts
- [x] Pagination contract — tests/integration/api/api-contract.test.ts
- [x] Rate limiting — tests/integration/api/rate-limit.test.ts

## P7 Release Documentation Gate

- [x] Release Notes — docs/release/RELEASE_NOTES_v0.7.0-rc.1.md
- [x] Rollback Runbook — docs/release/ROLLBACK_RUNBOOK.md
- [x] Production Readiness Checklist — docs/release/PRODUCTION_READINESS_CHECKLIST.md
- [x] Breaking Change Policy — docs/api/breaking-change-policy.md
- [x] OpenAPI spec updated — docs/api/openapi.yaml (version 0.7.0-rc.1)

## P7 Observability Documentation Gate

- [x] Metrics documentation — docs/observability/metrics.md
- [x] Alerting runbook — docs/observability/alerting-runbook.md
- [x] Audit retention policy — docs/observability/audit-retention.md

## P7 CI Stabilization Gate

- [x] npm registry fix (.npmrc) — .npmrc
- [x] Auth lifecycle fix — src/api/middleware/auth.ts, src/api/middleware/api-key-auth.ts
- [x] ESLint migration baseline — eslint.config.js
- [x] Vitest hook timeout — vitest.config.ts
- [x] Integration serial workers — package.json

## P7 Regression Gate

- [x] TypeScript check passed — npm run typecheck
- [x] ESLint passed — npm run lint
- [x] Unit tests passed — npm run test:unit
- [x] Integration tests passed — npm run test:integration
- [x] E2E tests passed — npm run test:e2e
- [x] Security tests passed — npm run test:unit -- tests/security/
- [x] Performance tests passed — npm run test:unit -- tests/performance/
- [x] Web build passed — npm run build:web
- [x] P7 verification passed — npm run test:p7
- [x] CI all jobs green — lint, security-tests, performance-tests, test, e2e-test

---

**Release Candidate Status**: v0.7.0-rc.1 ready for deployment
**Completion Date**: 2026-05-20
