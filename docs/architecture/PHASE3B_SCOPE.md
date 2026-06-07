# Phase 3-B Scope Declaration

> **Status**: Completed  
> **Phase**: Planner Productization & Web Beta UI  
> **Last Updated**: 2026-05-12  
> **Baseline**: [ARCHITECTURE_TEST_MATRIX.md](./ARCHITECTURE_TEST_MATRIX.md)

---

## IN SCOPE

| Scope Line                   | Target                                                                                   | Priority |
| ---------------------------- | ---------------------------------------------------------------------------------------- | -------- |
| Planner Schema & Types       | `plan-schema.ts` with ExecutionPlan, PlanStep, PlanCheckpoint types                      | High     |
| Plan Validator               | `plan-validator.ts` with schema validation, constraint checking, error taxonomy          | High     |
| Deterministic Plan Generator | `plan-generator-interface.ts` + `deterministic-plan-generator.ts` for reproducible plans | High     |
| LLM Plan Generator Adapter   | `llm-plan-generator.ts` bridging LLM output to plan schema                               | High     |
| Replan Policy                | `replan-policy.ts` with trigger conditions, diff computation, approval thresholds        | High     |
| Timeline & Summary API       | `/api/planner-runs/:id/events`, `/api/planner-runs/:id/summary` endpoints                | Medium   |
| Web Beta UI                  | Inline approval, run detail timeline, approval-to-run navigation                         | Medium   |
| Storage Tests                | Schema-drift detection, index-coverage verification, retention-policy tests              | Medium   |
| Test Matrix Update           | Architecture 100%, overall 30+/40 passing                                                | Medium   |
| Execution Report             | Phase 3-B completion report with evidence                                                | Low      |

---

## OUT OF SCOPE (Deferred)

| Deferred Item                   | Reason                                                     | Target Phase |
| ------------------------------- | ---------------------------------------------------------- | ------------ |
| Connector Marketplace           | Core planner productization takes priority                 | Phase 3-C    |
| Real OAuth                      | Basic auth sufficient for beta; OAuth is ecosystem feature | Phase 3-C    |
| Production Vector DB            | In-memory/embedding sufficient for beta scale              | Phase 3-C    |
| Workflow Builder Rewrite        | Core runtime stability takes priority                      | Phase 3-C    |
| New External Dependencies in CI | Maintain current CI stability; no new services             | Phase 3-C    |

---

## Current Test Matrix State

As of 2026-05-12, the architecture test matrix shows:

| Status               | Count  | Percentage |
| -------------------- | ------ | ---------- |
| ✅ Fully covered     | 31     | 77.5%      |
| ⚠️ Partially covered | 9      | 22.5%      |
| ❌ Not covered       | 0      | 0%         |
| **Total cells**      | **40** | **100%**   |

**Phase 3-B Target**: ✅ Achieved — Architecture column 100% (8/8 ✅), overall 31/40 ✅.

---

## References

- **P0 Scope**: [P0_SCOPE.md](./P0_SCOPE.md)
- **Phase 3-A Scope**: [PHASE3A_SCOPE.md](./PHASE3A_SCOPE.md)
- **Test Matrix**: [ARCHITECTURE_TEST_MATRIX.md](./ARCHITECTURE_TEST_MATRIX.md)
- **Implementation Plan**: [phase3b-implementation.md](../../.sisyphus/plans/phase3b-implementation.md)
