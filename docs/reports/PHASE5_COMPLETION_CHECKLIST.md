# Phase 5 Completion Checklist

## P5 API Productization Gate

- [ ] API response envelope verified — `npm run test:api -- tests/integration/api/response-envelope-contract.test.ts` — response-envelope-contract.test.ts
- [ ] API error format verified — `npm run test:api -- tests/integration/api/error-format-contract.test.ts` — error-format-contract.test.ts
- [ ] API pagination/filtering verified — `npm run test:api -- tests/integration/api/pagination-contract.test.ts` — pagination-contract.test.ts
- [ ] API request id verified — `npm run test:api -- tests/integration/api/request-validation.test.ts` — request-validation.test.ts
- [ ] API rate limit verified — `npm run test:api -- tests/integration/api/rate-limit.test.ts` — rate-limit.test.ts
- [ ] API auth token verified or explicitly disabled for local dev — `npm run test:api -- tests/integration/api/auth-token.test.ts` — auth-token.test.ts
- [ ] API compression verified — `npm run test:api -- tests/integration/api/compression.test.ts` — compression.test.ts
- [ ] OpenAPI / Swagger verified — `npm run test:api -- tests/integration/api/swagger-ui.test.ts` — swagger-ui.test.ts
- [ ] Health / Readiness verified — `npm run test:api -- tests/integration/api/health-check.test.ts` — health-check.test.ts

## P5 Web Product Experience Gate

- [ ] Chat UI journey verified — `npm run test:web` — SessionConsoleTab.test.tsx
- [ ] Approval approve/reject UI verified — `npm run test:web -- ApprovalCard` — ApprovalCard.test.tsx
- [ ] Runs list/detail/cancel verified — `npm run test:web -- RunList` — RunList.test.tsx, RunDetailDrawer.test.tsx
- [ ] Timeline / Observability verified — `npm run test:web -- TimelineView` — TimelineView.test.tsx, ObservabilityTab.test.tsx
- [ ] Settings provider/model verified — `npm run test:web -- SettingsTab` — SettingsTab.test.tsx
- [ ] Workflows trigger/run history verified — `npm run test:web -- WorkflowsTab` — WorkflowsTab.test.tsx

## P5 E2E Product Journey Gate

- [ ] P5 product journey E2E verified — `npx vitest run tests/e2e/flow-17-p5-product-journey.test.ts` — flow-17-p5-product-journey.test.ts

## P5 Documentation Gate

- [ ] Demo script verified — docs/product/demo-script.md
- [ ] Admin guide updated — docs/product/admin-guide.md
- [ ] User guide updated — docs/product/user-guide.md
- [ ] OpenAPI spec updated — docs/api/openapi.yaml

## P5 Regression Gate

- [ ] TypeScript check passed — `npm run typecheck`
- [ ] API tests passed — `npm run test:api`
- [ ] Web tests passed — `npm run test:web`
- [ ] Web build passed — `npm run build:web`
- [ ] P5 unified test passed — `npm run test:p5`
