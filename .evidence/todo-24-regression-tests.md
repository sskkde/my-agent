# Todo 24: Regression Tests for Compatibility - Evidence

## Run Date
2026-06-19

## Command
```bash
npm test -- --run tests/integration/api/subagents.test.ts tests/integration/subagents/subagent-runtime.test.ts tests/unit/kernel/model-input/model-input-builder.test.ts tests/unit/foreground/tool-projection.test.ts tests/unit/subagents/kernel-adapter.test.ts tests/unit/kernel/agent-kernel-tool-projection.test.ts && npm --prefix web run typecheck
```

## Results

### Test Suite
- **Test Files**: 6 passed (6)
- **Tests**: 149 passed (149)
- **Duration**: 9.51s

### Typecheck
- **Frontend typecheck**: passed (tsc --noEmit, no errors)

### Test Files Verified
1. `tests/integration/api/subagents.test.ts` — Subagent API integration (CRUD, auth, security, backward compat)
2. `tests/integration/subagents/subagent-runtime.test.ts` — SubagentRuntime launch/execute/cancel lifecycle
3. `tests/unit/kernel/model-input/model-input-builder.test.ts` — ModelInputBuilder segment ordering, hash stability, PM-7 projections
4. `tests/unit/foreground/tool-projection.test.ts` — Foreground tool projection, envelope enforcement
5. `tests/unit/subagents/kernel-adapter.test.ts` — Kernel adapter tool projection for subagents
6. `tests/unit/kernel/agent-kernel-tool-projection.test.ts` — AgentKernel tool projection, per-run override, internal tools, envelope enforcement

## Outcome
All 149 tests pass. No failures to fix. Frontend typecheck clean.
