# Architecture Test Matrix

> **Purpose**: P0 requirements-to-test coverage mapping — maps 8 P0 golden paths to 5 test levels with specific test file references.
> **Status**: Live, reflects current test infrastructure as of 2026-05-11
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

| # | P0 Golden Path | Unit | Integration | E2E | State-Machine | Architecture |
|---|---|---|---|---|---|---|
| **1** | **Direct Chat** — 简单对话，Foreground 直接路由回答 | ✅ `tests/unit/foreground/llm-router-contract.test.ts` `tests/unit/foreground/llm-router-guardrails.test.ts` | ✅ `tests/integration/foreground/foreground-agent.test.ts` | ✅ `tests/e2e/flow-1-chat.test.ts` | ❌ | ❌ |
| **2** | **Planner-Run** — 复杂任务路由到 Planner，创建执行计划 | ⚠️ `tests/unit/shared/lifecycle-conformance.test.ts` (PlannerRun states only) | ✅ `tests/integration/planner/planner-runtime.test.ts` | ⚠️ `tests/e2e/flow-1-chat.test.ts` (partial planner routing, no dedicated planner E2E) | ✅ `tests/state-machine/transitions.test.ts` `tests/state-machine/states.test.ts` | ⚠️ `tests/architecture/state-contracts.test.ts` (contract validation only) |
| **3** | **Dispatch-Kernel** — Dispatcher → Agent Kernel 派发执行路径 | ⚠️ `tests/unit/shared/lifecycle-conformance.test.ts` (KernelRun states only) | ✅ `tests/integration/kernel/agent-kernel.test.ts` `tests/integration/dispatcher/runtime-dispatcher.test.ts` | ✅ `tests/e2e/full-flow-suite.test.ts` | ✅ `tests/state-machine/transitions.test.ts` | ❌ |
| **4** | **Read Tool + ResultRef** — 只读工具调用与 ToolResultReference | ✅ `tests/unit/tools/file-read.test.ts` `tests/unit/tools/tool-result-reference.test.ts` | ✅ `tests/integration/tools/tool-orchestrator.test.ts` `tests/integration/tools/large-result-reference.test.ts` | ⚠️ `tests/e2e/flow-1-chat.test.ts` (tool calls exercised, no dedicated read-tool E2E) | ⚠️ `tests/unit/shared/lifecycle-conformance.test.ts` (ToolExecution states only) | ❌ |
| **5** | **Write Tool Approval** — 写工具强制审批闭环 (approve/reject) | ⚠️ (no dedicated unit test for approval flow logic) | ✅ `tests/integration/permissions/permission-engine.test.ts` `tests/integration/approval/approval-resume.test.ts` | ✅ `tests/e2e/flow-3-write-approval.test.ts` | ⚠️ `tests/unit/shared/lifecycle-conformance.test.ts` (ApprovalRequest states only) | ❌ |
| **6** | **Status Query / Cancel** — 运行状态查询与取消操作 | ⚠️ `tests/unit/shared/cancellation.test.ts` (basic cancel primitives) | ✅ `tests/integration/recovery/cancellation.test.ts` `tests/integration/recovery/cancellation-cascade.test.ts` | ⚠️ `tests/e2e/flow-10-status-query.test.ts` (status query covered, cancel E2E missing) | ⚠️ `tests/state-machine/transitions.test.ts` (cancel transitions only) | ❌ |
| **7** | **Lifecycle + Audit** — 生命周期审计与全链路可观测性 | ✅ `tests/unit/shared/lifecycle-conformance.test.ts` | ✅ `tests/integration/observability/audit.test.ts` | ✅ `tests/e2e/observability-all-flows.test.ts` | ✅ `tests/state-machine/transitions.test.ts` | ✅ `tests/architecture/state-contracts.test.ts` |
| **8** | **Restart + Recovery** — 服务重启恢复与故障容错 | ⚠️ `tests/unit/shared/runtime-error.test.ts` (error taxonomy only) | ✅ `tests/integration/hardening/startup-recovery.test.ts` | ⚠️ `tests/e2e/full-flow-suite.test.ts` (recovery scenarios exercised) | ❌ | ✅ `tests/architecture/state-contracts.test.ts` |

---

## Coverage Statistics Summary

### Overall Cell Status

| Status | Count | Percentage |
|--------|-------|------------|
| ✅ Fully covered | 20 | 50.0% |
| ⚠️ Partially covered | 13 | 32.5% |
| ❌ Not covered | 7 | 17.5% |
| **Total cells** | **40** | **100%** |

### By Test Level

| Test Level | ✅ | ⚠️ | ❌ | Coverage Rate |
|------------|----|----|----|---------------|
| **Unit** | 3 | 5 | 0 | 37.5% (3/8) |
| **Integration** | 8 | 0 | 0 | **100%** (8/8) |
| **E2E** | 4 | 4 | 0 | 50.0% (4/8) |
| **State-Machine** | 3 | 3 | 2 | 37.5% (3/8) |
| **Architecture** | 2 | 1 | 5 | 25.0% (2/8) |

### By P0 Golden Path

| # | Golden Path | ✅ | ⚠️ | ❌ | Rating |
|---|-------------|----|----|----|--------|
| 1 | Direct Chat | 3 | 0 | 2 | ★★★☆☆ |
| 2 | Planner-Run | 2 | 3 | 0 | ★★★★☆ |
| 3 | Dispatch-Kernel | 3 | 1 | 1 | ★★★★☆ |
| 4 | Read Tool + ResultRef | 2 | 2 | 1 | ★★★☆☆ |
| 5 | Write Tool Approval | 2 | 2 | 1 | ★★★☆☆ |
| 6 | Status Query / Cancel | 1 | 3 | 1 | ★★☆☆☆ |
| 7 | Lifecycle + Audit | 5 | 0 | 0 | **★★★★★** |
| 8 | Restart + Recovery | 2 | 2 | 1 | ★★★☆☆ |

---

## Key Findings

1. **Integration level is the strongest**: all 8 P0 golden paths have dedicated integration tests (100% coverage). This is the project's primary test safety net.
2. **Lifecycle + Audit (path 7) is the only path with full 5/5 coverage** across all test levels — the most thoroughly verified golden path.
3. **Architecture-level tests are the weakest**: only 2 of 8 paths (lifecycle + restart) have architecture contract tests. This is the primary test gap.
4. **Status Query / Cancel (path 6) has the lowest coverage**: only 1 fully-covered cell (integration), with cancel E2E being the most notable missing test.
5. **P0 aggregated test**: `tests/e2e/full-flow-suite.test.ts` exercises all 10 flows plus observability verification, serving as a P0 catch-all safety net.
6. **E2E cancel gap**: `tests/e2e/flow-10-status-query.test.ts` covers status query but does not test a full cancel→cascade→verify flow end-to-end.

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
| `tests/integration/` | `hardening/startup-recovery.test.ts` | 8 |
| `tests/e2e/` | `flow-1-chat.test.ts` | 1, 2, 4 |
| `tests/e2e/` | `flow-3-write-approval.test.ts` | 5 |
| `tests/e2e/` | `flow-10-status-query.test.ts` | 6 |
| `tests/e2e/` | `full-flow-suite.test.ts` | 3, 8 |
| `tests/e2e/` | `observability-all-flows.test.ts` | 7 |
| `tests/state-machine/` | `transitions.test.ts` | 2, 3, 6, 7 |
| `tests/state-machine/` | `states.test.ts` | 2 |
| `tests/architecture/` | `state-contracts.test.ts` | 2, 7, 8 |

---

> **Note**: All paths verified against existing test files. No new tests were created for this matrix. The matrix reflects actual test coverage as of 2026-05-11.
