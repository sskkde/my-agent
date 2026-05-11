# P0 Scope Declaration

> **Status**: Closed  
> **Phase**: P0 fully complete, project now in Phase 3  
> **Last Updated**: 2026-05-11

## P0 Goal

Establish the foundational architecture baseline for a multi-agent platform: core runtime modules, storage layer, permission/approval system, observability, and recovery mechanisms. P0 was originally scoped as "from almost blank to MVP" but the project has since progressed to Phase 3 with full implementations across all subsystems.

---

## IN SCOPE

The following modules and capabilities were within P0 scope and are now fully implemented:

| Module | P0 Capability | Status |
|--------|---------------|--------|
| **Gateway** | Request normalization, channel registry, session message handling | ✅ |
| **Foreground** | LLM router, direct/planner/status/approval routing, deterministic fallback | ✅ |
| **Planner** | PlannerRun state machine (12 states), ExecutionPlan, checkpoint, cancellation | ✅ |
| **Dispatcher** | RuntimeAction dispatch, idempotency, permission precheck, 14 adapter targets | ✅ |
| **Kernel** | Agent iteration loop, context loading, tool dispatch, transcript commit | ✅ |
| **Tools** | Registry, executor, 18 builtin tools, ToolResultReference (32 KiB threshold) | ✅ |
| **Permission** | PermissionEngine, ApprovalHandler, 4 permission modes, pre-approval judge | ✅ |
| **Storage** | 40+ stores, WAL mode, 14 migrations, lifecycle state tracking | ✅ |
| **Lifecycle** | State machine definitions for 13 modules, transition tables, conformance tests | ✅ |
| **Recovery** | CancellationCoordinator, RetryExecutor, cascade cancellation, external write safety | ✅ |
| **Observability** | AuditRecorder, TraceStore, MetricStore, Timeline, event emission | ✅ |
| **Context** | ContextBundle assembly, 5-stage pipeline, token budget, pruning | ✅ |
| **Memory** | Session memory, summary manager, long-term memory extraction/recall lifecycle | ✅ |
| **Workflow** | WorkflowRuntime, draft/definition/run stores, plan-to-workflow compiler | ✅ |
| **Triggers** | EventTriggerRuntime, webhook HMAC verification, delivery-id idempotency | ✅ |
| **Connectors** | ConnectorRuntime, tool bridge, GitHub connector MVP | ✅ |
| **API** | Fastify server, 29 route files, SSE streams, health endpoint | ✅ |
| **Frontend** | React UI, agent config, sessions, workflows, approvals, status tabs | ✅ |
| **Testing** | Unit tests, integration tests, E2E flows, lifecycle conformance tests | ✅ |
| **CI** | GitHub Actions workflow (typecheck, test, e2e) | ✅ |

---

## OUT OF SCOPE

The following capabilities were explicitly excluded from P0 scope:

| Category | Excluded Capability | Reason |
|----------|---------------------|--------|
| **Workflow Builder** | Full visual workflow builder rewrite | P2 advanced feature |
| **Connector Marketplace** | MCP marketplace, connector catalog UI | P2 ecosystem feature |
| **OAuth** | Real OAuth provider rollout | P2 auth hardening |
| **Vector Embedding** | Production vector embedding pipeline | P2 memory enhancement |
| **External Storage** | S3/archive external storage | P2 scalability |
| **Schedule Triggers** | Cron-based schedule triggers | P1 (webhooks complete) |
| **Memory UI** | Memory management UI | P2 (backend complete) |
| **Audit Retention** | Retention/archive policy | P2 operational hardening |
| **LLM Pre-approval Judge** | Full pre-approval judge integration | P2 UX enhancement |
| **Advanced Planner** | PlannerRun merge/reuse/conflict | P2 optimization |
| **Additional Channels** | Non-web channel integrations | P2 extensibility |
| **Transcript Redaction** | Event/transcript privacy redaction | Post-P0 |

---

## References

- **Detailed Status**: See [ARCHITECTURE_GAP_REPORT.md](../../ARCHITECTURE_GAP_REPORT.md) for full subsystem matrix, priority roadmap, and evidence links.
- **Runtime Verification**: See [ARCHITECTURE_RUNTIME_CHECKLIST.md](./ARCHITECTURE_RUNTIME_CHECKLIST.md) for verification entry points and smoke test procedures.
- **Audit Findings**: See `.sisyphus/plans/p0-audit-report.md` for the gap analysis that informed this scope declaration.
- **Phase 3-A Scope**: See [PHASE3A_SCOPE.md](./PHASE3A_SCOPE.md) for Phase 3-A scope definition.

---

## Verification Commands

```bash
npm run typecheck          # TypeScript strict mode
npm test                   # All tests (unit + integration)
npm --prefix web test      # Frontend tests
npm --prefix web run build # Production build
```

All commands pass as of 2026-05-06. Evidence: `.sisyphus/evidence/p0-5-p1/task-10-consolidated-smoke.txt`

---

## Closure Summary

P0 phase is **fully closed** as of 2026-05-06. All P0-1 through P0-6 work items are complete. P1 work (Approval Center, GitHub Connector, Webhook Triggers, Replay UI, Tool Result Refs, Context Conformance) is also fully closed. The project has progressed to Phase 3 with ~200 source files, 40+ stores, and ~200 test files.
