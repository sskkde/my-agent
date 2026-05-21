# Phase 8 Release Checklist

> Created: 2026-05-21
> Version: v0.8.0-ga-candidate

---

## 1. Pre-Release Verification

### 1.1 Code Quality Gates

| Check | Command | Status |
|-------|---------|--------|
| TypeScript Check | `npm run typecheck` | ✅ Passed |
| Lint Pass | `npm run lint` | ✅ Passed |
| Unit Tests | `npm run test:unit` | ✅ Passed |
| Integration Tests | `npm run test:integration` | ✅ Passed |
| E2E Tests | `npm run test:e2e` | ✅ Passed |
| Web Tests | `npm --prefix web test` | ✅ Passed |
| Web Build | `npm --prefix web run build` | ✅ Passed |

### 1.2 P8-Specific Gates

| Check | Command | Status |
|-------|---------|--------|
| P7 Regression | `npm run test:p7` | ✅ Passed |
| P8 Verification | `npm run test:p8` | ✅ Passed |
| Production Config | `npm run test:prod-config` | ✅ Passed |
| Security Tests | `npm run test:security` | ✅ Passed |
| Tenancy Tests | `npm run test:tenancy` | ✅ Passed |
| Backup/Restore | `npm run test:backup-restore` | ✅ Passed |
| Load Smoke | `npm run test:load` | ✅ Passed |
| PostgreSQL Tests | `npm run test:postgres` | ⏭️ Conditional, skipped when DATABASE_URL is not configured; adapter tests available |

---

## 2. Version Verification

### 2.1 Version Consistency

| File | Expected Value | Status |
|------|----------------|--------|
| package.json | `"version": "0.8.0-ga-candidate"` | ✅ Complete |
| src/api/server.ts | `0.8.0-ga-candidate` | ✅ Complete |
| docs/api/openapi.yaml | `version: 0.8.0-ga-candidate` | ✅ Complete |
| OTLP Resource | `service.version: 0.8.0-ga-candidate` | ✅ Complete |
| Prometheus Metrics | `app_version{version="0.8.0-ga-candidate"}` | ✅ Complete |

### 2.2 Git Tag

| Action | Command | Status |
|--------|---------|--------|
| Create Tag | `git tag -a v0.8.0-ga-candidate -m "Phase 8 GA Candidate"` | ✅ Complete |
| Push Tag | `git push origin v0.8.0-ga-candidate` | ✅ Complete |

---

## 3. Security Verification

### 3.1 Production Guard

| Check | Status |
|-------|--------|
| APP_SECRET_KEY validation | ✅ Passed (automated test) |
| ALLOWED_ORIGINS no wildcard | ✅ Passed (automated test) |
| At least one auth enabled | ✅ Passed (automated test) |
| DATABASE_URL or DATABASE_PATH | ✅ Passed (automated test) |
| BACKUP_DIR required | ✅ Passed (automated test) |
| PUBLIC_BASE_URL required | ✅ Passed (automated test) |
| COOKIE_SECURE true in prod | ✅ Passed (automated test) |
| Placeholder detection | ✅ Passed (automated test) |

### 3.2 CORS Configuration

| Check | Status |
|-------|--------|
| Production allowlist enforced | ✅ Passed |
| No wildcard origin in prod | ✅ Passed |
| Preflight handling correct | ✅ Passed |

### 3.3 Auth Configuration

| Check | Status |
|-------|--------|
| Auth excluded paths ≤ 25 | ✅ Passed (22 paths) |
| All business routes require auth | ✅ Passed |
| API key prefix (ak_) works | ✅ Passed |
| Session auth works | ✅ Passed |

### 3.4 Secret Protection

| Check | Status |
|-------|--------|
| API keys redacted in responses | ✅ Passed |
| Provider keys not exposed | ✅ Passed |
| OAuth tokens encrypted | ✅ Passed |
| Error messages sanitized | ✅ Passed |

---

## 4. Database Verification

### 4.1 SQLite Mode

| Check | Status |
|-------|--------|
| All migrations apply | ✅ Passed |
| All stores functional | ✅ Passed |
| WAL mode enabled | ✅ Passed |
| Backup works | ✅ Passed |
| Restore works | ✅ Passed |

### 4.2 PostgreSQL Mode (Optional)

| Check | Status |
|-------|--------|
| Connection with DATABASE_URL | ⏭️ Conditional, requires DATABASE_URL |
| All migrations apply | ⏭️ Conditional, requires DATABASE_URL |
| CRUD operations work | ⏭️ Conditional, requires DATABASE_URL |
| Connection pool healthy | ⏭️ Conditional, requires DATABASE_URL |
| Pool metrics exposed | ⏭️ Conditional, requires DATABASE_URL |

---

## 5. Multi-tenant Verification

### 5.1 Tenant Isolation

| Check | Status |
|-------|--------|
| Cross-tenant session access denied | ✅ Passed |
| Cross-tenant workflow access denied | ✅ Passed |
| Cross-tenant connector access denied | ✅ Passed |
| Cross-tenant API key access denied | ✅ Passed |
| Default tenant mode works | ✅ Passed |

### 5.2 Organization API

| Check | Status |
|-------|--------|
| Admin can create organization | ✅ Passed |
| Admin can add members | ✅ Passed |
| User cannot create organization | ✅ Passed |
| Member roles work correctly | ✅ Passed |

---

## 6. Connector Verification

### 6.1 GA Connectors

| Connector | GA Contract Tests | Documentation | Status |
|-----------|-------------------|---------------|--------|
| GitHub | ✅ Passed | ✅ Complete | ✅ |
| Google Calendar | ✅ Passed | ✅ Complete | ✅ |
| Google Contacts | ✅ Passed | ✅ Complete | ✅ |
| Docs | ✅ Passed | ✅ Complete | ✅ |
| Web Search | ✅ Passed | ✅ Complete | ✅ |
| Generic HTTP | ✅ Passed | ✅ Complete | ✅ |

### 6.2 OAuth Flow

| Check | Status |
|-------|--------|
| Authorize URL generation | ✅ Passed |
| Callback token exchange | ✅ Passed |
| Token refresh | ✅ Passed |
| Token revoke | ✅ Passed |
| State validation | ✅ Passed |
| PKCE verification | ✅ Passed |

---

## 7. Deployment Verification

### 7.1 Docker

| Check | Command | Status |
|-------|---------|--------|
| API image builds | `docker build -t agent-api .` | ⚠️ Manual, requires Docker runtime |
| Web image builds | `docker build -t agent-web ./web` | ⚠️ Manual, requires Docker runtime |
| Compose up | `docker compose up -d` | ⚠️ Manual, requires Docker runtime |
| Health check | `curl localhost:3003/api/v1/health` | ⚠️ Manual, requires Docker runtime |
| Production compose | `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` | ⚠️ Manual, requires Docker runtime |

### 7.2 Health Endpoints

| Endpoint | Expected | Status |
|----------|----------|--------|
| `/api/v1/health` | `{status: "healthy"}` | ✅ Passed (automated test) |
| `/api/v1/health/ready` | `{status: "ready"}` | ✅ Passed (automated test) |
| `/api/v1/metrics` | Prometheus format | ✅ Passed (automated test) |

---

## 8. Performance Verification

### 8.1 Latency Thresholds

| Endpoint | p95 Target | Measured | Status |
|----------|------------|----------|--------|
| /api/v1/health | < 100ms | < 100ms | ✅ Passed |
| /api/v1/sessions | < 500ms | < 500ms | ✅ Passed |
| /api/v1/observability/runs | < 1000ms | < 1000ms | ✅ Passed |
| /api/v1/audit | < 1500ms | < 1500ms | ✅ Passed |

### 8.2 Load Tests

| Scenario | Target | Status |
|----------|--------|--------|
| 1000 sessions list | p95 < 500ms | ✅ Passed |
| 10000 messages query | Complete | ✅ Passed |
| 20 concurrent reads | No failures | ✅ Passed |
| 5 concurrent writes | No failures | ✅ Passed |

---

## 9. Documentation Verification

### 9.1 Release Documentation

| Document | Status |
|----------|--------|
| RELEASE_NOTES_v0.8.0-ga-candidate.md | ✅ Complete |
| MIGRATION_GUIDE_v0.7_to_v0.8.md | ✅ Complete |
| GA_READINESS_CHECKLIST.md | ✅ Complete |
| PHASE8_BASELINE_REPORT.md | ✅ Complete |
| PHASE8_EXECUTION_REPORT.md | ✅ Complete |
| PHASE8_RELEASE_CHECKLIST.md | ✅ Complete (this doc) |

### 9.2 Architecture Documentation

| Document | Status |
|----------|--------|
| ARCHITECTURE_TEST_MATRIX.md | ✅ Complete (updated to Phase 8) |
| production-security-model.md | ✅ Complete |
| known-limitations.md | ✅ Exists |
| postgres.md | ✅ Exists |

### 9.3 Observability Documentation

| Document | Status |
|----------|--------|
| slo-sli.md | ✅ Complete |
| incident-runbook.md | ✅ Complete |
| dashboard-guide.md | ✅ Complete |
| metrics.md | ✅ Complete |
| alerting-runbook.md | ✅ Complete |

---

## 10. CI Verification

### 10.1 CI Jobs

| Job | Status |
|-----|--------|
| lint | ✅ Passed |
| typecheck | ✅ Passed |
| test:unit | ✅ Passed |
| test:integration | ✅ Passed |
| test:e2e | ✅ Passed |
| test:security | ✅ Passed |
| test:tenancy | ✅ Passed |
| test:postgres (conditional) | ⏭️ Conditional, skipped when DATABASE_URL not configured |

### 10.2 Required Checks

All required CI checks must pass before release:
- [x] All lint issues resolved
- [x] All type errors resolved
- [x] All unit tests pass
- [x] All integration tests pass
- [x] All E2E tests pass
- [x] All security tests pass

---

## 11. Post-Release Verification

### 11.1 Smoke Tests

After deployment to staging/production:

| Check | Command | Status |
|-------|---------|--------|
| Health check | `curl $API_URL/api/v1/health` | ⚠️ Manual, deployment-time |
| Ready check | `curl $API_URL/api/v1/health/ready` | ⚠️ Manual, deployment-time |
| Metrics check | `curl $API_URL/api/v1/metrics` | ⚠️ Manual, deployment-time |
| OpenAPI docs | `curl $API_URL/api/v1/docs/json` | ⚠️ Manual, deployment-time |
| Web UI loads | Browser check | ⚠️ Manual, deployment-time |
| Login works | Manual test | ⚠️ Manual, deployment-time |

### 11.2 Monitoring

| Check | Status |
|-------|--------|
| Grafana dashboards loaded | ⚠️ Manual, deployment-time |
| Alerts configured | ⚠️ Manual, deployment-time |
| SLO tracking active | ⚠️ Manual, deployment-time |
| Log aggregation working | ⚠️ Manual, deployment-time |

---

## 12. Rollback Plan

If issues are discovered post-release:

1. **Identify Issue**: Review logs, metrics, alerts
2. **Assess Severity**: P0 (critical) vs P1 (high) vs P2 (medium)
3. **Decision**: Rollback or hotfix
4. **Rollback Steps**:
   ```bash
   git checkout v0.7.0-rc.1
   docker compose down
   docker compose up -d
   # Restore database from backup if needed
   npm run db:restore -- --file backup-YYYYMMDD.db
   ```
5. **Verify**: Run smoke tests on rolled-back version
6. **Document**: Create incident report

See `docs/release/ROLLBACK_RUNBOOK.md` for detailed rollback procedures.

---

## 13. Sign-Off

### 13.1 Technical Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Lead Developer | | | |
| QA Lead | | | |
| Security Lead | | | |
| DevOps Lead | | | |

### 13.2 Release Approval

| Approver | Date | Decision |
|----------|------|----------|
| | | ⬜ Approved / ⬜ Rejected |

---

**Release Status**: P8 Complete / GA Candidate Ready
**Target Release Date**: 2026-05-21
**Release Manager**: Sisyphus

> Deployment-time checks are intentionally marked as ⚠️ Manual and must be executed before production rollout.
> PostgreSQL checks are marked as ⏭️ Conditional and require DATABASE_URL to be configured.
