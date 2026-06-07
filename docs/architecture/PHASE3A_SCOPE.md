# Phase 3-A Scope Declaration

> **Status**: Completed  
> **Phase**: Runtime Hardening & Test Gap Closure  
> **Last Updated**: 2026-05-11  
> **Baseline**: [PHASE3A_BASELINE_REPORT.md](../reports/PHASE3A_BASELINE_REPORT.md)

---

## IN SCOPE

| Hardening Line                     | Target                                                                                | Priority |
| ---------------------------------- | ------------------------------------------------------------------------------------- | -------- |
| Dispatcher Idempotency Enhancement | in-flight detection + terminal state detection + WriteActionClass + duplicateBehavior | High     |
| Recovery Orphan Scanner            | orphan run scanner + unified timeout policy + auto resume                             | High     |
| Tool Risk Policy Standardization   | tool-risk-policy.ts + 18 builtin tools risk mapping + write safety tests              | Medium   |
| Architecture Test Gap Closure      | 5 contract tests (Paths 1,3,4,5,6)                                                    | Medium   |
| flow-11-cancel-cascade E2E         | Full cancel cascade E2E test                                                          | Medium   |
| Planner tool-failure replan test   | tool failure → replan path test                                                       | Medium   |

---

## OUT OF SCOPE (Deferred to Phase 3-B)

| Deferred Item               | Reason                                | Target Phase |
| --------------------------- | ------------------------------------- | ------------ |
| Web UI Productization       | Core runtime hardening takes priority | Phase 3-B    |
| Storage/Retention Hardening | Core runtime hardening takes priority | Phase 3-B    |
| Connector Extensions        | Core runtime hardening takes priority | Phase 3-B    |
| Workflow Builder            | Core runtime hardening takes priority | Phase 3-B    |

---

## References

- **P0 Scope**: [P0_SCOPE.md](./P0_SCOPE.md)
- **Baseline Report**: [PHASE3A_BASELINE_REPORT.md](../reports/PHASE3A_BASELINE_REPORT.md)
- **Implementation Plan**: [phase3a-implementation.md](../../.sisyphus/plans/phase3a-implementation.md)
