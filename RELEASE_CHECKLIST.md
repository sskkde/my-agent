# Release Checklist — Phase 4 Automation Product Beta

## Pre-release

### Code Quality

- [ ] TypeScript check passes: `npm run typecheck`
- [ ] Backend tests pass: `npm test` (≥4169 tests)
- [ ] Frontend tests pass: `npm --prefix web test` (≥634 tests)
- [ ] Frontend build succeeds: `npm --prefix web run build`

### Database

- [ ] Database migrations apply cleanly: `npm run db:migrate`
- [ ] Database health check passes: `npm run db:health`

### Phase 4 Specific

- [ ] Phase 4 tests pass: `npm run test:phase4`
- [ ] Architecture contract tests pass: `npx vitest run tests/architecture/`
- [ ] Architecture capability matrix reviewed and updated: `docs/architecture/ARCHITECTURE_TEST_MATRIX.md`
- [ ] Architecture gap closure tracking reviewed: every open row in `ARCHITECTURE_GAP_REPORT.md#51-gap-closure-tracking` has status plus closing PR/test reference
- [ ] E2E tests pass: `npm run test:e2e` (including flow-16)
- [ ] DLQ integration verified
- [ ] Connectors API responds correctly
- [ ] Observability console API returns data
- [ ] All three new Web UI tabs load correctly

### Security

- [ ] Replay preview has zero side effects (contract test verified)
- [ ] Connector write tools require approval
- [ ] No secrets exposed in API responses
- [ ] No secrets exposed in Web UI

## Release

- [ ] All tests green on CI
- [ ] Merge `feat/phase4-automation-product-beta` to `master`
- [ ] Tag release: `v0.4.0-phase4`
- [ ] Update version in `package.json`
- [ ] Push tags to remote

## Post-release

### Verification

- [ ] Docker build succeeds: `docker compose build`
- [ ] API server starts: `docker compose up -d api`
- [ ] API health endpoint responds: `curl http://localhost:3003/health`
- [ ] Web UI loads: `curl http://localhost:3002/`
- [ ] All Web UI tabs render:
  - [ ] Sessions
  - [ ] Approvals
  - [ ] Workflows
  - [ ] Triggers (NEW)
  - [ ] Connectors (NEW)
  - [ ] Observability (NEW)
  - [ ] Memory
  - [ ] Monitor

### Feature Smoke Tests

- [ ] Create a PlannerRun via chat
- [ ] Save PlannerRun as Workflow
- [ ] Run Workflow manually
- [ ] Create Schedule Trigger
- [ ] View trigger execution logs
- [ ] View connector list
- [ ] View connector detail
- [ ] View observability run list
- [ ] Open replay preview for completed run

### Documentation

- [ ] CHANGELOG.md updated
- [ ] README.md updated with Phase 4 features
- [ ] OpenAPI spec generated: `docs/api/openapi-phase4.yaml`
- [ ] Security documentation complete: `docs/security/permission-model.md`
- [ ] Demo script available: `docs/product/demo-script.md`

## Rollback Plan

If critical issues are found:

1. Revert merge commit on `master`
2. Delete tag `v0.4.0-phase4`
3. Re-tag previous stable version
4. Notify users via changelog update

## Known Limitations

- Connector marketplace not available (connectors are pre-configured)
- No OAuth flow for connector authentication (mock mode only)
- Replay preview is read-only (no editing capabilities)
- DLQ retry requires manual API call (no auto-retry)
