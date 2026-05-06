# Architecture Gap Report

> **Status**: Formal Architecture Document  
> **Scope**: Compare `agent_architecture_docs/`, `agent_architecture_lifecycle_storage_failure_docs/`, and `docs/RUNBOOK.md` against current implementation.  
> **Last Updated**: 2026-05-06  
> **P0 Work Status**: P0-1 (report baseline) complete; P0-2, P0-3, P0-4, P0-6 complete; P0-5 (visual workflow builder) remains partial — P0 phase not fully closed.

## 1. Executive Summary

The current codebase has a broad implementation skeleton for nearly every documented subsystem: gateway, foreground agent, planner, dispatcher, kernel, tool plane, permission/approval, context, memory, subagents/background runtime, workflow runtime, triggers/wait conditions, connectors, observability/audit/replay, storage, lifecycle/recovery, API, and web UI.

However, many subsystems are **not yet document-complete**. The main gap is not missing directories; it is missing end-to-end productized capability. In several areas, the code has a runtime foundation but lacks one or more of: real external integration, UI/API management loop, lifecycle conformance tests, operational observability, or production-grade edge-case handling.

## 2. Status Rubric

Use this rubric instead of judging by directory existence.

| Status | Meaning | Closure Threshold |
|---|---|---|
| ✅ Implemented | Code path is wired, tested, and has user/API/ops visibility where required. | Runtime + storage + tests + API/UI/ops evidence exist. |
| 🟡 Partial | Core module or runtime exists, but one or more closure dimensions are missing. | Must list missing dimensions explicitly. |
| 🔴 Missing | Documented capability has no meaningful implementation. | Needs design + implementation plan. |
| ⚪ Historical / Obsolete | Document is a refactor note or superseded by newer docs. | Mark as non-authoritative reference. |

### Evidence Dimensions

Each subsystem is evaluated across four dimensions:

1. **Document target** — what the architecture document expects.
2. **Code presence** — source files/types/stores exist.
3. **Runtime wiring** — code is used in real request/run paths.
4. **Verification and operations** — tests, UI/API, logs/metrics, recovery, or runbook evidence exist.

## 3. Subsystem Status Matrix

| Subsystem | Document Target | Current Evidence | Status | Main Gap | Priority |
|---|---|---|---|---|---|
| Gateway | Normalize inbound channels, hydrate state, dispatch outbound responses. | `src/gateway/gateway.ts`, `src/gateway/channel-registry.ts`, `src/gateway/types.ts` | ✅ Implemented | More external channels beyond Web UI are limited. | P2 |
| Foreground Agent | User-facing router, direct delegation, planner/subagent routing, active-work handling. | `src/foreground/foreground-agent.ts`, `src/foreground/types.ts`, `src/agents/prompt-builder.ts`, `src/agents/prompt-registry.ts` | 🟡 Partial | Advanced persona/direct delegation and multi-planner behavior are still limited. | P1 |
| Planner Runtime | Planner template/run lifecycle, replanning, cancellation, checkpointing. | `src/planner/planner-runtime.ts`, `src/planner/types.ts`, `src/storage/planner-run-store.ts`, `src/storage/plan-store.ts`, `tests/unit/shared/lifecycle-conformance.test.ts` (29 tests covering state categories) | 🟡 Partial | Full lifecycle conformance and plan-to-workflow handoff are not fully proven. | P0 |
| Runtime Dispatcher | Central RuntimeAction router with idempotency, permission precheck, audit. | `src/dispatcher/runtime-dispatcher.ts`, `src/dispatcher/adapter-registry.ts`, `src/dispatcher/types.ts`, `src/dispatcher/index.ts` | 🟡 Partial | Cross-runtime idempotency/audit guarantees need conformance tests. | P0 |
| Agent Kernel | Single agent loop, LLM request, tool call, compact, transcript commit. | `src/kernel/agent-kernel.ts`, `src/kernel/types.ts`, `src/storage/kernel-run-store.ts`, `tests/unit/shared/lifecycle-conformance.test.ts` (KernelRun state coverage) | 🟡 Partial | Compact strategy and transcript consistency need deeper verification. | P1 |
| Tool Plane | Registry, execution pipeline, permission coordination, async operations, large result handling. | `src/tools/tool-registry.ts`, `src/tools/tool-executor.ts`, `src/tools/types.ts`, `src/tools/index.ts`, `src/tools/builtins/` (8 tools: `artifact-create.ts`, `artifact-update.ts`, `ask-user.ts`, `status-query.ts`, `memory-retrieve.ts`, `transcript-search.ts`, `plan-patch.ts`, `docs-search.ts`), `tests/unit/shared/lifecycle-conformance.test.ts` (ToolExecution state coverage) | 🟡 Partial | Large-result reference handling and external connector tool exposure are incomplete. | P1 |
| Permission / Approval | Permission modes, approval requests, scoped grants, LLM pre-approval judge. | `src/permissions/permission-engine.ts`, `src/permissions/approval-handler.ts`, `src/permissions/types.ts`, `src/storage/approval-store.ts`, `src/storage/permission-grant-store.ts`, `tests/unit/shared/lifecycle-conformance.test.ts` (ApprovalRequest state coverage) | 🟡 Partial | Approval Center UI and LLM pre-approval judge are missing/incomplete. | P1 |
| Context Manager | Multi-source context normalization, dedupe, pruning, ContextBundle views. | `src/context/context-manager.ts`, `src/context/context-views.ts`, `src/context/types.ts`, `src/context/index.ts` | 🟡 Partial | Policy-driven view tests across planner/workflow/background are limited. | P1 |
| Memory System | Event/transcript/summary/long-term memory, extraction, recall, lifecycle. | `src/memory/session-memory-manager.ts`, `src/memory/summary-manager.ts`, `src/memory/memory-search.ts`, `src/memory/rolling-summary-policy.ts`, `src/memory/long-term-memory-extraction.ts`, `src/memory/long-term-memory-extractor-service.ts`, `src/memory/long-term-memory-scheduler.ts`, `src/memory/long-term-memory-recall.ts`, `src/memory/types.ts`, `src/storage/summary-store.ts`, `src/storage/long-term-memory-store.ts`, `src/api/routes/memory.ts`, `tests/unit/memory/long-term-memory-lifecycle.test.ts` (20 tests), `tests/unit/memory/long-term-memory-extraction.test.ts` (44 tests), `tests/unit/memory/long-term-memory-extractor-service.test.ts` (22 tests), `tests/unit/memory/long-term-memory-recall.test.ts` (17 tests), `tests/integration/memory/long-term-memory-pipeline.test.ts` (10 tests), `tests/integration/api/memory.test.ts` (34 tests) | ✅ Implemented | Transcript/event redaction remains out of P0 scope. Long-term memory extraction pipeline complete. | P1 |
| Subagent / Background Runtime | Background runs, checkpoint, watchdog, artifacts, recovery. | `src/subagents/background-runtime.ts`, `src/subagents/subagent-runtime.ts`, `src/subagents/types.ts`, `src/storage/background-run-store.ts`, `tests/unit/shared/lifecycle-conformance.test.ts` (BackgroundSubagentRun state coverage), `tests/integration/recovery/cancellation-cascade.test.ts` (background run cancellation) | 🟡 Partial | Artifact policy and recovery edge cases need verification. Cancellation cascade tested. | P0 |
| Workflow Runtime | Versioned workflow definitions, workflow runs, step orchestration, visual builder. | `src/workflows/workflow-runtime.ts`, `src/workflows/types.ts`, `src/storage/workflow-run-store.ts`, `src/storage/workflow-definition-store.ts`, `src/storage/workflow-draft-store.ts`, `tests/integration/workflows/plan-to-workflow.test.ts` (22 tests: draft creation, validation, publish, run, complete, cancel, versioning), `tests/unit/shared/lifecycle-conformance.test.ts` (WorkflowRun state coverage) | 🟡 Partial | Visual Workflow Builder UI incomplete. Plan-to-Workflow compiler path tested. | P0 |
| Event Trigger / Wait | Schedule/webhook/MCP/connector/approval triggers and wait conditions. | `src/triggers/event-trigger-runtime.ts`, `src/triggers/types.ts`, `src/storage/trigger-store.ts`, `src/storage/wait-condition-store.ts`, `tests/unit/shared/lifecycle-conformance.test.ts` (WaitCondition state coverage) | 🟡 Partial | Real trigger sources, duplicate/ordered event handling, production polling are incomplete. | P1 |
| Connector / MCP Layer | External connector runtime, auth, capability discovery, MCP bridge, async operations. | `src/connectors/connector-runtime.ts`, `src/connectors/connector-tool-bridge.ts`, `src/connectors/types.ts`, `src/storage/connector-store.ts`, `tests/integration/connectors/connector-runtime.test.ts` (capability discovery, auth failure handling, async operations, MCP mapping, event emission) | 🟡 Partial | Real MCP protocol and real external connectors are not productized. Contract tests exist. | P0 |
| Observability / Audit / Replay | Trace/audit/replay, timeline, redaction, state reconstruction. | `src/observability/audit-recorder.ts`, `src/observability/replay.ts`, `src/observability/timeline.ts`, `src/observability/tracing.ts`, `src/observability/audit-store.ts`, `src/observability/audit-types.ts`, `src/observability/trace-store.ts`, `src/observability/metric-store.ts`, `src/observability/failure-analyzer.ts`, `src/observability/types.ts` | 🟡 Partial | Replay UI, retention policy, redaction policy, operator workflows incomplete. | P1 |
| Storage / Indexing | Stores, indexes, runtime state, memory, artifacts, approvals, observability. | `src/storage/` (34 modules: `connection.ts`, `schema.ts`, `migrations.ts`, `transaction.ts`, `startup-check.ts`, `all-stores-migrations.ts`, `index.ts`, `agent-config-store.ts`, `artifact-store.ts`, `auth-crypto.ts`, `auth-token-store.ts`, `background-run-store.ts`, `connector-store.ts`, `event-store.ts`, `kernel-run-store.ts`, `long-term-memory-store.ts`, `permission-grant-store.ts`, `plan-store.ts`, `planner-run-store.ts`, `provider-config-store.ts`, `provider-crypto.ts`, `runtime-action-store.ts`, `session-store.ts`, `summary-store.ts`, `tool-execution-store.ts`, `tool-result-store.ts`, `transcript-store.ts`, `trigger-store.ts`, `user-store.ts`, `wait-condition-store.ts`, `workflow-definition-store.ts`, `workflow-draft-store.ts`, `workflow-run-store.ts`, `approval-store.ts`), `migrations/` | 🟡 Partial | Retention, indexing conformance, schema drift review need formal tests. Long-term memory store added. | P0 |
| Failure / Recovery / Cancellation | Error taxonomy, retry, idempotency, cancellation cascade, recovery rules. | `src/recovery/retry-executor.ts`, `src/recovery/cancellation-coordinator.ts`, `src/recovery/types.ts`, `tests/integration/recovery/cancellation-cascade.test.ts` (24 tests: cascade propagation, timeout handling, partial success, external write safety, cross-runtime cancellation, recovery scenarios) | 🟡 Partial | Cross-runtime failure/cancel cascade tests exist. External write safety tested. | P0 |
| Runtime Bootstrap / Resources | Startup, health, resource budgets, graceful shutdown. | `src/runtime/bootstrap.ts`, `src/runtime/resource-limits.ts`, `docs/RUNBOOK.md` | 🟡 Partial | Runbook and actual service supervision need alignment. | P1 |
| Frontend UI | Agent config, sessions, workflows, approvals, observability, memory management. | `web/src/App.tsx`, `web/src/features/agents/AgentsTab.tsx`, `web/src/features/sessions/SessionsTab.tsx`, `web/src/features/settings/SettingsTab.tsx`, `web/src/features/monitor/AgentMonitorTab.tsx`, `web/src/features/dashboard/DashboardTab.tsx`, `web/src/features/status/StatusTab.tsx`, `web/src/features/usage/UsageTab.tsx`, `web/src/features/channels/ChannelsTab.tsx`, `web/src/features/instances/InstancesTab.tsx`, `web/src/features/skills/SkillsTab.tsx`, `web/src/features/auth/LoginPage.tsx`, `web/src/components/AppShell.tsx`, `web/src/components/timeline/TimelineList.tsx` | 🟡 Partial | Workflow builder, approval center, replay UI, memory management UI incomplete. | P1 |

## 4. Historical / Obsolete Documents

| Document | Status | Notes |
|---|---|---|
| `task_workflow_runtime_restructure_v2.md` | ⚪ Historical | Treat as restructuring context. Current authoritative responsibilities are split across workflow runtime, subagent runtime, and trigger runtime docs. |

## 5. Priority Roadmap

### P0 — Architecture Closure Foundation

These items establish the technical safety net and baseline for subsequent work. P0-1 is a governance prerequisite; P0-2, P0-3, P0-6 are technical blockers; P0-4 and P0-5 remain partial and do not fully unlock P1/P2.

| # | Work Item | Why P0 | Type | Dependencies | Closure Criteria | Status |
|---|---|---|---|---|---|---|
| P0-1 | Create final `ARCHITECTURE_GAP_REPORT.md` from this draft. | Establishes shared status baseline. | Governance prerequisite | None | Report has status rubric, full subsystem matrix, priorities, assumptions, and evidence links. | ✅ Complete |
| P0-2 | Add lifecycle conformance tests. | Prevents each runtime from drifting from global state model. | Technical blocker | Shared state definitions. | Tests cover planner, kernel, tool execution, background run, workflow run, approval, wait condition states. | ✅ Complete — `tests/unit/shared/lifecycle-conformance.test.ts` (29 tests) |
| P0-3 | Define MCP/Connector minimum viable contract. | Real connectors depend on capability/auth/event semantics. | Technical blocker | Connector runtime and tool bridge. | Contract doc + tests for capability discovery, auth failure, async operation, idempotency. | ✅ Complete — `tests/integration/connectors/connector-runtime.test.ts` (capability discovery, auth failure handling, async operations, MCP mapping) |
| P0-4 | Implement long-term memory lifecycle. | Memory is central to assistant architecture. | Technical blocker | Summary/session memory foundations. | Store + extraction + recall + delete/retention + privacy tests. | ✅ Complete — Store (`src/storage/long-term-memory-store.ts`), extraction contract (`src/memory/long-term-memory-extraction.ts`), extractor service (`src/memory/long-term-memory-extractor-service.ts`), scheduler (`src/memory/long-term-memory-scheduler.ts`), recall service (`src/memory/long-term-memory-recall.ts`), management API (`src/api/routes/memory.ts`). Tests: 147 total (20 lifecycle + 44 extraction + 22 extractor service + 17 recall + 10 pipeline + 34 API). Note: transcript/event redaction remains out of P0 scope. |
| P0-5 | Implement Workflow Builder + Plan-to-Workflow minimum path. | Converts runtime skeleton into user-facing workflow capability. | Technical blocker (partial) | Workflow runtime, approval/tool policies. | UI/API can create, validate, publish, run a simple workflow compiled from a plan. | 🟡 Partial — Backend path tested (`tests/integration/workflows/plan-to-workflow.test.ts` - 22 tests). Visual Builder UI incomplete. No downstream P1/P2 item explicitly depends on this; consider splitting or reclassifying. |
| P0-6 | Add failure recovery and cancellation cascade tests. | Ensures safety across background/workflow/tool/connector failures. | Technical blocker | Runtime state stores, dispatcher, recovery module. | Tests cover timeout, partial success, external operation failure, cancellation propagation. | ✅ Complete — `tests/integration/recovery/cancellation-cascade.test.ts` (24 tests covering all criteria) |

### P1 — Productization and External Use

| # | Work Item | Why P1 | Dependencies | Closure Criteria |
|---|---|---|---|---|
| P1-1 | Approval Center UI and approval audit loop. | Approval backend needs user-facing operation loop. | Permission/approval stores. | UI lists pending approvals, approve/reject works, audit record visible. |
| P1-2 | Add 1-2 real connector integrations. | Validates connector architecture beyond mocks. | P0-3, P0-6. | At least one read connector and one write/approval-gated connector covered by tests. |
| P1-3 | Implement real trigger sources. | Event trigger runtime needs production inputs. | P0-3, P0-6. | Schedule + webhook trigger E2E tests with duplicate event/idempotency cases. |
| P1-4 | Observability / Replay UI. | Backend audit/replay needs operator workflows. | Observability stores and timeline. | UI can inspect run timeline, audit entries, replay-safe view. |
| P1-5 | Tool large-result references. | Prevents context overflow and supports replay/audit. | Tool plane, artifact store, permission checks. | Large output becomes artifact/ref with access checks and replay behavior. |
| P1-6 | Context view conformance tests. | Ensures planner/workflow/background agents get correct context bundles. | Context manager. | Tests verify source selection, pruning, dedupe, priority order. |

### P2 — Advanced Capabilities

| # | Work Item | Why P2 | Dependencies | Closure Criteria |
|---|---|---|---|---|
| P2-1 | LLM pre-approval judge. | Improves approval UX after base approval loop is stable. | P1-1. | Judge emits explainable allow/ask/deny recommendation with tests. |
| P2-2 | Advanced PlannerRun merge/reuse. | Useful after core lifecycle is stable. | P0-2, P0-6. | Tests cover merge, reuse, conflict, cancellation. |
| P2-3 | Memory management UI. | Productizes memory after backend lifecycle exists. | P0-4. | UI supports inspect/delete memory with privacy safeguards. |
| P2-4 | Audit retention/archive policy. | Operational hardening. | P1-4. | Retention policy tests and runbook update. |
| P2-5 | Additional channel integrations. | Extends Gateway beyond Web UI. | Gateway baseline. | One non-web channel E2E test. |

## 6. Key Assumptions

- Audience: engineering execution and architecture review.
- "Closed" means: implemented runtime path + persisted state if needed + tests + API/UI/ops visibility where applicable.
- Module existence alone is not treated as implementation complete.
- Real connector list is not yet chosen; P0 includes defining the minimum connector contract before selecting full integrations.
- P0-4 (long-term memory) is now complete with full extraction pipeline, recall service, and management API. Transcript/event redaction remains out of P0 scope.
- P0-5 (workflow builder) is marked partial because visual Builder UI is incomplete, though backend path is tested.
- **P0 phase is not fully closed**: P0-5 remains partial. P1/P2 work can proceed for items whose dependencies are satisfied (P0-2, P0-3, P0-4, P0-6). P2-3 (memory UI) is now unblocked.

## 6.1 Document Coverage Mapping

This section maps each architecture document to the subsystem matrix row(s) that absorb its responsibilities.

| Document | Matrix Row(s) | Notes |
|---|---|---|
| `personal_assistant_agent_architecture_v4_memory_aligned.md` | All rows | Master architecture document; defines overall system |
| `foreground_conversation_agent_and_planner_agent_v1.md` | Foreground Agent, Planner Runtime | |
| `gateway_responsibilities_io_and_storage_v2_runtime_aligned.md` | Gateway | |
| `runtime_dispatcher_responsibilities_io_v1.md` | Runtime Dispatcher | |
| `agent_kernel_responsibilities_io_and_compact_v4_runtime_aligned.md` | Agent Kernel | |
| `tool_plane_merged_responsibilities_io_and_exposure_policy_v2_async_operations.md` | Tool Plane | |
| `permission_approval_engine_responsibilities_io_v3_runtime_aligned.md` | Permission / Approval | |
| `context_manager_responsibilities_io_and_summaries_v2_runtime_aligned.md` | Context Manager | |
| `memory_system_responsibilities_io_v2_layered_summary_planner.md` | Memory System | |
| `workflow_runtime_responsibilities_io_v2.md` | Workflow Runtime | |
| `event_trigger_runtime_responsibilities_io_v2_wait_conditions.md` | Event Trigger / Wait | |
| `subagent_runtime_background_boundary_update_v3.md` | Subagent / Background Runtime | |
| `connector_runtime_mcp_layer_responsibilities_io_v1.md` | Connector / MCP Layer | |
| `observability_audit_replay_responsibilities_io_v1.md` | Observability / Audit / Replay | |
| `planner_intent_router_plan_workflow_update_v3_session_memory.md` | Foreground Agent, Planner Runtime | Planner + SessionMemory collaboration |
| `task_workflow_runtime_restructure_v2.md` | ⚪ Historical | Superseded by workflow/subagent/trigger docs |
| `global_runtime_lifecycle_state_machine_v1.md` | Cross-cutting | Defines lifecycle categories used by all runtime rows |
| `storage_model_indexing_strategy_v1.md` | Storage / Indexing | |
| `planner_run_lifecycle_spec_v1.md` | Planner Runtime | |
| `failure_recovery_interrupt_cancellation_policy_v1.md` | Failure / Recovery / Cancellation | |
| `docs/RUNBOOK.md` | Runtime Bootstrap / Resources | |

## 7. Completed P0 Work Summary

### P0-1: Architecture Gap Report ✅
- Created formal `ARCHITECTURE_GAP_REPORT.md` with status rubric, subsystem matrix, priorities, and evidence links.

### P0-2: Lifecycle Conformance Tests ✅
- **File**: `tests/unit/shared/lifecycle-conformance.test.ts`
- **Tests**: 29 tests
- **Coverage**: PlannerRun, KernelRun, ToolExecution, BackgroundSubagentRun, WorkflowRun, ApprovalRequest, WaitCondition
- **Verified**: All states belong to documented lifecycle categories (Active, Waiting, Terminal)

### P0-3: MCP/Connector Contract ✅
- **File**: `tests/integration/connectors/connector-runtime.test.ts`
- **Tests**: Capability discovery, auth failure handling, async operations, MCP tool descriptor mapping, event emission
- **Verified**: ConnectorDefinition/Instance management, capability discovery returns proper structure, tool bridge maps capabilities correctly

### P0-4: Long-term Memory Lifecycle ✅
- **Store**: `src/storage/long-term-memory-store.ts` — Full CRUD operations, soft delete, lifecycle transitions, tombstones
- **Extraction Contract**: `src/memory/long-term-memory-extraction.ts` — Fingerprint, canonicalization, validation, prompt builder
- **Extractor Service**: `src/memory/long-term-memory-extractor-service.ts` — Window builder, LLM call, parsing, validation, upsert
- **Scheduler**: `src/memory/long-term-memory-scheduler.ts` — Async per-turn trigger, fire-and-forget, drain for tests
- **Recall Service**: `src/memory/long-term-memory-recall.ts` — Lexical search, importance/confidence sorting, recall metadata
- **Management API**: `src/api/routes/memory.ts` — List, detail, delete, debug extraction runs, manual trigger
- **Tests**: 147 total
  - `tests/unit/memory/long-term-memory-lifecycle.test.ts` — 20 tests (write, retrieve, delete, patch, lifecycle transitions)
  - `tests/unit/memory/long-term-memory-extraction.test.ts` — 44 tests (fingerprint, canonicalize, validate, prompt)
  - `tests/unit/memory/long-term-memory-extractor-service.test.ts` — 22 tests (window builder, LLM call, parse, write, tombstone, supersede)
  - `tests/unit/memory/long-term-memory-recall.test.ts` — 17 tests (lexical search, filtering, sorting, metadata update)
  - `tests/integration/memory/long-term-memory-pipeline.test.ts` — 10 tests (scheduler integration, async trigger)
  - `tests/integration/api/memory.test.ts` — 34 tests (list, detail, delete, debug endpoints, auth, ownership)
- **Note**: Transcript/event redaction remains out of P0 scope.

### P0-5: Plan-to-Workflow Path 🟡 (Partial)
- **File**: `tests/integration/workflows/plan-to-workflow.test.ts`
- **Tests**: 22 tests covering draft creation, validation, publish, run, step completion, cancellation, version management
- **Verified**: Full backend path from plan-like input → draft → validate → publish → run → complete
- **Remaining**: Visual Workflow Builder UI not implemented

### P0-6: Failure Recovery and Cancellation Cascade ✅
- **File**: `tests/integration/recovery/cancellation-cascade.test.ts`
- **Tests**: 24 tests
- **Coverage**: Cancellation cascade (PlannerRun → KernelRun → ToolExecutions), timeout handling, partial success, external write safety, cross-runtime cancellation, recovery scenarios
- **Verified**: Side effect detection, approval before retry for non-idempotent writes, synthetic results for cancelled tools

## 8. Evidence Sources Summary

This report references implementation evidence from the following directories:

| Directory | File Count | Purpose |
|---|---|---|
| `src/gateway/` | 3 | Request gateway and channel registry |
| `src/foreground/` | 2 | User-facing agent router |
| `src/agents/` | 2 | Prompt builder and registry |
| `src/planner/` | 2 | Planner runtime and types |
| `src/dispatcher/` | 4 | Runtime dispatcher and adapters |
| `src/kernel/` | 2 | Agent kernel and types |
| `src/tools/` | 4 + 8 builtins | Tool registry, executor, and built-in tools |
| `src/permissions/` | 3 | Permission engine and approval handler |
| `src/context/` | 4 | Context manager and views |
| `src/memory/` | 5 | Session memory, summary, and search |
| `src/subagents/` | 3 | Background and subagent runtime |
| `src/workflows/` | 2 | Workflow runtime and types |
| `src/triggers/` | 2 | Event trigger runtime and types |
| `src/connectors/` | 3 | Connector runtime and tool bridge |
| `src/observability/` | 10 | Audit, replay, tracing, metrics |
| `src/storage/` | 34 | Database stores and schema (including `long-term-memory-store.ts`) |
| `src/recovery/` | 3 | Retry executor and cancellation |
| `src/runtime/` | 2 | Bootstrap and resource limits |
| `src/shared/` | 2 | State definitions and cancellation types |
| `web/src/` | 38 | Frontend React components |
| `migrations/` | — | Database migrations |
| `docs/` | — | Runbook and documentation |
| `tests/unit/shared/` | 1 | Lifecycle conformance tests |
| `tests/unit/memory/` | 1 | Long-term memory lifecycle tests |
| `tests/integration/recovery/` | 1 | Cancellation cascade tests |
| `tests/integration/workflows/` | 1 | Plan-to-workflow tests |
| `tests/integration/connectors/` | 1 | Connector runtime tests |

---

**Report Source**: `.sisyphus/drafts/ARCHITECTURE_GAP_REPORT.md`  
**Generated**: 2026-05-06  
**P0 Work Updated**: 2026-05-06
