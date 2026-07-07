# Agent Architecture Phase 0 Inventory

> Date: 2026-07-07
> Scope: Phase 0 architecture convergence for `docs/superpowers/specs/2026-07-07-agent-architecture-optimization-design.md`

## Purpose

Phase 0 proves that production LLM requests use the real seven-layer `ModelInputBuilder` and removes prompt-path ambiguity before later phases add validators, context rollout, trace, or prompt evaluation.

## Production LLM Call Paths

| Path | Entry | Model Input Builder Source | Phase 0 Disposition |
| --- | --- | --- | --- |
| Foreground chat | `src/api/context.ts` -> `createOrchestrationMessageProcessor()` -> `ForegroundAgent.runTurn()` -> `AgentKernel.run()` | Real `ModelInputBuilder` constructed in `src/api/context.ts` and injected into `AgentKernel` | Preserve and add integration regression for outbound LLM request messages. |
| Kernel direct execution | `new AgentKernel({ modelInputBuilder })` | Caller-provided `KernelConfig.modelInputBuilder` | Preserve; unit and integration tests already construct explicit builders. |
| Search subagent | `src/api/context.ts` -> `createSearchSubagent()` | Real `ModelInputBuilder` from API context | Preserve; no behavior change in Phase 0. |
| Long-term memory extraction | `createLongTermMemoryScheduler()` -> extractor service | Real `ModelInputBuilder` from API context | Preserve; no behavior change in Phase 0. |
| Subagent context manager | `createDefaultSubagentContextManager()` | Explicit `modelInputBuilder` in subagent manager options | Preserve; no behavior change in Phase 0. |
| Foreground kernel config builder | `src/foreground/kernel-config-builder.ts` -> `buildKernelConfigFromDeps()` | Currently creates `createMinimalModelInputBuilder()` stub | Replace with required `deps.modelInputBuilder`. |

## Phase 0 Decisions

- `ProcessorOrchestrationDeps` will require `modelInputBuilder: ModelInputBuilder`.
- `buildKernelConfigFromDeps()` will not create or fallback to a local stub builder.
- `createForegroundAgent()` will expose only options it actually uses.
- Architecture tests will prevent reintroduction of empty segment model-input stubs in `src/`.

## Deferred To Later Phases

- Runtime output contract validator.
- Tool schema single-source enforcement beyond existing projections.
- Segment D token budget policy changes.
- Structured ReAct trace and richer decision trace.
- Golden dataset and prompt regression runner.
