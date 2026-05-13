# Architecture Test Matrix

> **Purpose**: P0 requirements-to-test coverage mapping — maps golden paths to 5 test levels with specific test file references.
> **Status**: Live, reflects current test infrastructure as of 2026-05-13 (Phase 5 complete)
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

---

## Coverage Statistics Summary

### Overall Cell Status

| Status | Count | Percentage |
|--------|-------|------------|
| ✅ Fully covered | 58 | 30.2% |
| ⚠️ Partially covered | 26 | 13.5% |
| ❌ Not covered | 108 | 56.3% |
| **Total cells** | **192** | **100%** |

### By Test Level

| Test Level | ✅ | ⚠️ | ❌ | Coverage Rate |
|------------|----|----|----|---------------|
| **Unit** | 6 | 8 | 18 | 21.4% (6/32) |
| **Integration** | 19 | 3 | 10 | 68.8% (22/32) |
| **E2E** | 10 | 4 | 18 | 43.8% (14/32) |
| **State-Machine** | 5 | 9 | 18 | 28.1% (14/32) |
| **Architecture** | 13 | 3 | 16 | 50.0% (16/32) |
| **Web** | 15 | 0 | 17 | 46.9% (15/32) |

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

---

## Key Findings

1. **Integration level remains the strongest**: 22 of 32 paths have dedicated integration tests (68.8% coverage). This is the project's primary test safety net.
2. **Architecture level at 50.0%**: 16 of 32 paths have architecture contract tests. Phase 5 added API contract tests.
3. **E2E coverage at 43.8%**: 14 of 32 paths have dedicated E2E tests.
4. **Web test coverage expanded**: Phase 5 added frontend component tests for UI components (Toast, LoadingSpinner, EmptyState, ToolCallCard, ApprovalCard, BackgroundTaskCard, RunList, RunDetailDrawer, TimelineView, EventFilter).
5. **Phase 5 API Productization tests**: Added integration tests for response envelope, error format, pagination, rate limiting, validation, compression, health check, and Swagger UI.
6. **Phase 5 Web component tests**: 10 new Web test files added for reusable UI components.
7. **P0 aggregated test**: `tests/e2e/full-flow-suite.test.ts` exercises all 10 flows plus observability verification, serving as a P0 catch-all safety net.

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

---

> **Note**: Matrix updated 2026-05-13 to reflect Phase 5 completion. Phase 5 added 18 new golden paths for API productization and UI components. Total rows expanded from 14 to 32. Total cells: 192 (32 paths × 6 test levels). Integration column at 68.8% (22/32). Web column at 46.9% (15/32). Architecture column at 50.0% (16/32).
