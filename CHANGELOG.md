# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v0.4.0-phase4] - 2026-05-12

### Added

#### Backend

- **DLQ Common Module**: Dead Letter Queue with SQLite store (`src/dead-letter/`)
  - `enqueue(module, eventId, reason)` for capturing failed events
  - `list({ module?, status? })` for filtering and viewing entries
  - `retry(eventId)` for re-dispatching failed events
  - `discard(eventId)` for marking entries as discarded (keeps audit trail)
  - Idempotency enforcement on duplicate event IDs
  - Integrated with webhook trigger delivery failures (after 3 retries)

- **Connectors API**: REST endpoints for connector management
  - `GET /api/connectors` — list all available connectors
  - `GET /api/connectors/:id` — get connector detail with manifest
  - `GET /api/connectors/:id/instances` — list connector instances
  - `PATCH /api/connectors/:id/instances/:iid/config` — update instance configuration

- **Observability Console API**: Endpoints for run inspection
  - `GET /api/observability/runs` — list runs with status filter
  - `GET /api/observability/runs/:runId/console` — aggregated timeline/audit/trace
  - `GET /api/observability/runs/:runId/replay-preview` — safe preview mode

#### Frontend

- **TriggersTab**: Schedule and webhook trigger management
  - Schedule triggers list with status toggle (active/paused)
  - Webhook triggers list with key display
  - Recent trigger execution log table

- **ConnectorsTab**: Connector management UI
  - Connector list view
  - Connector detail with manifest (tools, events, scopes)
  - Instance configuration editor

- **ObservabilityTab**: Run monitoring and replay
  - Run list (PlannerRun + WorkflowRun) with status filter
  - Timeline view with chronological events
  - Replay Preview button for completed/failed runs

#### API Productization

- **Response Envelope**: Standardized API response format
  - All new Phase 4 endpoints return `{ ok, data, requestId }`
  - Consistent error envelope with `{ ok: false, error, requestId }`

- **Request ID Middleware**: `x-request-id` header injection for tracing

- **OpenAPI Spec**: `docs/api/openapi-phase4.yaml` for Phase 4 endpoints

#### Testing

- **Architecture Contract Tests**
  - `workflow-trigger-connector-contract.test.ts` — verifies workflow actions go through Dispatcher, trigger runtime creates valid RuntimeActions, connector writes require approval
  - `replay-preview-safety-contract.test.ts` — ensures replay preview has zero side effects (no tool calls, no store writes, no HTTP requests, no trigger fires)

- **Phase 4 E2E Demo**: `flow-16-automation-beta-demo.test.ts`
  - 9-step automation flow covering complete Phase 4 feature set

- **CI Integration**
  - `npm run test:phase4` script for Phase 4 specific tests
  - Environment variables in `.env.example` for Phase 4 features

### Changed

- **Workflow Runtime**: Cancel cascade now properly cancels pending RuntimeActions
- **Memory**: Added audit trail on soft-delete operations
- **CI**: Added Phase 4 test scripts and environment variables

---

## [v0.3.0-phase3b] - 2026-05-11

### Added

- Planner beta with complex task planning
- Workflow UI editor with step management
- Memory extraction and retrieval APIs
- Provider configuration management

### Changed

- Improved LLM routing with fallback support
- Enhanced session management with SSE

---

## [v0.2.0-phase2] - 2026-04-XX

### Added

- Initial workflow runtime
- Trigger system (schedule, webhook)
- Connector framework with mock connectors

---

## [v0.1.0] - 2026-03-XX

### Added

- Initial release
- Basic agent platform with session management
- LLM provider support (OpenRouter, Ollama)
- Tool catalog and approval workflow
