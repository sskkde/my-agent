# Phase 8 Release Checklist

> Created: 2026-05-21
> Version: v0.8.0-ga-candidate

---

## 1. Pre-Release Verification

### 1.1 Code Quality Gates

| Check | Command | Status |
|-------|---------|--------|
| TypeScript Check | `npm run typecheck` | ⬜ Pending |
| Lint Pass | `npm run lint` | ⬜ Pending |
| Unit Tests | `npm run test:unit` | ⬜ Pending |
| Integration Tests | `npm run test:integration` | ⬜ Pending |
| E2E Tests | `npm run test:e2e` | ⬜ Pending |
| Web Tests | `npm --prefix web test` | ⬜ Pending |
| Web Build | `npm --prefix web run build` | ⬜ Pending |

### 1.2 P8-Specific Gates

| Check | Command | Status |
|-------|---------|--------|
| P7 Regression | `npm run test:p7` | ⬜ Pending |
| P8 Verification | `npm run test:p8` | ⬜ Pending |
| Production Config | `npm run test:prod-config` | ⬜ Pending |
| Security Tests | `npm run test:security` | ⬜ Pending |
| Tenancy Tests | `npm run test:tenancy` | ⬜ Pending |
| Backup/Restore | `npm run test:backup-restore` | ⬜ Pending |
| Load Smoke | `npm run test:load` | ⬜ Pending |
| PostgreSQL Tests | `npm run test:postgres` | ⬜ Pending (conditional) |

---

## 2. Version Verification

### 2.1 Version Consistency

| File | Expected Value | Status |
|------|----------------|--------|
| package.json | `"version": "0.8.0-ga-candidate"` | ⬜ Pending |
| src/api/server.ts | `0.8.0-ga-candidate` | ⬜ Pending |
| docs/api/openapi.yaml | `version: 0.8.0-ga-candidate` | ⬜ Pending |
| OTLP Resource | `service.version: 0.8.0-ga-candidate` | ⬜ Pending |
| Prometheus Metrics | `app_version{version="0.8.0-ga-candidate"}` | ⬜ Pending |

### 2.2 Git Tag

| Action | Command | Status |
|--------|---------|--------|
| Create Tag | `git tag -a v0.8.0-ga-candidate -m "Phase 8 GA Candidate"` | ⬜ Pending |
| Push Tag | `git push origin v0.8.0-ga-candidate` | ⬜ Pending |

---

## 3. Security Verification

### 3.1 Production Guard

| Check | Status |
|-------|--------|
| APP_SECRET_KEY validation | ⬜ Pending |
| ALLOWED_ORIGINS no wildcard | ⬜ Pending |
| At least one auth enabled | ⬜ Pending |
| DATABASE_URL or DATABASE_PATH | ⬜ Pending |
| BACKUP_DIR required | ⬜ Pending |
| PUBLIC_BASE_URL required | ⬜ Pending |
| COOKIE_SECURE true in prod | ⬜ Pending |
| Placeholder detection | ⬜ Pending |

### 3.2 CORS Configuration

| Check | Status |
|-------|--------|
| Production allowlist enforced | ⬜ Pending |
| No wildcard origin in prod | ⬜ Pending |
| Preflight handling correct | ⬜ Pending |

### 3.3 Auth Configuration

| Check | Status |
|-------|--------|
| Auth excluded paths ≤ 25 | ⬜ Pending |
| All business routes require auth | ⬜ Pending |
| API key prefix (ak_) works | ⬜ Pending |
| Session auth works | ⬜ Pending |

### 3.4 Secret Protection

| Check | Status |
|-------|--------|
| API keys redacted in responses | ⬜ Pending |
| Provider keys not exposed | ⬜ Pending |
| OAuth tokens encrypted | ⬜ Pending |
| Error messages sanitized | ⬜ Pending |

---

## 4. Database Verification

### 4.1 SQLite Mode

| Check | Status |
|-------|--------|
| All migrations apply | ⬜ Pending |
| All stores functional | ⬜ Pending |
| WAL mode enabled | ⬜ Pending |
| Backup works | ⬜ Pending |
| Restore works | ⬜ Pending |

### 4.2 PostgreSQL Mode (Optional)

| Check | Status |
|-------|--------|
| Connection with DATABASE_URL | ⬜ Pending (if PG enabled) |
| All migrations apply | ⬜ Pending (if PG enabled) |
| CRUD operations work | ⬜ Pending (if PG enabled) |
| Connection pool healthy | ⬜ Pending (if PG enabled) |
| Pool metrics exposed | ⬜ Pending (if PG enabled) |

---

## 5. Multi-tenant Verification

### 5.1 Tenant Isolation

| Check | Status |
|-------|--------|
| Cross-tenant session access denied | ⬜ Pending |
| Cross-tenant workflow access denied | ⬜ Pending |
| Cross-tenant connector access denied | ⬜ Pending |
| Cross-tenant API key access denied | ⬜ Pending |
| Default tenant mode works | ⬜ Pending |

### 5.2 Organization API

| Check | Status |
|-------|--------|
| Admin can create organization | ⬜ Pending |
| Admin can add members | ⬜ Pending |
| User cannot create organization | ⬜ Pending |
| Member roles work correctly | ⬜ Pending |

---

## 6. Connector Verification

### 6.1 GA Connectors

| Connector | GA Contract Tests | Documentation | Status |
|-----------|-------------------|---------------|--------|
| GitHub | ⬜ Pending | ⬜ Pending | ⬜ |
| Google Calendar | ⬜ Pending | ⬜ Pending | ⬜ |
| Google Contacts | ⬜ Pending | ⬜ Pending | ⬜ |
| Docs | ⬜ Pending | ⬜ Pending | ⬜ |
| Web Search | ⬜ Pending | ⬜ Pending | ⬜ |
| Generic HTTP | ⬜ Pending | ⬜ Pending | ⬜ |

### 6.2 OAuth Flow

| Check | Status |
|-------|--------|
| Authorize URL generation | ⬜ Pending |
| Callback token exchange | ⬜ Pending |
| Token refresh | ⬜ Pending |
| Token revoke | ⬜ Pending |
| State validation | ⬜ Pending |
| PKCE verification | ⬜ Pending |

---

## 7. Deployment Verification

### 7.1 Docker

| Check | Command | Status |
|-------|---------|--------|
| API image builds | `docker build -t agent-api .` | ⬜ Pending |
| Web image builds | `docker build -t agent-web ./web` | ⬜ Pending |
| Compose up | `docker compose up -d` | ⬜ Pending |
| Health check | `curl localhost:3003/api/v1/health` | ⬜ Pending |
| Production compose | `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` | ⬜ Pending |

### 7.2 Health Endpoints

| Endpoint | Expected | Status |
|----------|----------|--------|
| `/api/v1/health` | `{status: "healthy"}` | ⬜ Pending |
| `/api/v1/health/ready` | `{status: "ready"}` | ⬜ Pending |
| `/api/v1/metrics` | Prometheus format | ⬜ Pending |

---

## 8. Performance Verification

### 8.1 Latency Thresholds

| Endpoint | p95 Target | Measured | Status |
|----------|------------|----------|--------|
| /api/v1/health | < 100ms | ___ ms | ⬜ Pending |
| /api/v1/sessions | < 500ms | ___ ms | ⬜ Pending |
| /api/v1/observability/runs | < 1000ms | ___ ms | ⬜ Pending |
| /api/v1/audit | < 1500ms | ___ ms | ⬜ Pending |

### 8.2 Load Tests

| Scenario | Target | Status |
|----------|--------|--------|
| 1000 sessions list | p95 < 500ms | ⬜ Pending |
| 10000 messages query | Complete | ⬜ Pending |
| 20 concurrent reads | No failures | ⬜ Pending |
| 5 concurrent writes | No failures | ⬜ Pending |

---

## 9. Documentation Verification

### 9.1 Release Documentation

| Document | Status |
|----------|--------|
| RELEASE_NOTES_v0.8.0-ga-candidate.md | ⬜ Pending |
| MIGRATION_GUIDE_v0.7_to_v0.8.md | ⬜ Pending |
| GA_READINESS_CHECKLIST.md | ⬜ Pending |
| PHASE8_BASELINE_REPORT.md | ✅ Complete |
| PHASE8_EXECUTION_REPORT.md | ✅ Complete |
| PHASE8_RELEASE_CHECKLIST.md | ✅ Complete (this doc) |

### 9.2 Architecture Documentation

| Document | Status |
|----------|--------|
| ARCHITECTURE_TEST_MATRIX.md | ⬜ Pending (update) |
| production-security-model.md | ⬜ Pending |
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
| lint | ⬜ Pending |
| typecheck | ⬜ Pending |
| test:unit | ⬜ Pending |
| test:integration | ⬜ Pending |
| test:e2e | ⬜ Pending |
| test:security | ⬜ Pending |
| test:tenancy | ⬜ Pending |
| test:postgres (conditional) | ⬜ Pending |

### 10.2 Required Checks

All required CI checks must pass before release:
- [ ] All lint issues resolved
- [ ] All type errors resolved
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] All E2E tests pass
- [ ] All security tests pass

---

## 11. Post-Release Verification

### 11.1 Smoke Tests

After deployment to staging/production:

| Check | Command | Status |
|-------|---------|--------|
| Health check | `curl $API_URL/api/v1/health` | ⬜ Pending |
| Ready check | `curl $API_URL/api/v1/health/ready` | ⬜ Pending |
| Metrics check | `curl $API_URL/api/v1/metrics` | ⬜ Pending |
| OpenAPI docs | `curl $API_URL/api/v1/docs/json` | ⬜ Pending |
| Web UI loads | Browser check | ⬜ Pending |
| Login works | Manual test | ⬜ Pending |

### 11.2 Monitoring

| Check | Status |
|-------|--------|
| Grafana dashboards loaded | ⬜ Pending |
| Alerts configured | ⬜ Pending |
| SLO tracking active | ⬜ Pending |
| Log aggregation working | ⬜ Pending |

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

**Release Status**: Pending verification
**Target Release Date**: TBD
**Release Manager**: TBD
