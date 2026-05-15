# Phase 6 Completion Checklist

## P6 Security & Access Control Gate

- [ ] RBAC types verified — `npm run test:unit -- tests/unit/permissions/rbac-types.test.ts`
- [ ] RBAC middleware verified — `npm run test:api -- tests/integration/api/rbac.test.ts`
- [ ] API key store verified — `npm run test:unit -- tests/unit/storage/api-key-store.test.ts`
- [ ] API key routes verified — `npm run test:api -- tests/integration/api/api-key.test.ts`
- [ ] API key auth middleware verified — `npm run test:api -- tests/integration/api/api-key-auth.test.ts`

## P6 API Versioning Gate

- [ ] V1 prefix utility verified — `npm run test:unit -- tests/unit/api/v1-prefix.test.ts`
- [ ] V1 route redirects verified — `npm run test:api -- tests/integration/api/v1-redirects.test.ts`
- [ ] Frontend API client uses /api/v1/ — `grep -r "API_BASE.*api/v1" web/src/api/`

## P6 Connectors Gate

- [ ] HTTP transport types verified — `npm run test:unit -- tests/unit/connectors/types/http-transport-types.test.ts`
- [ ] Base HTTP transport verified — `npm run test:unit -- tests/unit/connectors/transports/base-http-transport.test.ts`
- [ ] GitHub connector verified — `npm run test:api -- tests/integration/connectors/github.test.ts`
- [ ] Calendar connector verified — `npm run test:api -- tests/integration/connectors/calendar.test.ts`
- [ ] Contacts connector verified — `npm run test:api -- tests/integration/connectors/contacts.test.ts`
- [ ] Docs connector verified — `npm run test:api -- tests/integration/connectors/docs.test.ts`
- [ ] Web/Search connector verified — `npm run test:api -- tests/integration/connectors/web.test.ts`

## P6 Memory & Budget Gate

- [ ] Memory limit types verified — `npm run test:unit -- tests/unit/memory/types.test.ts`
- [ ] Budget manager verified — `npm run test:unit -- tests/unit/memory/budget-manager.test.ts`
- [ ] Budget store verified — `npm run test:unit -- tests/unit/storage/budget-store.test.ts`
- [ ] Memory cache layer verified — `npm run test:unit -- tests/unit/memory/cache.test.ts`

## P6 Observability Gate

- [ ] Prometheus exporter verified — `npm run test:unit -- tests/unit/observability/exporters/prometheus-exporter.test.ts`
- [ ] OTel trace exporter verified — `npm run test:unit -- tests/unit/observability/exporters/otel-trace-exporter.test.ts`
- [ ] Alerting system verified — `npm run test:api -- tests/integration/api/alerts.test.ts`
- [ ] Alert store verified — `npm run test:unit -- tests/unit/storage/alert-store.test.ts`

## P6 Frontend Gate

- [ ] Trigger create dialog verified — `npm run test:web -- TriggerCreateDialog`
- [ ] DLQ management UI verified — `npm run test:web -- DlqTab`
- [ ] Frontend typecheck passed — `npm --prefix web run typecheck`

## P6 Documentation Gate

- [ ] Admin guide updated with P6 sections — docs/product/admin-guide.md
- [ ] User guide updated with P6 sections — docs/product/user-guide.md
- [ ] Demo script updated with P6 paths — docs/product/demo-script.md
- [ ] P6 completion report created — docs/reports/PHASE6_COMPLETION_REPORT.md

## P6 Regression Gate

- [ ] TypeScript check passed — `npm run typecheck`
- [ ] Unit tests passed — `npm run test:unit`
- [ ] Integration tests passed — `npm run test:integration`
- [ ] E2E tests passed — `npm run test:e2e`
- [ ] Web tests passed — `npm run test:web`
- [ ] Web build passed — `npm run build:web`
- [ ] P6 unified test passed — `npm run test:p6`
