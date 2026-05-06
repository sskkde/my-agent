# Architecture Gap Report

> **Status**: Formal Architecture Document  
> **Scope**: Compare `agent_architecture_docs/`, `agent_architecture_lifecycle_storage_failure_docs/`, and `docs/RUNBOOK.md` against current implementation.  
> **Last Updated**: 2026-05-06

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
| Planner Runtime | Planner template/run lifecycle, replanning, cancellation, checkpointing. | `src/planner/planner-runtime.ts`, `src/planner/types.ts`, `src/storage/planner-run-store.ts`, `src/storage/plan-store.ts` | 🟡 Partial | Full lifecycle conformance and plan-to-workflow handoff are not fully proven. | P0 |
| Runtime Dispatcher | Central RuntimeAction router with idempotency, permission precheck, audit. | `src/dispatcher/runtime-dispatcher.ts`, `src/dispatcher/adapter-registry.ts`, `src/dispatcher/types.ts`, `src/dispatcher/index.ts` | 🟡 Partial | Cross-runtime idempotency/audit guarantees need conformance tests. | P0 |
| Agent Kernel | Single agent loop, LLM request, tool call, compact, transcript commit. | `src/kernel/agent-kernel.ts`, `src/kernel/types.ts`, `src/storage/kernel-run-store.ts` | 🟡 Partial | Compact strategy and transcript consistency need deeper verification. | P1 |
| Tool Plane | Registry, execution pipeline, permission coordination, async operations, large result handling. | `src/tools/tool-registry.ts`, `src/tools/tool-executor.ts`, `src/tools/types.ts`, `src/tools/index.ts`, `src/tools/builtins/` (8 tools: `artifact-create.ts`, `artifact-update.ts`, `ask-user.ts`, `status-query.ts`, `memory-retrieve.ts`, `transcript-search.ts`, `plan-patch.ts`, `docs-search.ts`) | 🟡 Partial | Large-result reference handling and external connector tool exposure are incomplete. | P1 |
| Permission / Approval | Permission modes, approval requests, scoped grants, LLM pre-approval judge. | `src/permissions/permission-engine.ts`, `src/permissions/approval-handler.ts`, `src/permissions/types.ts`, `src/storage/approval-store.ts`, `src/storage/permission-grant-store.ts` | 🟡 Partial | Approval Center UI and LLM pre-approval judge are missing/incomplete. | P1 |
| Context Manager | Multi-source context normalization, dedupe, pruning, ContextBundle views. | `src/context/context-manager.ts`, `src/context/context-views.ts`, `src/context/types.ts`, `src/context/index.ts` | 🟡 Partial | Policy-driven view tests across planner/workflow/background are limited. | P1 |
| Memory System | Event/transcript/summary/long-term memory, extraction, recall, lifecycle. | `src/memory/session-memory-manager.ts`, `src/memory/summary-manager.ts`, `src/memory/memory-search.ts`, `src/memory/rolling-summary-policy.ts`, `src/memory/types.ts`, `src/storage/summary-store.ts` | 🟡 Partial | Long-term memory store, extraction pipeline, retention/deletion/privacy lifecycle are incomplete. | P0 |
| Subagent / Background Runtime | Background runs, checkpoint, watchdog, artifacts, recovery. | `src/subagents/background-runtime.ts`, `src/subagents/subagent-runtime.ts`, `src/subagents/types.ts`, `src/storage/background-run-store.ts` | 🟡 Partial | Artifact policy, recovery edge cases, cancellation cascade need verification. | P0 |
| Workflow Runtime | Versioned workflow definitions, workflow runs, step orchestration, visual builder. | `src/workflows/workflow-runtime.ts`, `src/workflows/types.ts`, `src/storage/workflow-run-store.ts`, `src/storage/workflow-definition-store.ts`, `src/storage/workflow-draft-store.ts` | 🟡 Partial | Workflow Builder and Plan-to-Workflow compiler are missing/incomplete. | P0 |
| Event Trigger / Wait | Schedule/webhook/MCP/connector/approval triggers and wait conditions. | `src/triggers/event-trigger-runtime.ts`, `src/triggers/types.ts`, `src/storage/trigger-store.ts`, `src/storage/wait-condition-store.ts` | 🟡 Partial | Real trigger sources, duplicate/ordered event handling, production polling are incomplete. | P1 |
| Connector / MCP Layer | External connector runtime, auth, capability discovery, MCP bridge, async operations. | `src/connectors/connector-runtime.ts`, `src/connectors/connector-tool-bridge.ts`, `src/connectors/types.ts`, `src/storage/connector-store.ts` | 🟡 Partial | Real MCP protocol and real external connectors are not productized. | P0 |
| Observability / Audit / Replay | Trace/audit/replay, timeline, redaction, state reconstruction. | `src/observability/audit-recorder.ts`, `src/observability/replay.ts`, `src/observability/timeline.ts`, `src/observability/tracing.ts`, `src/observability/audit-store.ts`, `src/observability/audit-types.ts`, `src/observability/trace-store.ts`, `src/observability/metric-store.ts`, `src/observability/failure-analyzer.ts`, `src/observability/types.ts` | 🟡 Partial | Replay UI, retention policy, redaction policy, operator workflows incomplete. | P1 |
| Storage / Indexing | Stores, indexes, runtime state, memory, artifacts, approvals, observability. | `src/storage/` (33 modules: `connection.ts`, `schema.ts`, `migrations.ts`, `transaction.ts`, `startup-check.ts`, `all-stores-migrations.ts`, `index.ts`, `agent-config-store.ts`, `artifact-store.ts`, `auth-crypto.ts`, `auth-token-store.ts`, `background-run-store.ts`, `connector-store.ts`, `event-store.ts`, `kernel-run-store.ts`, `permission-grant-store.ts`, `plan-store.ts`, `planner-run-store.ts`, `provider-config-store.ts`, `provider-crypto.ts`, `runtime-action-store.ts`, `session-store.ts`, `summary-store.ts`, `tool-execution-store.ts`, `tool-result-store.ts`, `transcript-store.ts`, `trigger-store.ts`, `user-store.ts`, `wait-condition-store.ts`, `workflow-definition-store.ts`, `workflow-draft-store.ts`, `workflow-run-store.ts`, `approval-store.ts`), `migrations/` | 🟡 Partial | Retention, indexing conformance, schema drift review need formal tests. | P0 |
| Failure / Recovery / Cancellation | Error taxonomy, retry, idempotency, cancellation cascade, recovery rules. | `src/recovery/retry-executor.ts`, `src/recovery/cancellation-coordinator.ts`, `src/recovery/types.ts` | 🟡 Partial | Cross-runtime failure/cancel cascade tests are missing. | P0 |
| Runtime Bootstrap / Resources | Startup, health, resource budgets, graceful shutdown. | `src/runtime/bootstrap.ts`, `src/runtime/resource-limits.ts`, `docs/RUNBOOK.md` | 🟡 Partial | Runbook and actual service supervision need alignment. | P1 |
| Frontend UI | Agent config, sessions, workflows, approvals, observability, memory management. | `web/src/App.tsx`, `web/src/features/agents/AgentsTab.tsx`, `web/src/features/sessions/SessionsTab.tsx`, `web/src/features/settings/SettingsTab.tsx`, `web/src/features/monitor/AgentMonitorTab.tsx`, `web/src/features/dashboard/DashboardTab.tsx`, `web/src/features/status/StatusTab.tsx`, `web/src/features/usage/UsageTab.tsx`, `web/src/features/channels/ChannelsTab.tsx`, `web/src/features/instances/InstancesTab.tsx`, `web/src/features/skills/SkillsTab.tsx`, `web/src/features/auth/LoginPage.tsx`, `web/src/components/AppShell.tsx`, `web/src/components/timeline/TimelineList.tsx` | 🟡 Partial | Workflow builder, approval center, replay UI, memory management UI incomplete. | P1 |

## 4. Historical / Obsolete Documents

| Document | Status | Notes |
|---|---|---|
| `task_workflow_runtime_restructure_v2.md` | ⚪ Historical | Treat as restructuring context. Current authoritative responsibilities are split across workflow runtime, subagent runtime, and trigger runtime docs. |

## 5. Priority Roadmap

### P0 — Architecture Closure Foundation

These items unblock multiple other gaps and should be handled first.

| # | Work Item | Why P0 | Dependencies | Closure Criteria |
|---|---|---|---|---|
| P0-1 | Create final `ARCHITECTURE_GAP_REPORT.md` from this draft. | Establishes shared status baseline. | None | Report has status rubric, full subsystem matrix, priorities, assumptions, and evidence links. |
| P0-2 | Add lifecycle conformance tests. | Prevents each runtime from drifting from global state model. | Shared state definitions. | Tests cover planner, kernel, tool execution, background run, workflow run, approval, wait condition states. |
| P0-3 | Define MCP/Connector minimum viable contract. | Real connectors depend on capability/auth/event semantics. | Connector runtime and tool bridge. | Contract doc + tests for capability discovery, auth failure, async operation, idempotency. |
| P0-4 | Implement long-term memory lifecycle. | Memory is central to assistant architecture. | Summary/session memory foundations. | Store + extraction + recall + delete/retention + privacy tests. |
| P0-5 | Implement Workflow Builder + Plan-to-Workflow minimum path. | Converts runtime skeleton into user-facing workflow capability. | Workflow runtime, approval/tool policies. | UI/API can create, validate, publish, run a simple workflow compiled from a plan. |
| P0-6 | Add failure recovery and cancellation cascade tests. | Ensures safety across background/workflow/tool/connector failures. | Runtime state stores, dispatcher, recovery module. | Tests cover timeout, partial success, external operation failure, cancellation propagation. |

### P1 — Productization and External Use

| # | Work Item | Why P1 | Dependencies | Closure Criteria |
|---|---|---|---|---|
| P1-1 | Approval Center UI and approval audit loop. | Approval backend needs user-facing operation loop. | Permission/approval stores. | UI lists pending approvals, approve/reject works, audit record visible. |
| P1-2 | Add 1-2 real connector integrations. | Validates connector architecture beyond mocks. | P0-3. | At least one read connector and one write/approval-gated connector covered by tests. |
| P1-3 | Implement real trigger sources. | Event trigger runtime needs production inputs. | Connector/webhook/schedule contracts. | Schedule + webhook trigger E2E tests with duplicate event/idempotency cases. |
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

## 7. Evidence Sources Summary

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
| `src/storage/` | 33 | Database stores and schema |
| `src/recovery/` | 3 | Retry executor and cancellation |
| `src/runtime/` | 2 | Bootstrap and resource limits |
| `web/src/` | 38 | Frontend React components |
| `migrations/` | — | Database migrations |
| `docs/` | — | Runbook and documentation |

---

**Report Source**: `.sisyphus/drafts/ARCHITECTURE_GAP_REPORT.md`  
**Generated**: 2026-05-06
