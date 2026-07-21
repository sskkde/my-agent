
## 2026-07-21 Task: 0

### Kernel run loop structure (agent-kernel.ts)

- `AgentKernel.run()` at line 81 is the main entry point.
- Loop: `for (let iteration = 0; iteration < maxIterations; iteration++)` at line 96.
- Two exits per iteration:
  1. **Tool path** (line 200-286): when `hasToolCalls(llmResponse)` is true → parses tool requests → serial dispatch each → pair each → flushPairingGuard('iteration_end') → compact check → `continue`
  2. **Text path** (line 288-313): when content is present → final content validation → `return`
- Post-loop: line 316 `flushPairingGuard(pairingGuard, state, 'max_iterations', input)` then `return max_iterations_reached`

### Serial dispatch behavior (key observation for Wave 0)

- Tool calls in ONE assistant message are processed **serially**: for loop at line 208 processes each toolRequest one at a time.
- Each tool: (1) check internal handler → (2) if none, dispatchTool → (3) acceptToolResult → (4) commit transcript → (5) broadcast terminal → (6) merge context.
- `flushPairingGuard` is called at 'iteration_end' (line 261) after ALL tools in that iteration are paired. In current serial code, this is always a no-op (no pending calls) because every tool gets its result immediately via serial dispatch.
- At 'max_iterations' (line 316), again a no-op since all tools were paired within iterations.

### Pairing guard flush path (`tool-result-pairing-guard.ts`)

- `ToolResultPairingGuard.trackAssistantToolCalls()` adds to `pendingCalls`.
- `ToolResultPairingGuard.acceptToolResult()` removes from `pendingCalls`, adds to `completedResults`.
- `flushMissingResults(reason)` creates synthetic results for any remaining pending calls with error code `MISSING_TOOL_RESULT`, recoverable: true. Returns the array without auto-committing to transcript.
- `validateToolResultPairing()` (static function) validates transcript pairs without mutation.

### Unprojected tool error code

- Code: `'UNPROJECTED_TOOL_CALL'` (hard-coded in `dispatchTool` at line 793).
- `recoverable: false` (line 796).
- Source: `isCallableProjectedTool()` check at line 788, which checks `input.toolProjection ?? this.config.toolProjection` for tool presence.
- Returned directly from `dispatchTool` — dispatcher is NEVER invoked for unprojected tools.

### Max iterations boundary behavior

- When `maxIterations` is reached (loop exits), `flushPairingGuard` is called with reason `'max_iterations'`.
- In current serial code, this is always a no-op because every tool call produced a result within its iteration.
- Final status: `'max_iterations_reached'`.
- All previously paired tool results remain valid; pairing validation (`validateToolResultPairing`) passes on the full transcript.

### Test patterns

- Integration tests use `FakeLLMAdapter`, `FakeToolExecutor`, `FakeDispatcher`, `FakeContextManager`.
- `FakeDispatcher.dispatch` stores last request in `.lastRequest`. Can be wrapped with a spy to track all dispatched toolCallIds.
- `createToolUseResponse()` builds an LLMResponse with tool_calls.
- `createTextResponse()` builds an LLMResponse with text content.
- `createConfig()` wires up all fakes.
- `createInput()` builds default `KernelRunInput` with overrides.
- `toolProjectionFor(...names)` creates a `ToolPlaneProjection` from tool name strings.

## 2026-07-21 Task: A1

### Truncation guard implementation

- Inserted at line 205 in `agent-kernel.ts` (after `trackAssistantToolCalls`, before `let shouldStop = false`).
- Guard condition: `llmResponse.finishReason === 'length'` — fires only when hasToolCalls is already true.
- Behavior: synthesizes `TRUNCATED_TOOL_CALL` error results for EACH tool call without executing any.
- Each synthetic result: `{ toolCallId, result: null, error: { code: 'TRUNCATED_TOOL_CALL', message: '...', recoverable: true } }` — mirrors `UNPROJECTED_TOOL_CALL` shape but with `recoverable: true`.
- Runs the same per-tool lifecycle as normal dispatch: commitTranscript('tool_call'), broadcastToolCallRunning, acceptToolResult, commitTranscript('tool_result'), broadcastToolResultTerminal, mergeToolResult.
- After all tools: flushPairingGuard('iteration_end') then `continue` (loops to next iteration).
- Compact check intentionally skipped after truncation (truncation is about output limit, not input overshoot).
- Edge cases handled:
  - `length` with empty tool_calls: never reaches guard (hasToolCalls returns false) → content/text path as normal.
  - `length` with content + tool_calls: guard fires (hasToolCalls is true), tool_calls blocked, content present but may be partial (tool results synthesized regardless).
  - `tool_calls` finishReason (normal path): guard does NOT fire, tools execute normally.

### Synthetic result shape

```
{
  toolCallId: string,
  result: null,
  error: {
    code: 'TRUNCATED_TOOL_CALL',    // matches rg pattern
    message: "Tool call '<name>' arguments may be truncated...",
    recoverable: true,               // important: system can retry
  },
}
```

### Test file

- New file: `tests/unit/kernel/agent-kernel-truncation-guard.test.ts` (focused unit test, not extending integration test).
- Reason: tests a single guardrail, not the full loop closure — keeps concerns separated.
- Uses same mock pattern as integration tests: `FakeLLMAdapter`, `FakeToolExecutor`, `FakeContextManager`, `FakeDispatcher` (with `dispatchCalls[]` tracking).
- Helper functions: `createLengthWithToolsResponse(toolCalls)`, `createLengthTextResponse(content)`.
- Test commands that pass:
  - `npm test -- tests/unit/kernel/agent-kernel-truncation-guard.test.ts --maxWorkers=1` → 4 passed
  - `npm test -- tests/integration/kernel/tool-loop-closure.test.ts --maxWorkers=1` → 14 passed (no regression)

## 2026-07-22 Task: A2

### Invalid tool argument JSON guard

- **safeParseParams** signature changed from `Record<string, unknown>` to discriminated union:
  `{ success: true; value: Record<string, unknown> } | { success: false; error: string }`
- **parseToolUseRequests** now returns `{ requests: ToolUseRequest[], invalidArgs: Map<string, string> }`.
  Invalid JSON tools still get a placeholder request (params: {}) so state.toolCalls and
  pairingGuard track them, but the invalidArgs map flags them for synthetic results.
- **Serial dispatch loop** (line 238): before internal-handler/dispatchTool, checks
  `invalidArgs.get(toolRequest.toolCallId)`. If found, synthesizes `INVALID_TOOL_ARGUMENTS`
  result with same lifecycle as `TRUNCATED_TOOL_CALL`: commitTranscript(tool_call),
  broadcastToolCallRunning, acceptToolResult, commitTranscript(tool_result),
  broadcastToolResultTerminal, mergeToolResult, then `continue` (skip dispatch).
- Error shape: `{ code: 'INVALID_TOOL_ARGUMENTS', message: "...", recoverable: true }`
  with `result: null`.
- **Schema validation** remains in tool-executor (`SCHEMA_VALIDATION_FAILED`) — kernel
  catches only JSON syntax failures (JSON.parse throwing), NOT schema violations.
- **Streaming aggregator note**: `StreamResponseAggregator.buildToolCalls()` replaces
  empty arguments strings with `'{}'`, so empty-string arguments never reach
  safeParseParams — this is the aggregator's normalization, not a kernel issue.

### Test file

- New file: `tests/unit/kernel/agent-kernel-invalid-args.test.ts` (focused unit test,
  same pattern as truncation guard test).
- 4 tests:
  1. RED PHASE: single invalid JSON → no dispatch, INVALID_TOOL_ARGUMENTS result
  2. Valid JSON still dispatches normally
  3. Mixed valid+invalid in one assistant → invalid gets synth result, valid dispatches
  4. Multiple invalid variants (open brace, plain text, trailing comma, broken object)
- Test commands that pass:
  - `npm test -- tests/unit/kernel/agent-kernel-invalid-args.test.ts --maxWorkers=1` → 4 passed
  - `npm test -- tests/unit/kernel/agent-kernel-truncation-guard.test.ts --maxWorkers=1` → 4 passed (no regression)
  - `npm test -- tests/integration/kernel/tool-loop-closure.test.ts --maxWorkers=1` → 14 passed (no regression)

### Commit

- `fix(kernel): reject invalid tool argument JSON before dispatch`
- Staged: `src/kernel/agent-kernel.ts`, `tests/unit/kernel/agent-kernel-invalid-args.test.ts`,
  `.omo/evidence/task-A2-loop-p0-p1-pi-inspired.log`, `.omo/notepads/loop-p0-p1-pi-inspired/learnings.md`

## 2026-07-22 Task: B1

### Batch dispatch implementation

- **Dispatch chain change**: serial per-tool `dispatchTool` calls in the for loop replaced by buffering all external projected tools into `externalBatch[]`, then flushing as ONE `dispatchExternalBatch` call.
- **Dispatch flow**:
  1. invalid-args: synthetic INVALID_TOOL_ARGUMENTS, pair/broadcast/merge, continue (unchanged)
  2. internal handler: flush externalBatch FIRST (via dispatchExternalBatch), then run handler, pair/broadcast/merge, check stop
  3. unprojected: synthetic UNPROJECTED_TOOL_CALL (inlined from dispatchTool), pair/broadcast/merge, continue
  4. external projected: push to externalBatch array (no dispatch yet)
  5. After for loop: flush remaining externalBatch via dispatchExternalBatch, then flushPairingGuard('iteration_end')
- **dispatchExternalBatch**: builds ONE createToolDispatchRequest with ALL toolUses, sets executionPolicy maxConcurrency=5 and allowParallelReadOnly=true, dispatches once, maps results by toolCallId using Map, catches dispatch throws to produce DISPATCH_ERROR per tool.
- **Result mapping**: two-tier — extract toolCallId from result data when available (for robustness against out-of-order results), fall back to positional zip (orchestrator returns in order).
- **maxConcurrency=5**: chosen to match typical parallel read tool batches without overwhelming the system.
- **extractFirstToolExecutionResult**: still used by dispatchTool (kept for backward compat).
- **dispatchTool**: retained but dead — referenced via `void this.dispatchTool` to suppress noUnusedLocals.
- **Integration test updates**:
  - Multi-tool spy updated to read `toolDispatchRequest.toolUses` (not just `targetAction.toolCallId`)
  - setUp handler updated to handle batch dispatch (iterates toolUses, returns array of results)
- **Test results**: 28 tests pass across 4 suites (6 batch, 14 integration, 4 truncation, 4 invalid-args).

## 2026-07-22 Task: B2

### Internal handler ordering (characterization tests)

- **B1 already implemented the flush-buffer-before-internal algorithm** as part of the batch-dispatch refactor (lines 262-302 in agent-kernel.ts). B2 only adds characterization tests to lock the behavior.
- **Flow**: left-to-right tool processing buffers external tools; when an internal handler is hit, the external batch is flushed before running the handler; if stop=true, the kernel returns immediately.
- **Pairing guard interaction**: When internal handler stops and returns early, the pairing guard's `flushPairingGuard('internal_handler_stop')` creates synthetic `MISSING_TOOL_RESULT` entries for any tools tracked by `trackAssistantToolCalls` but never processed. This means:
  - tool_call for the unprocessed external tool was NEVER committed to transcript (because the for-loop returned before reaching it)
  - tool_result for it IS committed (from flushPairingGuard's synthetic result)
  - This produces an `orphan_result` warning in `validateToolResultPairing` — expected behavior
- **Edge case verified**: When internal handler throws, catch block produces `INTERNAL_HANDLER_ERROR` result with `recoverable: true`, pairing valid, loop continues.
- **Test results**: 33 tests pass across 5 suites (5 internal-handler-order, 6 batch, 14 integration, 4 truncation, 4 invalid-args).
