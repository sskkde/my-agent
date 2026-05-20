# Architecture Test Matrix

> **Purpose**: P0 requirements-to-test coverage mapping — maps golden paths to 5 test levels with specific test file references.
> **Status**: Live, reflects current test infrastructure as of 2026-05-20 (Phase 7 RC complete)
> **References**: `ARCHITECTURE_GAP_REPORT.md`, `.sisyphus/plans/p0-audit-report.md`, `docs/architecture/P0_SCOPE.md`

---

## Legend

| Marker | Meaning |
|--------|---------|
| ✅ | **Fully covered** — dedicated tests exist at this level with specific assertions for the golden path |
| ⚠️ | **Partially covered** — some coverage exists but gaps remain (e.g., indirect coverage, missing sub-scenarios) |
| ❌ | **Not covered** — no tests exist at this level for the golden path |

Each cell includes specific test file paths (relative from repository root) that provide coverage.

---

## P0 Golden Path × Test Level Matrix

| # | P0 Golden Path | Unit | Integration | E2E | State-Machine | Architecture | Web |
|---|---|---|---|---|---|---|---|
| **1** | **Direct Chat** — 简单对话，Foreground 直接路由回答 | ✅ `tests/unit/foreground/llm-router-contract.test.ts` `tests/unit/foreground/llm-router-guardrails.test.ts` | ✅ `tests/integration/foreground/foreground-agent.test.ts` | ✅ `tests/e2e/flow-1-chat.test.ts` | ✅ `tests/state-machine/transitions.test.ts` | ✅ `tests/architecture/direct-chat-contract.test.ts` | ⚠️ |
| **2** | **Planner-Run** — 复杂任务路由到 Planner，创建执行计划 | ⚠️ `tests/unit/shared/lifecycle-conformance.test.ts` (PlannerRun states only) | ✅ `tests/integration/planner/planner-runtime.test.ts` | ✅ `tests/e2e/flow-12-planner-complex-task.test.ts` | ✅ `tests/state-machine/transitions.test.ts` `tests/state-machine/states.test.ts` | ✅ `tests/architecture/planner-workflow-contract.test.ts` | ⚠️ |
| **3** | **Dispatch-Kernel** — Dispatcher → Agent Kernel 派发执行路径 | ⚠️ `tests/unit/shared/lifecycle-conformance.test.ts` (KernelRun states only) | ✅ `tests/integration/kernel/agent-kernel.test.ts` `tests/integration/dispatcher/runtime-dispatcher.test.ts` | ✅ `tests/e2e/full-flow-suite.test.ts` | ✅ `tests/state-machine/transitions.test.ts` | ✅ `tests/architecture/dispatch-kernel-contract.test.ts` | ⚠️ |
| **4** | **Read Tool + ResultRef** — 只读工具调用与 ToolResultReference | ✅ `tests/unit/tools/file-read.test.ts` `tests/unit/tools/tool-result-reference.test.ts` | ✅ `tests/integration/tools/tool-orchestrator.test.ts` `tests/integration/tools/large-result-reference.test.ts` | ✅ `tests/e2e/flow-13-read-tool-result-ref.test.ts` | ⚠️ `tests/unit/shared/lifecycle-conformance.test.ts` (ToolExecution states only) | ✅ `tests/architecture/tool-result-ref-contract.test.ts` | ⚠️ |
| **5** | **Write Tool Approval** — 写工具强制审批闭环 (approve/reject) | ⚠️ (no dedicated unit test for approval flow logic) | ✅ `tests/integration/permissions/permission-engine.test.ts` `tests/integration/approval/approval-resume.test.ts` | ✅ `tests/e2e/flow-3-write-approval.test.ts` | ⚠️ `tests/unit/shared/lifecycle-conformance.test.ts` (ApprovalRequest states only) | ✅ `tests/architecture/write-approval-contract.test.ts` | ⚠️ |
| **6** | **Status Query / Cancel** — 运行状态查询与取消操作 | ⚠️ `tests/unit/shared/cancellation.test.ts` (basic cancel primitives) | ✅ `tests/integration/recovery/cancellation.test.ts` `tests/integration/recovery/cancellation-cascade.test.ts` | ✅ `tests/e2e/flow-10-status-query.test.ts` `tests/e2e/flow-11-cancel-cascade.test.ts` | ⚠️ `tests/state-machine/transitions.test.ts` (cancel transitions only) | ✅ `tests/architecture/cancel-cascade-contract.test.ts` | ⚠️ |
| **7** | **Lifecycle + Audit** — 生命周期审计与全链路可观测性 | ✅ `tests/unit/shared/lifecycle-conformance.test.ts` | ✅ `tests/integration/observability/audit.test.ts` | ✅ `tests/e2e/observability-all-flows.test.ts` | ✅ `tests/state-machine/transitions.test.ts` | ✅ `tests/architecture/state-contracts.test.ts` | ⚠️ |
| **8** | **Restart + Recovery** — 服务重启恢复与故障容错 | ⚠️ `tests/unit/shared/runtime-error.test.ts` (error taxonomy only) | ✅ `tests/integration/hardening/startup-recovery.test.ts` | ⚠️ `tests/e2e/full-flow-suite.test.ts` (recovery scenarios exercised) | ✅ `tests/state-machine/recovery-transitions.test.ts` | ✅ `tests/architecture/state-contracts.test.ts` | ⚠️ |
| **9** | **DLQ (Dead Letter Queue)** — 失败事件捕获、重试、丢弃、审计 | ✅ `tests/unit/dead-letter/dead-letter-queue.test.ts` (24 tests) | ✅ `tests/integration/dead-letter/webhook-dlq-integration.test.ts` (11 tests) | ✅ `tests/e2e/flow-16-automation-beta-demo.test.ts` | ⚠️ | ✅ `tests/architecture/replay-preview-safety-contract.test.ts` (DLQ safety) | ⚠️ |
| **10** | **Connectors API** — 连接器管理端点 (list/detail/instances/config) | ⚠️ | ✅ `tests/integration/api/connectors-api.test.ts` (14 tests) | ✅ `tests/e2e/flow-16-automation-beta-demo.test.ts` | ⚠️ | ✅ `tests/architecture/workflow-trigger-connector-contract.test.ts` (24 tests) | ⚠️ |
| **11** | **Observability Console** — 运行列表、时间线、回放预览 | ⚠️ | ✅ `tests/integration/observability/observability-console-api.test.ts` (11 tests) `tests/integration/observability/replay-preview-safety.test.ts` (6 tests) | ✅ `tests/e2e/flow-16-automation-beta-demo.test.ts` | ⚠️ | ✅ `tests/architecture/replay-preview-safety-contract.test.ts` (25 tests) | ⚠️ |
| **12** | **TriggersTab Web UI** — 触发器管理界面 | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ `web/src/features/triggers/TriggersTab.test.tsx` (11 tests) |
| **13** | **ConnectorsTab Web UI** — 连接器管理界面 | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ `web/src/features/connectors/ConnectorsTab.test.tsx` (14 tests) |
| **14** | **ObservabilityTab Web UI** — 可观测性控制台界面 | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ `web/src/features/observability/ObservabilityTab.test.tsx` (12 tests) |
| **15** | **Response Envelope** — API 响应封装契约 | - | ✅ `tests/integration/api/response-envelope-contract.test.ts` | - | - | ✅ `tests/integration/api/api-contract.test.ts` | - |
| **16** | **Error Format Contract** — API 错误格式契约 | - | ✅ `tests/integration/api/api-contract.test.ts` | - | - | - | - |
| **17** | **Pagination Contract** — API 分页契约 | - | ✅ `tests/integration/api/api-contract.test.ts` | - | - | - | - |
| **18** | **Rate Limiting** — API 速率限制 | - | ✅ `tests/integration/api/rate-limit.test.ts` | - | - | - | - |
| **19** | **Request Validation** — JSON Schema 请求验证 | - | ✅ `tests/integration/api/api-contract.test.ts` | - | - | - | - |
| **20** | **Compression** — HTTP 响应压缩 | - | ✅ `tests/integration/api/compression.test.ts` | - | - | - | - |
| **21** | **Health Check** — 健康检查端点 | - | ✅ `tests/integration/api/health-check.test.ts` | - | - | - | - |
| **22** | **Swagger UI** — OpenAPI 文档 UI | - | ✅ `tests/integration/api/swagger-ui.test.ts` | - | - | - | - |
| **23** | **Toast Component** — 通知组件 | - | - | - | - | - | ✅ `web/src/components/Toast.test.tsx` |
| **24** | **LoadingSpinner Component** — 加载指示器 | - | - | - | - | - | ✅ `web/src/components/LoadingSpinner.test.tsx` |
| **25** | **EmptyState Component** — 空状态组件 | - | - | - | - | - | ✅ `web/src/components/EmptyState.test.tsx` |
| **26** | **ToolCallCard** — 工具调用卡片 | - | - | - | - | - | ✅ `web/src/components/ToolCallCard.test.tsx` |
| **27** | **ApprovalCard** — 审批卡片 | - | - | - | - | - | ✅ `web/src/components/ApprovalCard.test.tsx` |
| **28** | **BackgroundTaskCard** — 后台任务卡片 | - | - | - | - | - | ✅ `web/src/components/BackgroundTaskCard.test.tsx` |
| **29** | **RunList** — 运行列表组件 | - | - | - | - | - | ✅ `web/src/components/RunList.test.tsx` |
| **30** | **RunDetailDrawer** — 运行详情抽屉 | - | - | - | - | - | ✅ `web/src/components/RunDetailDrawer.test.tsx` |
| **31** | **TimelineView** — 时间线视图 | - | - | - | - | - | ✅ `web/src/components/TimelineView.test.tsx` |
| **32** | **EventFilter** — 事件过滤器 | - | - | - | - | - | ✅ `web/src/components/EventFilter.test.tsx` |
| **33** | **RBAC + API Key Auth** — 3-tier RBAC + API key management | ✅ `tests/unit/permissions/rbac-types.test.ts` | ✅ `tests/integration/api/rbac-integration.test.ts` `tests/integration/api/api-keys.test.ts` | ✅ `tests/e2e/flow-18-p6-product-journey.test.ts` | ⚠️ | ⚠️ | ⚠️ |
| **34** | **API V1 Prefix** — /api/v1/ prefix + legacy redirects | ✅ `tests/unit/api/v1-prefix.test.ts` | ✅ `tests/integration/api/v1-routes.test.ts` | ✅ `tests/e2e/flow-18-p6-product-journey.test.ts` | ⚠️ | ⚠️ | ⚠️ |
| **35** | **Connector Real Transport** — GitHub/Calendar/Contacts/Docs/Web/Generic HTTP connectors with real HTTP | ✅ `tests/unit/connectors/base-http-transport.test.ts` | ✅ `tests/integration/connectors/calendar-connector-real.test.ts` `tests/integration/connectors/contacts-connector-real.test.ts` `tests/integration/connectors/docs-connector-real.test.ts` `tests/integration/connectors/web-search-connector-real.test.ts` `tests/integration/connectors/generic-http-connector.test.ts` | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| **36** | **Memory Budget + Cache** — Token budget, resource limits, LRU cache | ✅ `tests/unit/memory/limit-types.test.ts` | ✅ `tests/integration/memory/budget-manager.test.ts` `tests/integration/memory/cache-layer.test.ts` `tests/integration/memory/resource-limits.test.ts` | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| **37** | **Observability Enhanced** — Prometheus + OTel + Alerting | ✅ `tests/unit/observability/export-types.test.ts` | ✅ `tests/integration/observability/prometheus-exporter.test.ts` `tests/integration/observability/otel-trace-exporter.test.ts` `tests/integration/observability/alerting.test.ts` | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| **38** | **Admin Dashboard UI** — User/API key management, system settings | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ `web/src/features/admin/AdminTab.test.tsx` |
| **39** | **Trigger Create Dialog UI** — Schedule/webhook trigger creation | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ `web/src/features/triggers/TriggerCreateDialog.test.tsx` |
| **40** | **DLQ Management UI** — Failed event list/retry/discard | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ `web/src/features/dlq/DLQTab.test.tsx` |
| **41** | **MemoryTab Expanded** — Memory budget UI with 13 tests | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ `web/src/features/memory/MemoryTab.test.tsx` |
| **42** | **P6 Product Journey** — End-to-end P6 feature verification | ⚠️ | ⚠️ | ✅ `tests/e2e/flow-18-p6-product-journey.test.ts` | ⚠️ | ⚠️ | ⚠️ |

---

## Coverage Statistics Summary

### Overall Cell Status

| Status | Count | Percentage |
|--------|-------|------------|
| ✅ Fully covered | 75 | 29.8% |
| ⚠️ Partially covered | 69 | 27.4% |
| ❌ Not covered | 108 | 42.9% |
| **Total cells** | **252** | **100%** |

### By Test Level

| Test Level | ✅ | ⚠️ | ❌ | Coverage Rate |
|------------|----|----|----|---------------|
| **Unit** | 11 | 13 | 18 | 57.1% (24/42) |
| **Integration** | 24 | 8 | 10 | 76.2% (32/42) |
| **E2E** | 13 | 11 | 18 | 57.1% (24/42) |
| **State-Machine** | 5 | 19 | 18 | 57.1% (24/42) |
| **Architecture** | 13 | 13 | 16 | 61.9% (26/42) |
| **Web** | 19 | 6 | 17 | 59.5% (25/42) |

### By Golden Path

| # | Golden Path | ✅ | ⚠️ | ❌ | Rating |
|---|-------------|----|----|----|--------|
| 1 | Direct Chat | 5 | 1 | 0 | **★★★★★** |
| 2 | Planner-Run | 4 | 2 | 0 | **★★★★★** |
| 3 | Dispatch-Kernel | 4 | 2 | 0 | ★★★★☆ |
| 4 | Read Tool + ResultRef | 4 | 2 | 0 | **★★★★★** |
| 5 | Write Tool Approval | 3 | 3 | 0 | ★★★★☆ |
| 6 | Status Query / Cancel | 3 | 3 | 0 | ★★★★☆ |
| 7 | Lifecycle + Audit | 5 | 1 | 0 | **★★★★★** |
| 8 | Restart + Recovery | 3 | 3 | 0 | ★★★★☆ |
| 9 | DLQ (Dead Letter Queue) | 3 | 3 | 0 | ★★★★☆ |
| 10 | Connectors API | 3 | 3 | 0 | ★★★★☆ |
| 11 | Observability Console | 3 | 3 | 0 | ★★★★☆ |
| 12 | TriggersTab Web UI | 1 | 5 | 0 | ★★★☆☆ |
| 13 | ConnectorsTab Web UI | 1 | 5 | 0 | ★★★☆☆ |
| 14 | ObservabilityTab Web UI | 1 | 5 | 0 | ★★★☆☆ |
| 15 | Response Envelope | 2 | 0 | 4 | ★★☆☆☆ |
| 16 | Error Format Contract | 1 | 0 | 5 | ★☆☆☆☆ |
| 17 | Pagination Contract | 1 | 0 | 5 | ★☆☆☆☆ |
| 18 | Rate Limiting | 1 | 0 | 5 | ★☆☆☆☆ |
| 19 | Request Validation | 1 | 0 | 5 | ★☆☆☆☆ |
| 20 | Compression | 1 | 0 | 5 | ★☆☆☆☆ |
| 21 | Health Check | 1 | 0 | 5 | ★☆☆☆☆ |
| 22 | Swagger UI | 1 | 0 | 5 | ★☆☆☆☆ |
| 23 | Toast Component | 1 | 0 | 5 | ★☆☆☆☆ |
| 24 | LoadingSpinner Component | 1 | 0 | 5 | ★☆☆☆☆ |
| 25 | EmptyState Component | 1 | 0 | 5 | ★☆☆☆☆ |
| 26 | ToolCallCard | 1 | 0 | 5 | ★☆☆☆☆ |
| 27 | ApprovalCard | 1 | 0 | 5 | ★☆☆☆☆ |
| 28 | BackgroundTaskCard | 1 | 0 | 5 | ★☆☆☆☆ |
| 29 | RunList | 1 | 0 | 5 | ★☆☆☆☆ |
| 30 | RunDetailDrawer | 1 | 0 | 5 | ★☆☆☆☆ |
| 31 | TimelineView | 1 | 0 | 5 | ★☆☆☆☆ |
| 32 | EventFilter | 1 | 0 | 5 | ★☆☆☆☆ |
| 33 | RBAC + API Key Auth | 3 | 3 | 0 | ★★★☆☆ |
| 34 | API V1 Prefix | 3 | 3 | 0 | ★★★☆☆ |
| 35 | Connector Real Transport | 2 | 4 | 0 | ★★☆☆☆ |
| 36 | Memory Budget + Cache | 2 | 4 | 0 | ★★☆☆☆ |
| 37 | Observability Enhanced | 2 | 4 | 0 | ★★☆☆☆ |
| 38 | Admin Dashboard UI | 1 | 5 | 0 | ★☆☆☆☆ |
| 39 | Trigger Create Dialog UI | 1 | 5 | 0 | ★☆☆☆☆ |
| 40 | DLQ Management UI | 1 | 5 | 0 | ★☆☆☆☆ |
| 41 | MemoryTab Expanded | 1 | 5 | 0 | ★☆☆☆☆ |
| 42 | P6 Product Journey | 1 | 5 | 0 | ★☆☆☆☆ |

---

## Key Findings

1. **Integration level remains the strongest**: 32 of 42 paths have dedicated integration tests (76.2% coverage). This is the project's primary test safety net.
2. **Architecture level at 61.9%**: 26 of 42 paths have architecture contract tests.
3. **E2E coverage at 57.1%**: 24 of 42 paths have dedicated E2E tests.
4. **Web test coverage expanded**: Phase 5 added frontend component tests for UI components; Phase 6 added Admin Dashboard, Trigger Create Dialog, DLQ Management, and MemoryTab UI tests.
5. **Phase 6 RBAC + API versioning**: Added unit and integration tests for 3-tier RBAC, API key management, and /api/v1/ prefix with legacy redirects.
6. **Phase 6 Connector integration**: Added real HTTP transport tests for Calendar, Contacts, Docs, Web Search, and Generic HTTP connectors.
7. **Phase 6 Memory + Observability**: Added memory budget management, LRU cache, Prometheus exporter, OTel tracing, and alerting tests.
8. **P0 aggregated test**: `tests/e2e/full-flow-suite.test.ts` exercises all 10 flows plus observability verification, serving as a P0 catch-all safety net.

---

## Test File Index

All test files referenced in this matrix (sorted by directory):

| Directory | File | Paths Covered |
|-----------|------|---------------|
| `tests/unit/` | `foreground/llm-router-contract.test.ts` | 1 |
| `tests/unit/` | `foreground/llm-router-guardrails.test.ts` | 1 |
| `tests/unit/` | `shared/lifecycle-conformance.test.ts` | 2, 3, 4, 5, 7 |
| `tests/unit/` | `shared/cancellation.test.ts` | 6 |
| `tests/unit/` | `shared/runtime-error.test.ts` | 8 |
| `tests/unit/` | `tools/file-read.test.ts` | 4 |
| `tests/unit/` | `tools/tool-result-reference.test.ts` | 4 |
| `tests/unit/` | `dead-letter/dead-letter-queue.test.ts` | 9 |
| `tests/integration/` | `foreground/foreground-agent.test.ts` | 1 |
| `tests/integration/` | `planner/planner-runtime.test.ts` | 2 |
| `tests/integration/` | `kernel/agent-kernel.test.ts` | 3 |
| `tests/integration/` | `dispatcher/runtime-dispatcher.test.ts` | 3 |
| `tests/integration/` | `tools/tool-orchestrator.test.ts` | 4 |
| `tests/integration/` | `tools/large-result-reference.test.ts` | 4 |
| `tests/integration/` | `permissions/permission-engine.test.ts` | 5 |
| `tests/integration/` | `approval/approval-resume.test.ts` | 5 |
| `tests/integration/` | `recovery/cancellation.test.ts` | 6 |
| `tests/integration/` | `recovery/cancellation-cascade.test.ts` | 6 |
| `tests/integration/` | `observability/audit.test.ts` | 7 |
| `tests/integration/` | `observability/observability-console-api.test.ts` | 11 |
| `tests/integration/` | `observability/replay-preview-safety.test.ts` | 11 |
| `tests/integration/` | `hardening/startup-recovery.test.ts` | 8 |
| `tests/integration/` | `dead-letter/webhook-dlq-integration.test.ts` | 9 |
| `tests/integration/` | `api/connectors-api.test.ts` | 10 |
| `tests/integration/` | `api/response-envelope-contract.test.ts` | 15 |
| `tests/integration/` | `api/api-contract.test.ts` | 15, 16, 17, 19 |
| `tests/integration/` | `api/rate-limit.test.ts` | 18 |
| `tests/integration/` | `api/compression.test.ts` | 20 |
| `tests/integration/` | `api/health-check.test.ts` | 21 |
| `tests/integration/` | `api/swagger-ui.test.ts` | 22 |
| `tests/e2e/` | `flow-1-chat.test.ts` | 1 |
| `tests/e2e/` | `flow-3-write-approval.test.ts` | 5 |
| `tests/e2e/` | `flow-10-status-query.test.ts` | 6 |
| `tests/e2e/` | `flow-11-cancel-cascade.test.ts` | 6 |
| `tests/e2e/` | `flow-12-planner-complex-task.test.ts` | 2 |
| `tests/e2e/` | `flow-13-read-tool-result-ref.test.ts` | 4 |
| `tests/e2e/` | `flow-16-automation-beta-demo.test.ts` | 9, 10, 11 |
| `tests/e2e/` | `full-flow-suite.test.ts` | 3, 8 |
| `tests/e2e/` | `observability-all-flows.test.ts` | 7 |
| `tests/state-machine/` | `transitions.test.ts` | 1, 2, 3, 6, 7 |
| `tests/state-machine/` | `states.test.ts` | 2 |
| `tests/state-machine/` | `recovery-transitions.test.ts` | 8 |
| `tests/architecture/` | `state-contracts.test.ts` | 2, 7, 8 |
| `tests/architecture/` | `direct-chat-contract.test.ts` | 1 |
| `tests/architecture/` | `dispatch-kernel-contract.test.ts` | 3 |
| `tests/architecture/` | `tool-result-ref-contract.test.ts` | 4 |
| `tests/architecture/` | `write-approval-contract.test.ts` | 5 |
| `tests/architecture/` | `cancel-cascade-contract.test.ts` | 6 |
| `tests/architecture/` | `planner-workflow-contract.test.ts` | 2 |
| `tests/architecture/` | `replay-preview-safety-contract.test.ts` | 9, 11 |
| `tests/architecture/` | `workflow-trigger-connector-contract.test.ts` | 10 |
| `web/src/features/` | `triggers/TriggersTab.test.tsx` | 12 |
| `web/src/features/` | `connectors/ConnectorsTab.test.tsx` | 13 |
| `web/src/features/` | `observability/ObservabilityTab.test.tsx` | 14 |
| `web/src/components/` | `Toast.test.tsx` | 23 |
| `web/src/components/` | `LoadingSpinner.test.tsx` | 24 |
| `web/src/components/` | `EmptyState.test.tsx` | 25 |
| `web/src/components/` | `ToolCallCard.test.tsx` | 26 |
| `web/src/components/` | `ApprovalCard.test.tsx` | 27 |
| `web/src/components/` | `BackgroundTaskCard.test.tsx` | 28 |
| `web/src/components/` | `RunList.test.tsx` | 29 |
| `web/src/components/` | `RunDetailDrawer.test.tsx` | 30 |
| `web/src/components/` | `TimelineView.test.tsx` | 31 |
| `web/src/components/` | `EventFilter.test.tsx` | 32 |
| `tests/unit/` | `permissions/rbac-types.test.ts` | 33 |
| `tests/unit/` | `api/v1-prefix.test.ts` | 34 |
| `tests/unit/` | `connectors/base-http-transport.test.ts` | 35 |
| `tests/unit/` | `memory/limit-types.test.ts` | 36 |
| `tests/unit/` | `observability/export-types.test.ts` | 37 |
| `tests/integration/` | `api/rbac-integration.test.ts` | 33 |
| `tests/integration/` | `api/api-keys.test.ts` | 33 |
| `tests/integration/` | `api/v1-routes.test.ts` | 34 |
| `tests/integration/` | `connectors/calendar-connector-real.test.ts` | 35 |
| `tests/integration/` | `connectors/contacts-connector-real.test.ts` | 35 |
| `tests/integration/` | `connectors/docs-connector-real.test.ts` | 35 |
| `tests/integration/` | `connectors/web-search-connector-real.test.ts` | 35 |
| `tests/integration/` | `connectors/generic-http-connector.test.ts` | 35 |
| `tests/integration/` | `memory/budget-manager.test.ts` | 36 |
| `tests/integration/` | `memory/cache-layer.test.ts` | 36 |
| `tests/integration/` | `memory/resource-limits.test.ts` | 36 |
| `tests/integration/` | `observability/prometheus-exporter.test.ts` | 37 |
| `tests/integration/` | `observability/otel-trace-exporter.test.ts` | 37 |
| `tests/integration/` | `observability/alerting.test.ts` | 37 |
| `tests/e2e/` | `flow-18-p6-product-journey.test.ts` | 33, 34, 42 |
| `web/src/features/` | `admin/AdminTab.test.tsx` | 38 |
| `web/src/features/` | `triggers/TriggerCreateDialog.test.tsx` | 39 |
| `web/src/features/` | `dlq/DLQTab.test.tsx` | 40 |
| `web/src/features/` | `memory/MemoryTab.test.tsx` | 41 |

## P7 Release Gate Coverage

| # | P7 Gate | Unit | Integration | E2E | Status |
|---|---------|------|-------------|-----|--------|
| 1 | Security Headers | - | ✅ tests/integration/api/security-headers.test.ts | - | ✅ |
| 2 | API Key Auth | - | ✅ tests/security/api-key-auth.test.ts | - | ✅ |
| 3 | SSRF Protection | ✅ tests/unit/tools/web-safety.test.ts | - | - | ✅ |
| 4 | RBAC Full Coverage | - | ✅ tests/integration/api/rbac-integration.test.ts | - | ✅ |
| 5 | Response Envelope | - | ✅ tests/integration/api/response-envelope-contract.test.ts | - | ✅ |
| 6 | Error Format | - | ✅ tests/integration/api/error-format-contract.test.ts | - | ✅ |
| 7 | Pagination | - | ✅ tests/integration/api/api-contract.test.ts | - | ✅ |
| 8 | Rate Limiting | - | ✅ tests/integration/api/rate-limit.test.ts | - | ✅ |
| 9 | Performance Baseline | - | ✅ tests/performance/api-latency-smoke.test.ts | - | ✅ |
| 10 | Docker Production | - | ✅ scripts/check-docker-smoke.ts | - | ⚠️ Manual |
| 11 | Backup/Restore | - | ✅ scripts/check-backup-restore.ts | - | ⚠️ Manual |

---

> **Note**: Matrix updated 2026-05-16 to reflect Phase 6 completion. Phase 6 added 10 new golden paths for RBAC, API versioning, connectors, memory management, observability enhancement, and admin UI. Total rows expanded from 32 to 42. Integration column at 76.2% (32/42). Web column at 59.5% (25/42). Architecture column at 61.9% (26/42).
